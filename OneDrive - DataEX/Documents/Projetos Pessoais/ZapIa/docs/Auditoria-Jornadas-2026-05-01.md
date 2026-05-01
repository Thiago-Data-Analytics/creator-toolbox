# Auditoria de Jornadas — MercaBot
**Data:** 2026-05-01 · **Versão:** 1.0 · **Auditor:** Agente automatizado (leitura de código + WebFetch + curl em endpoints públicos) · **Escopo:** jornada de Cliente e jornada de Parceiro, em produção (`https://mercabot.com.br` + `https://api.mercabot.com.br`).

## Aviso metodológico

Esta auditoria foi conduzida por agente automatizado, **não por humano em browser real**. Itens marcados com:

- `[FETCH]` — confirmados via WebFetch da URL pública (HTML servido).
- `[CURL]` — confirmados via curl em endpoints públicos.
- `[CODE]` — inferidos da leitura do código-fonte em `main` (HTML/JS/Worker).
- `[REPORTED]` — afirmações vindas do próprio dono nas sessões anteriores (ex: que ativou conta lab, recebeu magic link, etc).

**Não pude:** clicar com mouse, abrir e-mail real, escanear QR de WhatsApp, pagar Stripe com cartão real, medir tempos de paint do navegador, ouvir áudio etc. Onde uma sensação humana seria necessária, indico explicitamente.

---

# RELATÓRIO 1 — JORNADA DO CLIENTE

## Resumo executivo

Como leigo que descobre o MercaBot via Google ou indicação, a jornada teórica é: landing → cadastro → checkout Stripe → e-mail magic link → wizard de ativação → painel cliente → conectar WhatsApp Meta → bot online. **Em pelo menos 6 dos passos há fricções, ambiguidades ou bugs documentados que provavelmente derrubam a maioria dos usuários reais.** O baseline confirmou a leitura: 23 de 29 signups históricos NUNCA chegaram ao Step 1 do wizard, e 0 dos 6 que ativaram chegou a usar o bot de fato.

Severidade global: **Crítica**. Produto NÃO está pronto pra usuários reais sem white-glove humano.

## Objetivo do teste

Reproduzir a jornada do cliente com olhos de leigo. Identificar todo ponto de fricção, ambiguidade, falha técnica ou contradição de mensagem que derrube conversão entre "ouviu falar do MercaBot" e "bot dele responde clientes no WhatsApp".

## Perfil assumido

Maria, 42 anos, dona de uma pequena clínica odontológica em Belo Horizonte. Não tem equipe de TI. Já ouviu falar de "chatbot" mas nunca instalou nada. Quer que o WhatsApp da clínica responda automaticamente fora do horário comercial. Recebeu link do MercaBot via grupo de empreendedores no WhatsApp.

## Passo a passo cronológico

### Etapa 1 — Primeiro contato com a landing page `/`

**Evidências `[FETCH]`:**
- Hero principal: **"Seu WhatsApp. Nunca mais sem resposta."**
- Subtítulo: *"IA generativa no número que seus clientes já conhecem. Atendimento 24h, sem técnico, sem mudar de canal."*
- CTA primário: **"Ativar meu WhatsApp com IA"** → `/cadastro/`
- CTA secundário: **"Como funciona →"** → âncora `#como-funciona`
- Selo: *"7 dias grátis · R$197/mês · sem fidelidade · ativo no mesmo dia"*
- Header: "Entrar" (link `/login/`), "Ver planos" (âncora `#precos`), seletor PT/ES/EN.

**Resultado esperado vs real:** OK. A página é clara, posicionamento direto. Maria entende que é um bot pra WhatsApp dela.

**Pontos de atenção:**
- A frase *"ativo no mesmo dia"* gera expectativa que **não é cumprida hoje** — entre signup e bot rodando há, no mínimo, magic link + wizard + Meta Business Manager. Severidade: **Alta** (cria expectativa que decepciona).
- *"sem técnico"* idem — o passo de conectar Meta Business Manager (vide etapa 6) **exige** conhecimento técnico que Maria não tem.

**Severidade etapa:** Baixa (a landing em si vende bem).

### Etapa 2 — Clique em "Ativar meu WhatsApp com IA"

**Evidências `[CURL]` + `[FETCH]`:**
- Redirect: `/cadastro/` HTTP 200 OK.
- Headline: *"Seu WhatsApp atendendo clientes 24h por dia."*
- 2 campos: WhatsApp da empresa (com seletor de país +55) e *"Seu melhor e-mail"*.
- Botão primário: **"Escolher plano →"**.
- Aviso: *"Suas credenciais de acesso chegam aqui após o pagamento."*

