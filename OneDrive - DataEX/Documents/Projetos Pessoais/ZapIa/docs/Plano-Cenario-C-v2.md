# Cenário C v2.1 — Plano Executável (Realidade Brutal Edition)

**Versão:** 2.1 · **Atualizado:** maio/2026 · **Owner:** Thiago (Founder)
**Status:** Baseline diagnosticado — produto em pré-PMF com 2 clientes pagantes reais.

---

## TL;DR (atualizado pós-baseline)

O baseline real revelou: das 25 contas que apareciam como "pagantes" no Stripe, **apenas 2 são clientes reais** (Upx Motors Pro R$497 + Clínica Mais Saúde Concórdia Starter R$197). Ambos pagaram, ativaram via wizard, mas têm **0 conversas**. Os outros 23 são poluição de QA/aliases internos + 4 já cancelados.

**MRR efetivo: R$694/m. Clientes usando o bot: 0.**

Esta versão (v2.1) **congela o crescimento agressivo planejado em v2.0** e foca em 1 objetivo único nas próximas 4-6 semanas: **achar o motivo de "ativam mas não usam" e desbloquear pelo menos os 2 clientes reais**. Marketing, parceiros, free tier, LATAM — tudo congelado até o produto provar valor com 5 clientes pagando + usando diariamente.

**North Star ajustado:** chegar a **10 clientes pagantes USANDO o bot diariamente** antes de qualquer movimento de aquisição. Estimativa: 60-90 dias.

---

## 1. Baseline real (maio/2026)

### Status geral
- **Total de signups na história:** 29
- **Contas reais (não-teste):** 9 visíveis após filtro por e-mail
- **Pagantes ativos hoje:** 2 (Upx Motors + Clínica Mais Saúde)
- **MRR efetivo:** R$ 694,00
- **Clientes USANDO (≥ 1 conversa):** 0 (o usuário com 54 conversas é um alias interno do founder)
- **Cancelados confirmados:** 3 (Comercio Portões, Papel na parede, Walmarks)
- **Inadimplente:** 1 (walmarks.ecom past_due)

### Conversão real do funil
| Etapa | n | Taxa |
|---|---|---|
| Signups | 9 (excluindo testes/aliases) | 100% |
| Completaram wizard de ativação (`activated_at` preenchido) | 4 | 44% |
| Atualmente em status `active` | 2 | 22% |
| Tiveram pelo menos 1 conversa real | **0** | **0%** |

**Diagnóstico:** o gargalo NÃO é signup→ativação (44%). É **ativação→uso (0%)**. Cliente paga, configura wizard, e o bot nunca recebe mensagem.

### Hipóteses sobre "ativam mas não usam"

A. **WhatsApp Business Manager nunca foi conectado de verdade.** O wizard marca `activated_at` baseado em flags do banco, mas a conexão Meta (token, phone_number_id) pode estar incompleta. SQL diagnóstico em apêndice.

B. **Cliente não tem fluxo de leads no número.** Mesmo configurado, se o número não receber mensagens, não há conversa. Não é problema de produto, é de marketing do cliente.

C. **Cliente pausou o bot.** `bot_enabled=false` no client_settings.

D. **Bug no roteamento de mensagens recebidas.** Webhook Meta processa, mas algo trava antes de chamar Anthropic ou de salvar em `conversation_logs`.

Confirmação: rodar SQL diagnóstico (apêndice) → bate hipótese vs realidade.

---

## 2. Mudança de estratégia (v2.0 → v2.1)

### O que cancelamos do v2.0

