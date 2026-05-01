# Cenário C v2 — Plano Executável (BR + LATAM, 12 meses)

**Versão:** 2.0 · **Atualizado:** maio/2026 · **Owner:** Thiago (Founder)
**Status:** Baseline pós-PR #217 (Gupshup ISV scaffold pronto, aguardando aprovação)

---

## TL;DR

A migração de 360Dialog Partner (R$2.700/m fixo) → Gupshup ISV (R$0 fixo) muda a estratégia de "crescer com cautela pra cobrir BSP" para **"crescer agressivo desde o primeiro cliente"**. Cada cliente Starter agora dá ~R$169 líquido/mês (margem 86%) em vez de ~R$60. Isso libera 8 alavancas táticas, das quais priorizamos 4 nos próximos 90 dias:

1. **Embedded signup Gupshup** — corta onboarding de 1-3 dias para 5 min. Conversão signup→ativação alvo: 30% → 70%.
2. **Comissão parceiro 30% → 35%** (1 linha de código, alavanca de aquisição).
3. **Annual prepay 30% off** — trava CAC payback, melhora caixa.
4. **Recrutamento parceiro piloto** (5-10 agências) — destrava receita escalável.

**North Star de 12 meses:** chegar a **300 clientes ativos** e **40% do MRR via canal parceiro**, com margem operacional positiva todos os meses.

---

## 1. Estado atual (baseline maio/2026)

| Métrica | Valor | Fonte |
|---|---|---|
| Clientes ativos pagantes | (preencher) | Supabase `customers WHERE status='active'` |
| MRR atual | R$ (preencher) | Soma `PLAN_MRR_BRL_CENTS` por status active |
| CAC médio | (não medido) | TODO instrumentar |
| Churn mensal | (não medido) | TODO instrumentar |
| Conversão signup → ativação | ~30% (estimado) | Comparar `auth.users.created_at` vs `customers.activated_at` |
| Tempo médio onboarding | 1-3 dias | Hipótese — Meta Business Manager |
| Custo de IA por reply | R$ 0,011 | Pós PR #211 (Haiku+caching) |
| Margem Starter (R$197) | ~86% líquido | R$169 após Anthropic+BSP+Stripe |
| Margem Pro (R$497) | ~88% líquido | R$436 após custos |
| Comissão parceiro | 30% | `COMMISSION_RATE_DEFAULT` |

**Validação dia 1 deste plano:** rodar SQL no Supabase Studio para preencher os números reais e versionar como baseline.

---

## 2. Pilares estratégicos

### Pilar A — Aquisição sem fricção
Eliminar tudo que separa "lead clica em ad" de "bot respondendo no WhatsApp dele". Cada hora a mais nesse caminho derruba conversão exponencialmente.

### Pilar B — Distribuição via parceiros
Parceiros (agências, consultores) já têm relacionamento com PMEs. Quanto melhor a economia da revenda, mais agressivos eles vendem.

### Pilar C — Margem cirúrgica em escala
Anthropic vai cobrar mais com tempo, Meta sobe rate cards, Gupshup pode mudar markup. Manter margem ≥80% requer otimização contínua de custo IA, batching, e tier de uso.

### Pilar D — Diferenciação técnica defensável
Concorrência no BR é numerosa mas técnica fraca (a maioria são "bot scripts" sem IA real). MercaBot tem Anthropic Claude + roteamento por complexidade. Próxima fronteira: voz (Gupshup Calling API).

---

## 3. Roadmap de 12 meses (8 fases priorizadas)

| # | Fase | Pilar | Prioridade | Janela |
|---|---|---|---|---|
| **4** | Embedded Signup Gupshup (UI + backend) | A | **P0** | M1 |
| **6** | Comissão 30% → 35% | B | **P0** | M1 |
| **5C** | Annual prepay 30% off | C | **P0** | M1 |
| **9** | Recrutamento 10 parceiros piloto | B | **P0** | M1-M2 |
| **5A** | Plano "Lite" R$67/m | A,C | **P1** | M2-M3 |
| **5B** | Free tier 300 msg/m branded | A | **P1** | M3-M4 |
| **8** | LATAM expansion (MX, AR, CO) | A | **P2** | M4-M6 |
| **7** | Voice Calling diferencial | D | **P2** | M6-M9 |

**P0 = obrigatório nos primeiros 30 dias. P1 = depende de validação P0. P2 = só após base sólida.**

---

## 4. Cronograma 90 dias (detalhado)

