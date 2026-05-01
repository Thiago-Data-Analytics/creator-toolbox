-- ═══════════════════════════════════════════════════════════════════
-- MercaBot — Migration: Sistema de Comissão de Parceiros
-- Executar em: Supabase Dashboard → SQL Editor → New query → Run
--
-- Cria 2 tabelas:
--   partner_commissions: 1 linha por (parceiro × cliente × mês de referência).
--   partner_payouts:     1 linha por (parceiro × mês de referência) — total
--                        a ser pago naquele mês.
--
-- Idempotência:
--   UNIQUE em (partner_id, customer_id, reference_month) impede que o cron
--   mensal duplique linhas se rodar 2x. Re-execuções fazem ON CONFLICT
--   DO NOTHING (ou UPDATE — ver lógica do worker).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Tabela partner_payouts (pagamentos consolidados por mês)
-- Criada ANTES de partner_commissions porque commissions referencia payouts.
CREATE TABLE IF NOT EXISTS partner_payouts (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id               UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reference_month          DATE         NOT NULL,
  total_amount_brl_cents   BIGINT       NOT NULL DEFAULT 0,
  client_count             INTEGER      NOT NULL DEFAULT 0,
  pix_key                  TEXT,
  pix_key_type             TEXT,
  status                   TEXT         NOT NULL DEFAULT 'pending',
  paid_at                  TIMESTAMPTZ,
  receipt_url              TEXT,
  notes                    TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_payouts_status_chk
    CHECK (status IN ('pending','sent','confirmed','failed','reversed')),
  CONSTRAINT partner_payouts_pix_type_chk
    CHECK (pix_key_type IS NULL OR pix_key_type IN ('cpf','cnpj','email','phone','random')),
  CONSTRAINT partner_payouts_unique_partner_month
    UNIQUE (partner_id, reference_month)
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner_month
  ON partner_payouts (partner_id, reference_month DESC);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_status_pending
  ON partner_payouts (status, reference_month DESC) WHERE status = 'pending';

-- 2. Tabela partner_commissions (linha-a-linha: parceiro × cliente × mês)
CREATE TABLE IF NOT EXISTS partner_commissions (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id                  UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  customer_id                 UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reference_month             DATE         NOT NULL,
  client_mrr_brl_cents        BIGINT       NOT NULL,
  commission_rate             NUMERIC(5,4) NOT NULL DEFAULT 0.3000,
  commission_amount_brl_cents BIGINT       NOT NULL,
  client_status_snapshot      TEXT         NOT NULL,
  client_plan_code_snapshot   TEXT         NOT NULL,
  payout_id                   UUID         REFERENCES partner_payouts(id) ON DELETE SET NULL,
  computed_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT partner_commissions_rate_chk
    CHECK (commission_rate >= 0 AND commission_rate <= 1),
  CONSTRAINT partner_commissions_unique_triple
    UNIQUE (partner_id, customer_id, reference_month)
);

CREATE INDEX IF NOT EXISTS idx_partner_commissions_partner_month
  ON partner_commissions (partner_id, reference_month DESC);
CREATE INDEX IF NOT EXISTS idx_partner_commissions_payout
  ON partner_commissions (payout_id) WHERE payout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partner_commissions_customer
  ON partner_commissions (customer_id, reference_month DESC);

-- 3. Trigger pra atualizar updated_at em partner_payouts
CREATE OR REPLACE FUNCTION trg_partner_payouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS partner_payouts_updated_at ON partner_payouts;
CREATE TRIGGER partner_payouts_updated_at
  BEFORE UPDATE ON partner_payouts
  FOR EACH ROW EXECUTE FUNCTION trg_partner_payouts_updated_at();

-- 4. RLS: parceiros enxergam SUAS linhas; admin (service_role) enxerga tudo.
ALTER TABLE partner_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_payouts     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_commissions_self_read ON partner_commissions;
CREATE POLICY partner_commissions_self_read ON partner_commissions
  FOR SELECT
  USING (
    partner_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS partner_payouts_self_read ON partner_payouts;
CREATE POLICY partner_payouts_self_read ON partner_payouts
  FOR SELECT
  USING (
    partner_id IN (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );

-- INSERT/UPDATE só via service_role (worker / admin) — sem policy = bloqueado pra anon/authenticated.

-- 5. Verificação
SELECT 'partner_commissions' AS table_name, COUNT(*) AS rows FROM partner_commissions
UNION ALL
SELECT 'partner_payouts',                  COUNT(*)            FROM partner_payouts;
