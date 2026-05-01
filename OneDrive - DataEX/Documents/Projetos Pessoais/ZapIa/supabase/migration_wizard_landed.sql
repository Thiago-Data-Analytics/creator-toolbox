-- ═══════════════════════════════════════════════════════════════════
-- MercaBot — Migration: wizard_landed_at (Risco 7 da auditoria)
-- Executar em: Supabase Dashboard → SQL Editor → New query → Run
--
-- Captura quando o cliente ABRIU o wizard (página /ativacao/ carregou),
-- distinto de quando completou Step 1 (preencheu primeiro form).
--
-- Permite identificar 3 perfis de drop-off:
--   A. Magic link nunca clicado (wizard_landed_at = NULL)
--   B. Wizard aberto mas Step 1 abandonado (landed mas !step1)
--   C. Step 1 completo, abandonou step 2 (step1 mas !step2)
--   D. Wizard concluído (todos preenchidos)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS wizard_landed_at TIMESTAMPTZ;

-- Backfill: se cliente já completou step 1, assumimos que landou também.
-- Mais conservador que assumir ele NÃO landou.
UPDATE customers
SET wizard_landed_at = COALESCE(wizard_landed_at, wizard_step1_at)
WHERE wizard_step1_at IS NOT NULL
  AND wizard_landed_at IS NULL;

-- Index pra agregação no admin dashboard
CREATE INDEX IF NOT EXISTS idx_customers_wizard_landed
  ON customers (wizard_landed_at) WHERE wizard_landed_at IS NOT NULL;

-- Verificação
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE wizard_landed_at IS NOT NULL) AS landou_wizard,
  COUNT(*) FILTER (WHERE wizard_step1_at IS NOT NULL) AS atingiu_step1,
  COUNT(*) FILTER (WHERE wizard_landed_at IS NOT NULL AND wizard_step1_at IS NULL) AS landou_mas_nao_step1,
  COUNT(*) FILTER (WHERE wizard_landed_at IS NULL AND created_at >= NOW() - INTERVAL '90 days') AS nunca_landou_90d
FROM customers;