### Semana 1 — "Plug Gupshup" (gatilho: e-mail aprovação ISV)

**Trabalho técnico (Thiago + Claude Code, 8-12h):**
- Setar secrets `GUPSHUP_PARTNER_API_KEY`, `GUPSHUP_APP_API_KEY`
- `wrangler.toml`: `GUPSHUP_ENABLED=true`, `GUPSHUP_APP_NAME`, `GUPSHUP_SOURCE_PHONE`
- Configurar callback URL no Gupshup partner portal
- Validar inbound + outbound end-to-end com seu número pessoal
- Mudar `COMMISSION_RATE_DEFAULT` de 0.30 para 0.35 + atualizar copy do painel-parceiro
- Adicionar campo `billing_period` na tela de checkout: "Mensal R$197 / Anual R$1.654 (-30%)" — Stripe já suporta os dois price IDs

**Trabalho de produto (Thiago, 2-3h):**
- Atualizar landing page: badge "Setup em 5 minutos via WhatsApp Embedded Signup"
- Rebrandar fluxo de cadastro: passo "Conectar WhatsApp" passa a usar embedded signup como CTA principal, Meta Direct fica em "Avançado"

**Métricas a observar:**
- Tempo médio de signup → primeira mensagem do bot (alvo: < 10 min)
- Taxa de erro no embedded signup (alvo: < 5%)

### Semana 2 — "Embedded Signup Production-Ready"

**Trabalho técnico (8-10h):**
- Endpoint `POST /account/provision-gupshup` que chama Partner API: Create App → Generate Embed Link → retorna URL
- Componente UI no painel-cliente: tela "Conectar WhatsApp" com iframe/redirect pro embedded signup
- Webhook de callback: quando Gupshup notifica que app está live, gravar `client_settings.channel.gupshup = {app_name, app_id, api_key}` (encriptado)
- Roteamento multi-tenant em `processGupshupPayload`: lookup customer pelo `payload.app` em `client_settings`

**Métricas:**
- 5 clientes piloto rodando 100% via Gupshup sem suporte humano
- Zero incidentes em produção (Meta Direct continua intacto)

### Semana 3 — "Partner Pilot Cohort"

**Trabalho comercial (Thiago, 8-12h):**
- Lista alvo: 30 agências/consultores BR (search no LinkedIn, indicações)
- Pitch deck atualizado com nova economia: "35% recorrente sem teto, embedded signup, R$0 setup pro seu cliente"
- 10 calls de 30 min com lista alvo
- Goal: 5 parceiros assinados (cadastrados via `/cadastro?ref=...`)

**Trabalho técnico (3-4h):**
- Dashboard parceiro: adicionar widget "Sua próxima comissão estimada" baseado em clientes ativos × MRR × 35%
- E-mail automático de boas-vindas pro parceiro novo (Resend) com link do guia + página /comissões

**Métricas:**
- 5 parceiros ativos
- ≥1 cliente fechado por parceiro (ou compromisso de fechar em 30d)

### Semana 4 — "Conversion Audit + 5C Annual"

**Trabalho técnico (4-6h):**
- Implementar redirect Stripe pra annual prepay: cliente escolhe "Pagar 1 ano à vista" → checkout Stripe com price_anual_USD
- Banner no painel: "Economize 30% pagando o ano inteiro" (target: clientes em status `active` há > 30d)
- Email Resend: "X clientes do MercaBot pagaram à vista esse mês — economize 2 meses"

**Trabalho de análise (Thiago, 2-3h):**
- Auditar funil: signup → checkout → ativação → primeiro mês ativo
- Identificar maior ponto de drop-off (provavelmente checkout ou ativação)
- Documentar achados em `docs/Funnel-Audit-M1.md`

**Métricas mês 1 (decision gate):**
- Conversão signup → ativação ≥ 60% (vs 30% baseline)
- ≥ 5 parceiros ativos com ≥ 1 cliente cada
- ≥ 10% dos clientes novos optaram por annual prepay
- MRR cresceu ≥ 15% vs início do mês

**Decision gate semana 4:** se 3+ métricas atingidas, **pisar fundo no mês 2** (ativar Lite tier + dobrar marketing). Se < 3, **investigar antes de escalar**.

### Mês 2 — "Lite Tier + Marketing Push"