| Item v2.0 | Status v2.1 | Razão |
|---|---|---|
| Comissão 30%→35% imediata | **Adiado pra mês 3+** | Sem clientes-base, comissão não atrai parceiro |
| Recrutar 10 parceiros piloto Sem 3 | **Adiado pra mês 4+** | Parceiro vai fechar cliente que não vai ativar — queima reputação |
| Lite tier R$67 mês 2 | **Adiado pra mês 6+** | Pricing é o último problema. Primeiro, ATIVAÇÃO. |
| Free tier mês 3 | **Adiado pra mês 9+** | Idem |
| LATAM expansion mês 4 | **Adiado pra mês 12+** | Sem PMF BR, LATAM é loucura |
| Annual prepay 30% off | **Adiado pra mês 2** | Só faz sentido pra clientes que JÁ usam |
| Voice Calling Gupshup | **Adiado pra mês 12+** | Diferencial sem produto base é enfeite |
| Marketing R$5K/m | **Pausado** | Cada signup novo é dinheiro queimado se conversão pra USO é 0% |

### O que fica e ganha urgência

1. **Gupshup Embedded Signup** — quando aprovação cair, é a primeira coisa a entrar (reduz fricção de WhatsApp, hipótese A).
2. **Wizard instrumentation** — saber EXATAMENTE em que step cada cliente para. Não dá pra fixar caixa preta.
3. **White-glove dos 2 clientes existentes** — Upx Motors e Clínica Mais Saúde precisam de ativação manual com supervisão direta do founder.
4. **D+1 D+3 D+5 nudge sequence** — se cliente não tem conversa em 1 dia, e-mail. 3 dias, WhatsApp do founder. 5 dias, oferta de extensão de trial + ajuda manual.

---

## 3. Roadmap revisado (90 dias)

### Mês 1 — "Fix the Leak"

**Semana 1 (esta semana):**
- ☐ White-glove os 2 pagantes atuais (founder contacts diretamente)
- ☐ Cleanup banco (apagar/arquivar dados de teste — SQL pronto no apêndice)
- ☐ Diagnosticar tecnicamente por que ativam-mas-não-usam (SQL diagnóstico no apêndice)
- ☐ Instrumentar wizard: gravar `wizard_step_completed` por step pra ter dados de drop-off
- ☐ Endpoint admin `POST /admin/trial-extend` pra estender trial sem mexer no Stripe
- ☐ E-mail D+1 automático: "Vimos que você ainda não testou o bot — precisa de ajuda?"

**Semana 2:**
- ☐ Quando Gupshup aprovar, ativar BSP em modo dev primeiro (validar com seu próprio número)
- ☐ Construir endpoint `POST /admin/manual-onboarding` pra founder configurar bot DOR cliente sem wizard
- ☐ Investigar webhook Meta: pra Upx Motors e Clínica, tentou processar alguma mensagem? Logs Cloudflare.
- ☐ Se bug: corrigir. Se UX: simplificar wizard.

**Semana 3:**
- ☐ Ativação manual (white-glove) dos 4 clientes mais quentes (incluindo recuperar walmarks past_due se possível)
- ☐ Definir 3 KPIs operacionais que rodam em snapshot diário: clientes_ativos, conversas_hoje, novos_signups
- ☐ Dashboard interno (admin endpoint `/admin/funnel-diagnostic`) que mostra drop-off por step

**Semana 4 — Decision gate M1:**

Critérios de "saúde":
- [ ] **≥ 5 clientes pagantes com ≥ 5 conversas reais cada nos últimos 7 dias** (PMF mínimo)
- [ ] **Conversão wizard→primeira conversa ≥ 50%**
- [ ] **0 bugs críticos no wizard** confirmados via instrumentation

→ **3/3:** mês 2 inicia aquisição (orgânica primeiro)
→ **2/3:** mais 30 dias de iteração de produto antes de aquisição
→ **0-1/3:** revisar premissa de produto. Talvez precise de pivot UX maior.

### Mês 2 — "10 Real Customers"

**Se decision gate M1 passou:**
- Aquisição orgânica: 3 posts de blog/semana otimizados pra long-tail SEO ("chatbot whatsapp pizzaria", "bot atendimento clínica", etc — específico por nicho)
- Outreach manual: 30 mensagens/semana via LinkedIn pra empresários BR que postam sobre WhatsApp/atendimento
- **Sem mídia paga ainda.** Tráfego orgânico/manual valida funil sem queimar caixa.