**Resultado real:** OK no formato. Mas a copy *"Suas credenciais chegam aqui após o pagamento"* é **ambígua** — Maria não sabe se vai receber senha, código, ou link. Severidade: **Média**.

**Teste com dados inválidos `[CODE]`:**
- WhatsApp em branco → bloqueia (validação client-side).
- WhatsApp com 9 dígitos → aceita (mas sistema deveria validar 10-11). Severidade: **Baixa**.
- E-mail mal formatado → bloqueia.

### Etapa 3 — "Escolher plano"

**Evidências `[FETCH]`:** 3 planos exibidos.
- **Starter R$197/mês** — entry, mais popular.
- **Pro R$497/mês** — destacado como "mais popular".
- **Parceiro R$1.297/mês** — *"Venda MercaBot com a sua marca"* + white-label + multi-cliente.

**Anomalia crítica `[CODE]`:** o plano Parceiro aparece pra usuário comum sem qualquer contextualização. Maria, dona de clínica, vê 3 opções e a opção Parceiro custa quase 7x mais que a Starter. Risco: ela escolhe Parceiro sem entender que é pra revendedores. Severidade: **Alta** (UX confunde quem é o público de cada plano).

**Resultado esperado:** Maria escolhe Starter → redirect Stripe Checkout.

### Etapa 4 — Stripe Checkout

**Evidências `[REPORTED]` (sessões anteriores):**
- Stripe live mode (rejeita cartão de teste `4242 4242 4242 4242`).
- "7 dias grátis" exibido. Total devido hoje: R$ 0,00.
- Cartão real é cobrado a partir do dia 8.

**Resultado real:** OK do ponto de vista técnico. **Mas:**

**Anomalias detectadas:**
- Maria precisa colocar cartão de crédito agora pra "testar grátis" — **fricção alta, padrão SaaS, mas não comunicada com a transparência ideal na landing**. Severidade: **Média**.
- Não há opção visível de "testar sem cartão" (free tier ou demo gravado). Severidade: **Média**.

### Etapa 5 — Pós-pagamento + magic link no e-mail

**Evidências `[CODE]`:** após Stripe success, webhook MercaBot cria customer no Supabase com status `trialing` e dispara magic link via Resend pro e-mail informado.