**Se decision gate passou:**
- **Lite tier R$67/m** (500 msg/m, sem followups, sem advanced ops). Implementar `plan_code='lite'` em `getPlanDefinition` + price ID Stripe.
- **Investimento marketing:** R$3-5K em Google Ads + Meta Ads BR (palavras-chave: "chatbot whatsapp", "atendente automático", "ia para whatsapp")
- **Conteúdo:** 4 posts blog/mês otimizados pra SEO ("como integrar IA no WhatsApp", "chatbot vs atendente humano custos")
- **Refinement parceiros:** dos 5 piloto, identificar top 2 e oferecer **comissão tier 40%** acima de 10 clientes

**Métricas mês 2:**
- 30+ clientes ativos pagantes (cumulativo)
- MRR ≥ R$5.000
- 10+ parceiros cadastrados (5 ativos + 5 novos)

### Mês 3 — "Free Tier Pilot + LATAM Research"

**Free tier (5B):**
- Implementar plano `'free'` (300 msg/m, branded, sem support)
- Limitação técnica: bot anexa rodapé "Atendido por MercaBot · mercabot.com.br" nas respostas
- Goal: usar como motor viral (10% dos free convertem em pago em 90d)

**LATAM research (Thiago, 4-6h):**
- Validar pricing local: R$ vs MXN vs ARS (dolarizar?)
- Testar Gupshup performance em números MX, AR
- Avaliar legal: WhatsApp Business policy por país, LGPD-equivalentes

**Métricas mês 3:**
- 60+ clientes ativos
- 100+ free tier signups
- MRR ≥ R$10.000
- Churn mensal < 8%

---

## 5. Roadmap M4-M12 (visão alta)

| Mês | Foco | Métricas-alvo (cumulativas) |
|---|---|---|
| M4 | LATAM soft launch (México) | 100 clientes / R$18K MRR / 15 parceiros |
| M5 | Otimização conversão + Lite scaling | 150 clientes / R$25K MRR |
| M6 | LATAM expansão (AR, CO) + Voice POC | 200 clientes / R$35K MRR / 25 parceiros |
| M9 | Voice Calling em produção (Pro tier) | 250 clientes / R$50K MRR |
| M12 | **Goal final**: liderança SMB BR + presença LATAM | **300 clientes / R$60K MRR / 40+ parceiros** |

---

## 6. Métricas de saúde (acompanhar semanalmente)

### Norte (output)
- **MRR** — soma plano × clientes ativos
- **Crescimento MoM** — alvo: ≥ 15%/mês primeiros 6 meses
- **Churn voluntário** — alvo: ≤ 5%/m (saudável SaaS BR)
- **NRR** (Net Revenue Retention) — alvo: ≥ 105%

### Funil (input)
- **Visitor → Signup** — alvo: ≥ 5%
- **Signup → Ativação** — alvo: ≥ 70% (pós Gupshup)
- **Ativação → Mês 2 ativo** — alvo: ≥ 85%
- **CAC payback** — alvo: ≤ 3 meses (annual prepay puxa pra 1 mês)

### Operacionais
- **Tempo médio resposta IA** — alvo: < 5s p95
- **Tickets de suporte / cliente / mês** — alvo: ≤ 0.5
- **Custo IA / cliente / mês** — alvo: ≤ R$15

### Canal parceiro
- **% MRR via parceiro** — alvo M3: 20%, M6: 35%, M12: 40%
- **Parceiros ativos (≥ 1 cliente)** — alvo M3: 8, M6: 20, M12: 35
- **Receita média por parceiro** — alvo M12: R$1.500/m líquido

---

## 7. Riscos e mitigação

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Gupshup atrasa aprovação ISV | Baixa (Meta Tech Provider já ok) | Alto | Worker continua via Meta Direct sem perda |
| Anthropic sobe preço Haiku/Sonnet | Média | Alto | Diversificar: avaliar GPT-4o mini ou Gemini Flash em paralelo (custo menor, qualidade similar pra português BR) |
| Concorrente lança preço agressivo (free tier) | Alta | Médio | Diferencial: qualidade IA + parceiros. Free tier nosso (5B) cobre o flanco. |
| Free tier abusado por spam | Alta | Médio | Rate limit por número origem + heurística anti-spam baseada em conteúdo (Anthropic moderação) |
| Parceiro vende mas não dá suporte | Média | Médio | Tier 35%/40% só renova se NPS médio dos clientes do parceiro ≥ 7 |
| Pricing mais baixo atrai cliente ruim | Alta | Médio | Lite tier não tem suporte humano nem features avançadas — segregação clara |
| LATAM expansion sem suporte local | Média | Alto | Soft launch México primeiro, contratar 1 freelance ES nativo antes de expandir AR/CO |
| Churn alto após embedded signup (cliente facilita demais e desiste) | Média | Médio | Onboarding wizard + autopilot IA forte primeira semana |