**Métricas mês 2:**
- 10 clientes pagantes usando ≥ 5x/semana
- MRR ≥ R$ 2.500
- Conversão signup→primeira conversa ≥ 60%
- Churn mês 1 ≤ 20% (alto mas tolerável em validação)

### Mês 3 — "Validate Channel"

- Comissão parceiro sobe pra 35% (1 linha de código, mas só agora)
- Recrutar 3 parceiros piloto (não 10) — qualidade > quantidade
- Cada parceiro recebe 30 min de onboarding direto + 1 cliente seu pra validar processo

**Métricas mês 3:**
- 25 clientes pagantes usando regularmente
- 3 parceiros ativos com ≥ 1 cliente cada
- MRR ≥ R$ 6.000
- Churn mês 2 ≤ 12%

---

## 4. Roadmap M4-M12 (resumido)

| Mês | Foco | Métricas-alvo cumulativas |
|---|---|---|
| M4-M5 | Annual prepay + content marketing R$1-2K/m | 50 clientes / R$12K MRR / 8 parceiros |
| M6 | Mídia paga R$3-5K/m + LATAM research | 80 clientes / R$20K MRR |
| M7-M9 | LATAM soft launch México | 130 clientes / R$32K MRR |
| M10-M12 | Lite tier OU Voice Calling (escolher 1) | **Goal:** 200 clientes / R$45K MRR / 15 parceiros |

**North Star v2.1 (12 meses):** 200 clientes USANDO o bot, R$45K MRR, 30% via canal parceiro. (Reduzido vs v2.0 que tinha 300/R$60K — porque agora a base é validar produto antes de escalar.)

---

## 5. Métricas de saúde (semanais)

### Norte
- **Clientes USANDO** (≥ 1 conversa últimos 7d) — métrica única mais importante
- **MRR efetivo** — só conta quem está active + plano pago
- **Crescimento usuários ativos MoM** — alvo: ≥ 20%/mês primeiros 6 meses

### Funil (instrumentado pós-Sem 1)
- Visitor → Signup
- Signup → Wizard step 1 completo
- Step 1 → Step 2 → Step 3 → activated_at
- Activated → primeira conversa
- Primeira conversa → 7 dias usando

### Operacionais
- Drop-off por step do wizard (NOVO via instrumentation)
- Tempo médio do step "configurar WhatsApp" (NOVO)
- % clientes que ativaram mas não usaram em 7d (NOVO — alvo: ≤ 20%)

---

## 6. Riscos atualizados

| Risco | Prob | Impacto | Status v2.1 |
|---|---|---|---|
| Os 2 pagantes atuais não engajam → cancelam esta semana | **Alta** | Alto | white-glove urgente |
| Wizard tem bug que impede uso real → corrigir leva semanas | Média | Crítico | instrumentation primeiro |
| Anthropic preço sobe | Baixa | Alto | já compensado por Haiku/caching |
| Concorrente local domina nicho específico | Média | Médio | nicho-foco no marketing M2+ |
| Founder burnout (este projeto + DataEx full-time) | **Alta** | Crítico | reduzir escopo: v2.1 é foco-em-1-coisa-só |

---

## 7. Apêndice — SQLs operacionais

### A. Diagnóstico técnico dos 2 pagantes (rodar AGORA)

