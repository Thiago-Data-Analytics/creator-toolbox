-- ═══════════════════════════════════════════════════════════════════
-- MercaBot — Migration: Wizard Instrumentation
-- Executar em: Supabase Dashboard → SQL Editor → New query → Run
--
-- Adiciona 3 colunas timestamp em customers para rastrear em qual step
-- exato cada cliente para no wizard de ativação. Sem isso, "ativam mas
-- não usam" continua caixa preta. Com isso, vemos o drop-off real:
--
--   step 1 (negócio)         → wizard_step1_at
--   step 2 (como atender)    → wizard_step2_at
--   step 3 (perguntas+save)  → wizard_step3_at = activated_at (existente)
--
-- Backfill: clientes que JÁ tem activated_at preenchido recebem todos os
-- 3 timestamps = activated_at (assumimos que passaram pelos 3 steps).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Colunas
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS wizard_step1_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wizard_step2_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wizard_step3_at TIMESTAMPTZ;

-- 2. Backfill — clientes ativados antes desta migration
UPDATE customers
SET
  wizard_step1_at = COALESCE(wizard_step1_at, activated_at),
  wizard_step2_at = COALESCE(wizard_step2_at, activated_at),
  wizard_step3_at = COALESCE(wizard_step3_at, activated_at)
WHERE activated_at IS NOT NULL
  AND (wizard_step1_at IS NULL OR wizard_step2_at IS NULL OR wizard_step3_at IS NULL);

-- 3. Índices pra agregações rápidas no dashboard admin
CREATE INDEX IF NOT EXISTS idx_customers_wizard_step1 ON customers (wizard_step1_at) WHERE wizard_step1_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_wizard_step2 ON customers (wizard_step2_at) WHERE wizard_step2_at IS NOT NULL;

-- 4. Verificação
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE wizard_step1_at IS NOT NULL) AS atingiu_step1,
  COUNT(*) FILTER (WHERE wizard_step2_at IS NOT NULL) AS atingiu_step2,
  COUNT(*) FILTER (WHERE wizard_step3_at IS NOT NULL) AS atingiu_step3,
  COUNT(*) FILTER (WHERE wizard_step1_at IS NULL AND created_at >= NOW() - INTERVAL '90 days') AS travaram_antes_step1
FROM customers;