---

## 8. Necessidades de recurso

### Capital (12 meses)
- **Marketing:** R$5K/m médio = R$60K/ano
- **Anthropic:** crescente, ~R$2-5K/m no fim do ano
- **Stripe fees:** ~5% do MRR
- **Domínio + Cloudflare + Supabase:** R$200-500/m
- **Freelance suporte ES (a partir M5):** R$2K/m
- **Total estimado capital de giro:** R$80-100K

### Pessoas
- **M1-M3:** apenas founder + Claude Code
- **M4-M6:** considerar 1 freelance suporte/CS BR (R$3K/m)
- **M6+:** avaliar 1 dev contratado se backlog de produto crescer

### Ferramentas
- Resend (já): emails transacionais
- Plausible (já): analytics privacy-friendly
- A adicionar: **Mixpanel** ou **PostHog** (eventos de funil) — R$0 até 1M eventos/m
- A adicionar: **Linear** ou **GitHub Projects** (gestão de roadmap)

---

## 9. Próximas 5 ações concretas

| # | Ação | Quando | Quem | Prazo |
|---|---|---|---|---|
| 1 | Rodar SQL no Supabase pra preencher baseline (seção 1) | Hoje | Thiago | 30 min |
| 2 | Aprovar este plano (ou ajustar) e versionar v2.0 | Hoje | Thiago | 15 min |
| 3 | Aguardar e-mail Gupshup ISV (esperado em 1-3 dias) | Esta semana | Gupshup → Thiago | passivo |
| 4 | Lista LinkedIn de 30 agências/consultores BR (alvo Sem 3) | Esta semana | Thiago | 2-3h |
| 5 | Pitch deck v2 com nova economia + 35% comissão | Esta semana | Thiago + Claude | 3-4h |

---

## 10. Decision gates explícitos

**Gate M1 (fim semana 4):**
- ≥ 60% conversão signup→ativação **E**
- ≥ 5 parceiros ativos **E**
- MRR cresceu ≥ 15% no mês

→ **Sim:** mês 2 vai com força (Lite tier + R$5K marketing)
→ **Não:** investigar funil, não escalar capital

**Gate M3 (fim mês 3):**
- ≥ 60 clientes ativos **E**
- Churn ≤ 8% **E**
- ≥ 1 parceiro com ≥ 5 clientes (validação canal)

→ **Sim:** ativar Free tier + soft launch LATAM
→ **Não:** dobrar foco em retenção e qualidade BR

**Gate M6 (fim mês 6):**
- MRR ≥ R$30K **E**
- ≥ 30% MRR via canal parceiro

→ **Sim:** investir Voice Calling + considerar contratação
→ **Não:** otimizar antes de adicionar complexidade

---

## Apêndice — Bases dos números

**Margem Starter R$197/m (referência):**
- Receita: 197,00
- Anthropic (1000 replies/m × R$0,011): 11,00
- Gupshup BSP markup (1000 msgs × R$0,005): 5,00
- Meta conversation fees (~50 conv × R$0,04): 2,00
- Stripe fee (4,99% + R$0,39): 10,22
- **Custo total:** 28,22
- **Líquido:** R$ 168,78 (85,7% margem)

**Cálculo de break-even pré vs pós-Gupshup:**
- Pré (360 Partner R$2.700/m fixo): 2.700 / 168 = **17 clientes Starter pra zerar**
- Pós (Gupshup R$0 fixo): **0 clientes** — cada um é lucrativo desde o dia 1

**ROI projetado mês 12:**
- 300 clientes médio R$300/m blended = R$90K MRR
- Custo direto (28% × MRR): ~R$25K/m
- Líquido operacional: ~R$65K/m
- Marketing+pessoas+ferramentas: ~R$15K/m
- **Lucro bruto operacional: ~R$50K/m no mês 12**

---

**Próxima revisão deste plano:** ao final de cada decision gate (mês 1, 3, 6, 12). Atualizar versão (v2.1, v2.2…) e arquivar diff de mudanças no rodapé.

**Mudanças desta versão (v2.0 vs v1):**
- Pivot 360Dialog → Gupshup ISV (mudou economia inteira)
- Comissão 30% → 35% (mais agressivo)
- Adicionado decision gates explícitos
- Cronograma de 90 dias detalhado por semana
- Métricas operacionais quantificadas