```sql
SELECT
  c.company_name,
  c.status,
  c.plan_code,
  c.activated_at::timestamp(0) AS ativou_em,
  cs.whatsapp_display_number AS num_configurado,
  cs.bot_enabled,
  cs.api_key_masked IS NOT NULL AS tem_bundle,
  LENGTH(COALESCE(cs.api_key_masked, '')) AS bundle_size,
  cs.ai_msgs_used,
  cs.ai_msgs_limit,
  CASE
    WHEN cs.api_key_masked IS NULL OR cs.api_key_masked = '' THEN 'SEM_BUNDLE'
    WHEN cs.api_key_masked NOT LIKE '%cipher%' THEN 'BUNDLE_INVALIDO'
    WHEN cs.whatsapp_display_number IS NULL OR cs.whatsapp_display_number = '' THEN 'SEM_NUM_WHATSAPP'
    WHEN cs.bot_enabled = false THEN 'BOT_PAUSADO'
    ELSE 'OK_TECNICAMENTE'
  END AS diagnostico
FROM customers c
JOIN client_settings cs ON cs.customer_id = c.id
WHERE c.id IN (
  'ecfa9df7-050b-49b8-9f75-efe4b9e56d2a',
  '9eef255a-a274-4363-b04e-755587da6244'
);
```

### B. Cleanup do banco (rodar quando puder)

```sql
-- 1. Listar pra confirmar
SELECT u.email, c.id, c.created_at::date, c.status
FROM customers c JOIN auth.users u ON u.id = c.user_id
WHERE u.email ILIKE '%test%'
   OR u.email ILIKE '%mailinator%'
   OR u.email ILIKE '%example%'
   OR u.email ILIKE '%mb-test%'
   OR u.email ILIKE '%mercabot-test%'
   OR u.email ILIKE 'thiago.oliveira.comp+%'
   OR u.email ILIKE 'thiago+%@mercabot%'
   OR u.email ILIKE 'qa.unknown%'
   OR u.email ILIKE 'cliente.qa%'
   OR u.email ILIKE 'cliente.teste%'
   OR u.email ILIKE 'naoexiste%'
   OR u.email = 'anselmothiago987546@gmail.com'
   OR u.email = 'thiago.anselmo@outlook.com'
ORDER BY c.created_at DESC;

-- 2. Após confirmar, delete em cascata (CUIDADO):
-- BEGIN;
-- DELETE FROM customers c USING auth.users u
-- WHERE u.id = c.user_id
--   AND (... mesmas condições ...);
-- COMMIT;
```

### C. Snapshot diário pós-cleanup (rodar todo dia 9:00)

```sql
SELECT
  COUNT(*) FILTER (WHERE status IN ('active','trial','trialing')) AS ativos,
  COUNT(*) FILTER (WHERE status = 'active') AS pagantes_efetivos,
  COUNT(*) FILTER (WHERE activated_at IS NOT NULL) AS ativaram_wizard,
  (SELECT COUNT(DISTINCT customer_id)
   FROM conversation_logs
   WHERE created_at >= NOW() - INTERVAL '7 days') AS usando_bot_7d
FROM customers
WHERE created_at >= NOW() - INTERVAL '90 days';
```

---

## 8. Decisão de hoje

**Foco autônomo (sem cliente):**
- ✅ Documentar realidade (este doc v2.1)
- ✅ SQL cleanup pronto
- ☐ Instrumentation wizard (PR seguinte)
- ☐ Endpoint admin trial-extend (PR seguinte)
- ☐ E-mail nudge D+1/D+3/D+5 (PR seguinte)

**Foco com cliente (quando founder puder):**
- ☐ Ligar/WhatsApp pessoal Upx Motors
- ☐ Ligar/WhatsApp pessoal Clínica Mais Saúde
- ☐ Documentar o que travou em cada um (pra virar backlog UX)

**Tudo o resto (marketing, parceiros, pricing) está congelado até o decision gate M1.**

---

**Mudanças desta versão (v2.1 vs v2.0):**
- Baseline real substituiu números otimistas (R$5.225 → R$694 efetivo)
- Marketing/parceiros/free tier/LATAM/voice TODOS adiados
- Foco único: produto-PMF antes de qualquer crescimento
- Decision gate M1 endurecido: 5 clientes USANDO, não só "ativados"
- Cronograma 90d redesenhado em torno de "fix the leak" + "10 real customers"
- North Star 12m reduzido: 200 clientes (vs 300) — prudente
