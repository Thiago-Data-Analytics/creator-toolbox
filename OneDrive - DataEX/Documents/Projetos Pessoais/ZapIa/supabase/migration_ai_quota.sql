-- ═══════════════════════════════════════════════════════════════════
-- MercaBot — Migration: Sistema de Cotas de Mensagens IA
-- Executar em: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════

-- 1. Adicionar colunas de cota na tabela client_settings
ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS ai_msgs_used     INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_msgs_limit    INTEGER      NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS ai_msgs_reset_at TIMESTAMPTZ  NOT NULL DEFAULT (
    date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month'
  );

-- 2. Inicializar o limite correto para clientes já existentes
UPDATE client_settings cs
SET ai_msgs_limit = CASE
  WHEN c.plan_code = 'parceiro' THEN 15000
  WHEN c.plan_code = 'pro'      THEN 4000
  ELSE                               1000
END
FROM customers c
WHERE cs.customer_id = c.id;

-- 3. Índice para acelerar a consulta de cota no webhook (alta frequência)
CREATE INDEX IF NOT EXISTS idx_client_settings_quota
  ON client_settings (id, ai_msgs_used, ai_msgs_limit, ai_msgs_reset_at);

-- 4. Verificação — confira os resultados antes de fechar
SELECT
  cs.id,
  c.company_name,
  c.plan_code,
  cs.ai_msgs_used,
  cs.ai_msgs_limit,
  cs.ai_msgs_reset_at
FROM client_settings cs
JOIN customers c ON c.id = cs.customer_id
ORDER BY c.plan_code, c.company_name;