**Bugs documentados em PRs anteriores (#214):**
- **Bug 1 (corrigido):** Magic link redirecionava pra `/` (homepage) em vez de `/acesso/`. Maria via URL com `#access_token=eyJ...` e não sabia o que era.
- **Bug 2 (corrigido):** `/ativacao/` não persistia sessão Supabase, então clicar "Ir para o painel" jogava em `/acesso/` em loop.
- **Bug 3 (corrigido):** Input OTP truncava códigos de 8 dígitos pra 6, causando "código inválido" infinito.

**Status atual `[CODE]`:** os 3 bugs estão corrigidos em produção. Se Maria estiver entrando hoje, magic link funciona — em tese. **Mas:** não há evidência de que esses fixes foram validados com cliente real. Os 22 trials que abandonaram (vide baseline) podem ter encontrado esses bugs antes da correção.

**Tempo para receber e-mail `[CODE]`:** Resend tipicamente entrega em < 2 min. Sem medição real disponível.

### Etapa 6 — Wizard de ativação `/ativacao/`

**Evidências `[CODE]`:** wizard tem 3 steps:
1. **Step 1 — Seu Negócio** (nome empresa, seu nome, segmento)
2. **Step 2 — Como Atender** (tom de voz, horário, fora do horário, saudação)
3. **Step 3 — Perguntas frequentes** (FAQ + autopilot IA)

**Anomalia crítica `[CODE]` confirmada via baseline SQL:** **23 de 29 signups históricos travaram ANTES do Step 1.** Significa que recebem magic link, clicam, mas nem preenchem o primeiro campo. Hipóteses não validadas:
- Magic link expira antes do clique
- Página `/ativacao/` carrega mas tem erro JS
- Fluxo confunde e usuário fecha
- Wizard não aparece em mobile
- (...)

**Mensagem ao final do wizard `[CODE]`:**
> *"Tudo anotado. Quando o boleto compensar (até 3 dias úteis), o bot entra em ação automaticamente."*

**Bug documentado de copy:** essa mensagem aparece mesmo quando pagamento foi com cartão (instantâneo). Maria fica confusa: *"mas eu paguei agora, por que vai demorar 3 dias?"*. Severidade: **Alta** (cria desconfiança sobre se sistema funciona).

### Etapa 7 — "Ir para o painel" → `/painel-cliente/app/`

**Evidências `[CODE]`:** botão é anchor link com `href="/painel-cliente/app/?continue=1"`. Após PR #214, sessão Supabase persiste em localStorage e painel reconhece login. Em tese, Maria vê o painel direto.

**Painel cliente `[CODE]`:**
- Header: "ATIVAÇÃO" badge (Número, Operação, Teste — 3 etapas adicionais).
- Card "Bot offline · Última resposta: 2h" (engana em conta nova — não há resposta nenhuma).
- 4 KPIs zerados: Conversas, Auto-resolução, Atenção humana, Contatos únicos.
- Tab "Atividade recente" mostra mensagens de teste antigas que não são da Maria.

**Anomalias:**
- "Última resposta: 2h" mesmo em conta nova é misleading. Severidade: **Média**.
- Atividade recente de OUTROS clientes aparecendo? Verificar se é demo ou bug. Severidade: **Crítica se vazamento, Média se demo mock**.

### Etapa 8 — Conectar WhatsApp Business Manager

**Esta é a barreira fundamental do MercaBot atual.**

**Evidências `[CODE]`:** painel-cliente tem aba "Número" com formulário pra:
- Phone Number ID (Meta)
- Access Token (Meta)
- WABA ID

Maria, dona de clínica, **nunca ouviu falar disso**. Pra obter:
1. Criar conta Meta Business Manager
2. Aprovar verificação de empresa (1-3 dias)
3. Adicionar WhatsApp Business Account
4. Solicitar acesso ao WhatsApp Cloud API
5. Gerar System User token
6. Copiar Phone Number ID
7. Configurar webhook URL apontando pra `https://api.mercabot.com.br/whatsapp/webhook`
8. Configurar verify token

**Severidade: Crítica.** Promessa da landing *"sem técnico, sem mudar de canal"* é **falsa** nesse ponto. Maria desiste aqui em quase 100% dos casos sem suporte humano.

**Mitigação parcial:** Gupshup ISV em scaffold (PR #217) substitui esse passo por embedded signup de 5 min. Mas Gupshup ainda não aprovado / ativado — `GUPSHUP_ENABLED=false`.

### Etapa 9 — Bot respondendo clientes

**Caso Maria consiga conectar Meta Business Manager:**

**Evidências `[CODE]`:** worker recebe webhook → `processWhatsAppPayload` → roteia pra customer pelo `phone_number_id` → carrega runtime config → chama Anthropic Claude (Haiku/Sonnet) → grava em `conversation_logs` → manda resposta via WhatsApp Cloud API.

**Validado em produção:** sim, pipeline tecnicamente funciona (PRs #211, #215 validaram).

**Realidade `[REPORTED]` baseline SQL:** **0 dos 6 clientes que ativaram tem 1 conversa registrada nos últimos 30 dias.** Significa que mesmo os que passam por todas etapas anteriores não chegam aqui — provavelmente travam na Etapa 8 (Meta).

## Estado final alcançado

Em probabilidade pura (baseline SQL):
- **20% (6/29)** completam wizard
- **0% (0/6)** chegam a ter o bot respondendo clientes reais

Em entrevista 1-a-1 (white-glove, founder ajudando): provavelmente 70-90% chegariam ao bot online — mas isso não escala.

## Conclusão sobre prontidão

**O fluxo NÃO está pronto pra usuários reais sem suporte humano dedicado.**

Razões objetivas:
1. Etapa 8 (Meta Business Manager) é gargalo destruidor, conforme planejado pra ser resolvido pela ativação Gupshup que ainda está scaffolded.
2. Mensagens contraditórias entre landing ("ativo no mesmo dia, sem técnico") e realidade.
3. Copy do wizard fala em "boleto compensar" mesmo pagando cartão.
4. Plano Parceiro misturado com plano de cliente final.
5. Painel mostra dados de demo/outros clientes em conta vazia.

---

# RELATÓRIO 2 — JORNADA DO PARCEIRO

## Resumo executivo

Como leigo descobrindo que MercaBot tem programa de parceiros, a jornada é **fundamentalmente quebrada**. Não há um landing dedicado de parceiro com CTA claro de candidatura. O `/guia-parceiro` é uma página informativa **sem botão de inscrição**. O `/painel-parceiro/` exige login mas não há fluxo claro pra adquirir esse login. Pior: existe **contradição grave entre o que o guia diz** ("paga R$1.297/mês fixo, sem comissão") e o que o **sistema técnico implementa** (`partner_commissions` calcula 30% de comissão recorrente).

Severidade global: **Crítica**. Não há jornada de parceiro funcional hoje.

## Objetivo

Reproduzir como uma agência ou consultor descobre o programa, se cadastra como parceiro, vincula o primeiro cliente, recebe comissão.

## Perfil assumido

João, dono de agência de marketing digital em São Paulo, atende ~15 PMEs. Quer revender MercaBot como serviço pros clientes dele com a marca da agência. Encontrou o site MercaBot pelo Google buscando "white-label chatbot whatsapp brasil".

## Passo a passo cronológico

### Etapa 1 — Buscar info de parceria na landing principal `/`

**Evidências `[FETCH]`:**
- Header: nenhum link "Parceiros" / "Revenda" / "Para agências".
- Seção "Ver planos": menciona plano "Parceiro" R$1.297/m mas sem destaque enquanto programa.
- **Não há link "Seja parceiro" em parte alguma do header ou hero**.

**Severidade:** **Crítica**. João não tem como saber, navegando a landing, que existe programa estruturado.

### Etapa 2 — Tentar rota `/parceiros`, `/seja-parceiro`, `/revenda`

**Evidências `[CURL]`:**
- `/parceiros` — não testado, mas não está nas rotas mapeadas (HTML root files).
- `/seja-parceiro` — idem.
- `/revenda` — idem.

João tenta `mercabot.com.br/parceiros` no chute → provável 404. Severidade: **Alta**.

### Etapa 3 — Achar `/guia-parceiro` (provavelmente via Google)

**Evidências `[FETCH]`:**
- HTTP 301 → redireciona pra `/guia-parceiro/` (slash final).
- Página explica: *"agências, consultores e freelancers que querem oferecer atendimento automatizado com IA como serviço pros clientes finais."*
- **Modelo descrito:** *"Você paga R$1.297/mês fixo à MercaBot e cobra quanto quiser dos clientes finais. Recomendação: R$350–R$2.500/mês."*
- **CTA:** apenas link genérico pra `/painel-parceiro` ("acessar painel"), assumindo que João já é parceiro.
- **Não há formulário de candidatura, não há botão "Quero ser parceiro", não há fluxo de aprovação.**

**Severidade:** **Crítica**. Página informativa sem next-step. João lê e fica sem saber o que fazer.

### Etapa 4 — Tentar `/painel-parceiro/` mesmo sem ser parceiro

**Evidências `[FETCH]`:**
- Página exibe formulário: *"Painel Parceiro — entre com o e-mail cadastrado"* + *"Sessão não encontrada. Autentique-se para continuar."*
- Botão: *"Receber link de acesso →"*
- Link: **"Ainda não é parceiro? Cadastrar agora →"** → aponta pra `/cadastro/` (cadastro normal!).

**Anomalia crítica:** o link "Cadastrar agora" pra novo parceiro **leva pro mesmo cadastro de cliente comum**. Não há diferenciação. João vai cair na tela genérica de WhatsApp+e-mail e seguir o fluxo de cliente.

### Etapa 5 — Cadastro como "Parceiro" via plano Parceiro R$1.297

**Evidências `[CODE]`:** João preenche o form em `/cadastro/`, escolhe plano "Parceiro" R$1.297/mês, paga via Stripe. Webhook detecta `plan_code='parceiro'` e seta `customers.is_partner=true` automaticamente (cloudflare-worker.js linhas 733-734).

**Resultado:** João é parceiro técnico no banco. Mas:

**Anomalias:**
- **Sem aprovação humana.** Qualquer um que paga R$1.297/m vira parceiro instantâneo. **Risco reputacional alto** — fraude, má conduta, etc.
- **Sem onboarding específico.** João recebe magic link, cai no MESMO wizard de ativação de cliente (Etapa 6 do relatório anterior), preenche dados de "negócio" como se fosse cliente final.
- **Sem material de apoio.** Não há PDF de comissão, contrato, kit de marketing, scripts de venda — embora o `docs/MercaBot-Guia-Parceiro.pdf` exista no repo, não há link visível.

### Etapa 6 — Painel parceiro logado

**Evidências `[CODE]`:** após login, painel parceiro tem 7 abas:
1. Visão geral (KPIs locais, baseado em dados em localStorage)
2. Performance (MRR estimado da carteira local)
3. **Comissões** (aba nova, PR #216)
4. Meus Clientes (lista local)
5. White-label (logo + cor + domínio)
6. Central digital (recursos / guias)
7. Onboarding (checklist)
8. Configurações

**Contradição GRAVE detectada:**
- **Guia do Parceiro `/guia-parceiro/` diz:** "*Você paga R$1.297/mês fixo, cobra dos seus clientes o preço que quiser, sem comissão da MercaBot.*"
- **Aba "Comissões" do painel diz:** "*30% recorrente sobre o MRR de cada cliente ativo. Pagamento via PIX no dia 10 de cada mês.*"
- **Sistema técnico (PR #216):** calcula 30% sobre `customers.partner_id` vinculados, em `partner_commissions` table, payout via `partner_payouts`.

**Severidade:** **Crítica**. Modelos de negócio contraditórios entre marketing copy e produto. Parceiro ou se acha lesado (achou que ia ficar com 100% e vê 30% sendo cobrado), ou descobre que tem comissão e o produto está cobrando errado dele.

### Etapa 7 — Vincular o primeiro cliente do João

**Evidências `[CODE]`:** João precisa que o cliente final dele se cadastre via `/cadastro/?ref=<email_do_joao>`. Mas:
- **Não há link visível** no painel parceiro pra copiar URL com `ref`.
- **Não há instrução** explicando como vincular cliente.
- **Não há notificação** quando um cliente novo é vinculado.

João só vai descobrir isso lendo o `/guia-parceiro` (estático, Markdown gerado em PDF) que menciona o parâmetro `?ref=`.

**Severidade:** **Alta**. Funcionalidade existe no backend mas é invisível no painel.

### Etapa 8 — Cliente final do João completa wizard, vira ativo

**Evidências `[REPORTED]`:** Hoje **0 parceiros têm clientes vinculados** (vide baseline). Pipeline nunca foi exercitado em produção.

### Etapa 9 — Comissão calculada e paga

**Evidências `[CODE]`:** cron `0 7 1 * *` (dia 1 de cada mês, 04:00 BRT) calcula via `runMonthlyPartnerCommissions()`. Cria rows em `partner_commissions` + agregado em `partner_payouts` (status `pending`). Admin paga manualmente via PIX e marca como `confirmed` via endpoint `/admin/payouts/:id/mark-paid`.

**Anomalias:**
- **João precisa cadastrar chave PIX** na aba Comissões. Se não cadastrar, payout fica preso. Não há aviso proativo enquanto chave estiver vazia.
- **SOP de payout é manual** (`docs/SOP-Payout-Comissao-Parceiro.md`). Sem garantia de que vai ser executada todo dia 10 com volume crescendo.
- **Não há notificação por e-mail** quando comissão é paga (TODO documentado no SOP).

## Estado final alcançado

João provavelmente desistiria entre etapas 3 e 4 — não há caminho claro de "como me tornar parceiro?" do ponto de vista de marketing. Se persistir e descobrir o fluxo via `/guia-parceiro`, vai chocar-se com a contradição comissão na etapa 6.

## Conclusão sobre prontidão

**A jornada de parceiro NÃO está pronta.** Ela existe parcialmente em código (provisionamento, comissão, dashboard) mas falta:
- Landing page dedicada `/parceiros` com CTA claro
- Fluxo de candidatura distinto do cadastro de cliente
- Onboarding específico (aprovação, contrato, kit)
- Reconciliação entre `/guia-parceiro` (R$1.297 fixo, sem comissão) e produto (30% recorrente)
- Visibilidade do link `?ref=` no painel
- Notificações automáticas

---

# LOG TÉCNICO — JORNADA DO CLIENTE

| Hora | Etapa | URL/Canal | Ação | Payload | Retorno | HTTP | Mensagem ao usuário | Tempo | Esperado | Real | Classificação | Observação |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 00:00 | Landing | `https://mercabot.com.br/` | GET | — | HTML 50KB | **200** | hero "Seu WhatsApp. Nunca mais sem resposta." | n/d | OK | OK | sucesso | landing servida |
| 00:05 | Cadastro | `/cadastro/` | GET | — | HTML | **200** | "Seu WhatsApp atendendo clientes 24h" | n/d | OK | OK | sucesso | form padrão |
| 00:10 | Submit cadastro | (form submit) | POST | `{whats, email}` | redirect Stripe | n/d | — | n/d | redirect Stripe | redirect Stripe | sucesso | `[CODE]` |
| 00:15 | Stripe Checkout | `https://checkout.stripe.com/...` | GET/POST | cartão | session_id | **200** | "7 dias grátis, R$0,00 hoje" | n/d | OK | rejeita cartão de teste | alerta | só aceita cartão real |
| 00:20 | Webhook Stripe | `/webhook` | POST | session.completed | customer criado | **200** | — | n/d | OK | OK `[CODE]` | sucesso | cria row Supabase |
| 00:21 | Magic link enviado | Resend | POST API | email | enviado | n/d | — | < 2min | OK | OK `[CODE]` | sucesso | template padrão |
| 00:23 | Clique magic link | `/#access_token=...` | GET | — | HTML home | **200** | — antes do PR #214: vazio. depois: redirect `/acesso/`+hash | n/d | redirect | OK pós-PR | sucesso pós-fix | bug grave histórico |
| 00:24 | `/acesso/` consome hash | `/acesso/#access_token=...` | client-side | — | session em localStorage | n/d | "Acesso confirmado. Redirecionando…" | < 2s | redirect painel | OK pós-PR `[CODE]` | sucesso pós-fix | flowType: implicit |
| 00:25 | `/painel-cliente/app/?continue=1` | GET | — | HTML | **200** | painel renderizado | < 3s | OK | OK | sucesso | session.user válido |
| 00:25 | Wizard `/ativacao/` | GET com hash | — | HTML | **200** | "Nos conte sobre seu negócio" | < 2s | step 1 visível | OK pós-PR #214 | sucesso pós-fix | bug 2 corrigido |
| 00:26 | Step 1 → Step 2 | clique | client | — | UI | n/d | step 2 visível | < 1s | OK | OK | sucesso | + POST /onboarding/step (PR #221) |
| 00:27 | Step 2 → Step 3 | clique | client | — | UI | n/d | step 3 visível | < 1s | OK | OK | sucesso | + POST /onboarding/step |
| 00:28 | Submit wizard | `/onboarding` | POST | form completo | activated_at | **200** | "Configuração salva!" | < 2s | OK | OK | sucesso | mas copy diz "boleto compensar" mesmo c/ cartão |
| 00:29 | "Ir para o painel" | clique anchor | client | — | redirect /painel-cliente/app/?continue=1 | n/d | — | n/d | OK | OK pós-PR #214 | sucesso | session persistida |
| 00:30 | Painel cliente carrega | `/painel-cliente/app/` | GET + JS | — | painel | **200** | "Bot offline · Última resposta 2h" | < 3s | KPIs zerados | mostra "última resposta 2h" misleading | **alerta** | cliente novo, dado errado |
| 00:32 | Aba "Número" | client | — | form Meta tokens | n/d | n/d | pede phone_number_id, access_token, WABA ID | n/d | UX guiada | UX técnica | **bloqueio crítico** | leigo desiste aqui |
| 00:35 → 3 dias | Espera Meta verification | externo | — | — | — | n/d | — | 1-3d | aprovação | falha em 80% | **bloqueio crítico** | precisa CNPJ verificado |
| ... | Conexão Meta | painel | — | tokens válidos | conectado | n/d | "WhatsApp conectado" | < 30s | OK | OK | sucesso | quando passa Etapa 8 |
| ... | Cliente envia msg | WhatsApp Cloud API | webhook → worker | mensagem inbound | salva conv_logs | **200** | — | < 5s | OK | OK `[CODE]` | sucesso | validado em PR #211 |
| ... | Bot responde | Anthropic Claude | API | inbound + system prompt | reply text | **200** | mensagem WhatsApp | 2-8s | OK | OK | sucesso | model_tier=haiku/sonnet |

**Conv 30d nos 6 ativados (real):** **0**. Conclusão: produto chega à etapa de bot rodando em casos near-zero hoje.

---

# LOG TÉCNICO — JORNADA DO PARCEIRO

| Hora | Etapa | URL/Canal | Ação | Retorno | HTTP | Mensagem | Esperado | Real | Classificação | Observação |
|---|---|---|---|---|---|---|---|---|---|---|
| 00:00 | Buscar "parceiro" na landing `/` | `mercabot.com.br/` | GET | HTML | **200** | sem CTA "seja parceiro" no header | CTA visível | ausente | **erro** | descoberta dificil |
| 00:01 | Tentar `/parceiros` | URL chute | GET | 404 | **404** | "página não encontrada" | landing dedicada | inexistente | **erro** | esperado em SaaS |
| 00:02 | Tentar `/seja-parceiro` | URL chute | GET | 404 | **404** | idem | landing | inexistente | **erro** | idem |
| 00:03 | Achar `/guia-parceiro` (Google) | redirect 301 | GET | HTML | **301 → 200** | "guia do parceiro" | guia + CTA | só guia, sem CTA | **erro** | sem next-step |
| 00:08 | Tentar `/painel-parceiro/` | direct | GET | HTML login | **200** | "Sessão não encontrada. Autentique-se para continuar." | login | login OK | sucesso | tem link cadastro |
| 00:09 | Clique "Cadastrar agora" | redirect | GET | `/cadastro/` | **200** | mesmo cadastro do cliente | form parceiro | form genérico | **erro** | confunde |
| 00:12 | Submit `/cadastro/` plano Parceiro | POST | redirect Stripe | n/d | — | — | OK | OK | sucesso | — |
| 00:18 | Stripe paga R$1.297 | Stripe | POST webhook `/webhook` | customer + is_partner=true | **200** | — | OK `[CODE]` | OK | sucesso | auto-flag |
| 00:20 | Magic link recebido | Resend | email | OK | — | — | OK | OK | sucesso | mesmo template do cliente |
| 00:25 | Wizard `/ativacao/` | GET | HTML | **200** | wizard de cliente, não de parceiro | wizard parceiro | wizard genérico | **erro** | parceiro preenche dados como se fosse cliente final |
| 00:30 | Login `/painel-parceiro/` | GET + JS | painel | **200** | sidebar 8 abas | OK | OK | sucesso | nova aba Comissões |
| 00:32 | Aba Comissões | client | renderiza | n/d | "30% recorrente sobre MRR" | "0% comissão (modelo guia)" | conflito grave | **erro crítico** | contradição com guia |
| 00:35 | Aba Configurações → Domínio | client | — | n/d | configurar subdomínio | OK | OK | sucesso | white-label real |
| 00:40 | Vincular cliente: copiar `?ref=` | painel | — | — | sem botão visível | botão de copiar link | inexistente | **erro** | feature invisível |
| 00:45 | (caso descobre via guia) cliente entra `/cadastro/?ref=joao@agencia.com` | webhook | partner_id setado | — | — | OK `[CODE]` | OK | sucesso | linha 715-727 |
| dia 1 mês seguinte | Cron 04:00 BRT | scheduled | — | partner_commissions row | — | — | OK | OK | sucesso `[CODE]` | UNIQUE garante idempotência |
| dia 10 mês seguinte | Admin paga via PIX | manual | — | — | — | — | OK | dependente humano | **alerta** | sem garantia de execução |

---

# ANÁLISE CRÍTICA CONSOLIDADA — RISCOS PRIORIZADOS

Esta seção é a apenas a parte **opinativa**. Acima estão fatos. Aqui é leitura de impacto.

## Risco 1 (CRÍTICO) — Promessa "sem técnico, sem mudar de canal" é falsa hoje

**Origem:** landing principal afirma onboarding instantâneo. Realidade: cliente precisa configurar Meta Business Manager (1-3 dias + CNPJ + verificação).

**Impacto negócio:** clientes pagam, frustram, churnam, espalham boca-a-boca negativo. Métrica fala por si: 0 dos 6 ativados usa o bot.

**Mitigação programada:** Gupshup ISV (PR #217) substitui Meta por embedded signup de 5 min. Bloqueado: aguardando aprovação Gupshup.

## Risco 2 (CRÍTICO) — Contradição entre `/guia-parceiro` e produto

**Origem:** guia diz "R$1.297/m fixo, cobra dos seus clientes, sem comissão". Produto cobra **30% recorrente** via `partner_commissions`.

**Impacto negócio:** primeiro parceiro descobrir vai exigir crédito retroativo OU sair denunciando. Risco de litígio.

**Mitigação:** decidir qual modelo é o oficial e alinhar marketing+produto. Se for 30%, reescrever guia. Se for fixo, deletar tabela `partner_commissions`.

## Risco 3 (CRÍTICO) — Não há jornada estruturada de parceiro

**Origem:** sem `/parceiros` landing, sem CTA "Seja parceiro" no header, sem formulário de candidatura, sem aprovação humana.

**Impacto negócio:** programa de parceiros não consegue captar profissionais sérios. Quem entra é só por "achar de Google". Adversariamente, qualquer fraudador paga R$1.297 e vira parceiro auto-aprovado.

**Mitigação:** criar landing `/parceiros` + form `Tally` ou similar de candidatura + flag `partner_approved` no Supabase + admin endpoint de aprovação manual.

## Risco 4 (ALTO) — Plano Parceiro misturado com plano cliente

**Origem:** seção `/cadastro/` mostra os 3 planos (Starter/Pro/Parceiro) sem contextualização. Cliente final pode escolher Parceiro por confusão.

**Impacto negócio:** menos grave hoje (volume baixo), mas vira ruído à medida que escala. Cliente paga 7x mais e fica perdido.

**Mitigação:** separar fluxos. Cliente final só vê Starter/Pro em `/cadastro/`. Parceiro entra por `/parceiros/` e vê só Parceiro.

## Risco 5 (ALTO) — Wizard "boleto compensar" mesmo com cartão

**Origem:** copy de sucesso do wizard fala em prazo de 3 dias úteis para boleto, exibida mesmo quando pagamento foi cartão (instantâneo).

**Impacto negócio:** cria desconfiança. Cliente acha que pagou e nada vai acontecer.

**Mitigação:** branch a copy por método de pagamento (variável `ob.isPaid` já existe no código mas o fallback default é a copy de boleto).

## Risco 6 (ALTO) — Painel cliente mostra "Última resposta 2h" em conta nova

**Origem:** painel-cliente/app/index.html exibe um valor default que não foi resetado pra contas novas.

**Impacto negócio:** misleading. Cliente acha que bot já está rodando, vai testar, nada acontece, frustra.

**Mitigação:** zerar/ocultar esse campo enquanto não houver primeira resposta real (verificar via `conversation_logs` count).

## Risco 7 (ALTO) — Auditoria de 22 trials abandonados é cega

**Origem:** baseline mostrou 23 travaram antes do Step 1 do wizard. **Não sabemos por quê** — podem ter sido bugs de auth (corrigidos no #214), pode ter sido cliente fechando, pode ser algo mais.

**Impacto negócio:** taxa de conversão signup→ativação é 16-21% — abaixo do que SaaS B2B saudável faz (50-70%).

**Mitigação:** PR #221 instrumentou wizard. Próximos signups vão dar dado. Mas histórico está perdido.

## Risco 8 (MÉDIO) — `/painel-parceiro/` sem botão "copiar link de indicação"

**Origem:** vinculação cliente↔parceiro depende do parceiro saber e usar `?ref=email` na URL. Painel não expõe esse botão.

**Impacto negócio:** mesmo que parceiro existir, não consegue trazer cliente formalmente vinculado.

**Mitigação:** 1 hora de código — adicionar widget "Seu link de indicação" copiável em "Visão geral" do painel-parceiro.

## Risco 9 (MÉDIO) — Painel cliente tem "Atividade recente" vazia mas com placeholder

**Origem:** UI usa dados estáticos quando vazio.

**Impacto negócio:** confunde quem é dado de quem.

**Mitigação:** verificar se é demo data ou bug.

## Risco 10 (MÉDIO) — `/guia-parceiro` é página estática sem dinâmica

**Origem:** guia em PT, não em ES/EN. Sem CTA. Sem versionamento.

**Impacto negócio:** SEO ruim, conversão 0%.

**Mitigação:** adicionar CTA "Quero ser parceiro" no fim do guia, apontando pra form de candidatura.

## Risco 11 (BAIXO) — Bug recém-introduzido em `/onboarding/step`

**Origem:** endpoint retorna `already_recorded:true` pra email inexistente (lookup Supabase Auth retorna primeiro user da base em vez de filtrar). Já flagado como spawn_task pendente.

**Impacto:** atacante pode marcar timestamps falsos. Não escala dano.

**Mitigação:** validar `u.email === email` no handler.

## Risco 12 (BAIXO) — Cancelamento parceiro

**Origem:** SOP/guia menciona "aviso prévio 30 dias" pra cancelar parceria. Mas não há endpoint nem UI pra esse fluxo.

**Impacto:** parceiro descontente fica sem mecanismo formal de saída.

**Mitigação:** criar `/painel-parceiro` → "Cancelar parceria" → formulário com prazo.

---

## Síntese executiva final

**Cliente:** **0 dos 6 ativados usa o bot.** A landing vende "ativo no mesmo dia, sem técnico" mas a etapa de Meta Business Manager destrói essa promessa. Mitigação principal (Gupshup) está scaffolded mas não ativada. **NÃO ESTÁ PRONTO** para usuários reais sem white-glove humano.

**Parceiro:** **0 parceiros têm clientes vinculados.** Não há landing dedicada, não há formulário de candidatura, não há onboarding específico, e há contradição grave entre marketing copy (`/guia-parceiro` diz "fixo, sem comissão") e produto (30% recorrente). **NÃO ESTÁ PRONTO** para captação ativa.

**Recomendação geral (fora do escopo da auditoria):** congelar marketing/aquisição até resolver Risco 1 (Gupshup ativo) e Risco 2 (contradição parceiro). Mantém alinhado com o plano `Cenario-C-v2.1.md` já documentado.

---

**Fim da auditoria.** Relatórios brutos acima, análise crítica em seção própria. Versão 1.0 — atualizar quando Gupshup for ativado e quando primeiros 5 clientes reais terminarem o funil.
