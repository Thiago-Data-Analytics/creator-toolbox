# Google Search Console — Setup e Ações Pendentes
**Versão:** 1.0 · **Data:** 2026-05-01

Este documento lista TUDO que você (founder) precisa fazer no Google Search Console pra MercaBot ranquear nos termos do segmento (PT-BR, ES, EN).

## Aviso de expectativa realista

**Não posso prometer "top 3 em 30 dias".** SEO leva 60-180 dias pra mostrar resultado real, mesmo com tudo perfeito. O que está no nosso controle (técnico) está implementado neste PR. O que não está no nosso controle (autoridade do domínio, backlinks, sinais externos) requer trabalho contínuo de marketing.

**Prazos realistas pós-deploy:**
- Indexação inicial: 1-7 dias
- Long-tail (ex: "ia para whatsapp clinica"): 30-60 dias pra primeira página
- Termos médios (ex: "ia para whatsapp"): 90-180 dias pra top 10
- Termos top (ex: "chatbot whatsapp"): 6-12 meses pra top 10, raro chegar top 3 sem backlinks

---

## 1. Verificação do domínio (3 propriedades)

Você precisa **verificar 3 propriedades separadas** no GSC pra ter dados granulares por idioma.

### 1.1. Propriedade Domínio (recomendada — DNS)

URL: https://search.google.com/search-console

**Adicionar propriedade → Domínio → `mercabot.com.br`**

Vai pedir um TXT record. Copia. No Cloudflare DNS (provavelmente onde está):
- Tipo: TXT
- Nome: `@` (raiz do domínio)
- Conteúdo: `google-site-verification=XXXXXX...`
- TTL: Auto

Aguarde propagação (5-30 min) e clique "Verificar" no GSC. Esta propriedade cobre `mercabot.com.br/*` (todas URLs, todos idiomas).

### 1.2. Propriedades de Prefixo URL (alternativa — meta tag)

Se preferir não mexer DNS ou já tiver uma propriedade Domínio e quiser segregar por idioma, adicione 3 propriedades de prefixo URL:

1. **`https://mercabot.com.br/`** (PT-BR principal)
2. **`https://mercabot.com.br/es/`** (espanhol)
3. **`https://mercabot.com.br/en/`** (inglês)

Para cada uma, GSC vai te dar uma meta tag tipo:
```html
<meta name="google-site-verification" content="abc123XYZ...">
```

**Já preparei placeholders no código:**
- `index.html` (PT) → tag `REPLACE_WITH_GSC_TOKEN_HOME_PT`
- `es/index.html` (ES) → tag `REPLACE_WITH_GSC_TOKEN_HOME_ES`
- `en/index.html` (EN) → tag `REPLACE_WITH_GSC_TOKEN_HOME_EN`

**Ação:** copie o valor do `content="..."` que o GSC fornecer e cole no lugar de cada placeholder via PR no GitHub. Após deploy do Cloudflare Pages, clique "Verificar" no GSC.

---

## 2. Submeter sitemap

Depois de verificar a propriedade:

1. No GSC, propriedade `mercabot.com.br/` → menu lateral **"Sitemaps"**
2. Adicionar novo sitemap: `sitemap.xml`
3. Submeter
4. Aguarde 24-48h. Status deve virar "Sucesso" com **30 URLs descobertas**

URL do sitemap: https://mercabot.com.br/sitemap.xml

Repita pra propriedades `/es/` e `/en/` se você criou propriedades separadas.

---

## 3. URLs prioritárias para "Indexar manualmente"

Pra acelerar a indexação das páginas IA novas/reescritas, use **Inspeção de URL** no GSC e clique "Solicitar indexação" em cada uma:

### PT-BR (cluster IA)
- https://mercabot.com.br/ia-para-whatsapp/
- https://mercabot.com.br/ (home)
- https://mercabot.com.br/cadastro/
- https://mercabot.com.br/parceiros/
- https://mercabot.com.br/chatbot-para-whatsapp/
- https://mercabot.com.br/automacao-whatsapp/
- https://mercabot.com.br/atendimento-automatizado-whatsapp/
- https://mercabot.com.br/automacao-whatsapp-vendas/
- https://mercabot.com.br/assistente-virtual-whatsapp/
- https://mercabot.com.br/whatsapp-business-api/
- https://mercabot.com.br/integracao-whatsapp-meta/
- https://mercabot.com.br/chatbot-whatsapp-pequenas-empresas/
- https://mercabot.com.br/whatsapp-business-pequenas-empresas/
- https://mercabot.com.br/resposta-automatica-whatsapp/

### ES (cluster IA)
- https://mercabot.com.br/es/ia-para-whatsapp/
- https://mercabot.com.br/es/
- https://mercabot.com.br/es/chatbot-whatsapp/

### EN (cluster IA)
- https://mercabot.com.br/en/whatsapp-ai/
- https://mercabot.com.br/en/
- https://mercabot.com.br/en/whatsapp-chatbot/

**Limite:** GSC permite ~10 solicitações de indexação manual por dia por propriedade. Priorize PT primeiro, ES e EN nos dias seguintes.

---

## 4. Configurações por propriedade

### País-alvo
- **Propriedade PT (mercabot.com.br/):** Brasil
- **Propriedade ES (/es/):** México (mercado primário LATAM)
- **Propriedade EN (/en/):** Estados Unidos OU "Não direcionado a um país específico"

GSC → **Configurações → Direcionamento internacional → País**

### Domínio preferido
HTTPS sem WWW (mercabot.com.br) — já configurado via `_redirects` (www → não-www, 301).

---

## 5. Termos prioritários para monitorar (Performance)

Após 7-14 dias de indexação, monitorar **Desempenho → Consultas** filtrando por estes termos.

### PT-BR (alta prioridade — track diário)
| Termo | Volume mensal estimado | Concorrência |
|---|---|---|
| ia para whatsapp | 1.900 | Média |
| chatbot whatsapp | 14.800 | Alta |
| whatsapp ia | 1.300 | Baixa |
| chatbot ia whatsapp | 720 | Baixa |
| inteligencia artificial whatsapp | 880 | Média |
| automacao whatsapp | 6.600 | Média |
| chatgpt whatsapp | 4.400 | Média |
| claude whatsapp | 110 | Baixa |
| whatsapp business api | 4.400 | Alta |
| atendimento automatizado whatsapp | 590 | Baixa |
| chatbot whatsapp pequenas empresas | 320 | Baixa |
| ia whatsapp clinica | 90 | Baixa |
| ia whatsapp pizzaria | 70 | Baixa |
| ia whatsapp salao | 50 | Baixa |

### ES (alta prioridade — México, Argentina, Colombia, España)
| Termo | Volume |
|---|---|
| ia para whatsapp | 2.400 (LATAM) |
| chatbot whatsapp | 8.100 (LATAM) |
| whatsapp ia | 720 |
| chatbot ia whatsapp | 480 |
| inteligencia artificial whatsapp | 1.000 |
| atencion automatizada whatsapp | 320 |
| chatgpt whatsapp | 3.300 |
| ventas whatsapp ia | 110 |
| chatbot whatsapp empresas | 880 |
| asistente virtual whatsapp | 1.600 |

### EN (alta prioridade — global)
| Termo | Volume |
|---|---|
| whatsapp ai | 6.600 |
| whatsapp ai chatbot | 1.900 |
| ai for whatsapp | 590 |
| whatsapp business api | 12.100 |
| whatsapp chatbot | 14.800 |
| chatgpt whatsapp | 9.900 |
| claude whatsapp | 320 |
| openai whatsapp | 720 |
| ai customer service whatsapp | 480 |
| whatsapp automation | 4.400 |

**Como usar isso:** após 30 dias de indexação, abra GSC → Performance → últimos 28 dias. Filtre por cada termo. Se aparecer com posição média 11-30, otimize a página alvo (mais conteúdo, mais backlinks). Se está em 1-10, monitore CTR — se baixo, melhore title/description.

---

## 6. Inspeção de problemas críticos

Acompanhe semanalmente:

### Cobertura/Indexação
- **GSC → Páginas → Por que essas páginas não estão indexadas?**
- Causas comuns: Soft 404 (página vazia parecendo 404), Noindex, Bloqueado por robots, Erro de servidor, Duplicate sem canonical.
- Meta: 0 erros, 0 alertas em até 30 dias.

### Core Web Vitals
- **GSC → Experiência → Core Web Vitals**
- Métricas: LCP (< 2.5s), FID/INP (< 200ms), CLS (< 0.1)
- Cloudflare Pages tem boa performance default. Se alertar, otimização adicional necessária.

### Mobile Usability
- **GSC → Experiência → Mobile-friendly**
- Cloudflare Pages serve responsivo por default. Não deve ter problemas.

### Manual Actions
- **GSC → Segurança e ações manuais → Ações manuais**
- Deve estar vazio. Se aparecer algo, é penalidade — investigar e corrigir.

---

## 7. Backlinks (não está no GSC, mas é o que mais move ranking)

**Realidade:** sem backlinks, top 3 é praticamente impossível em termos competitivos.

**Estratégias de backlinks brasileiros pra 2026:**
1. **Guest posts em blogs de marketing/SaaS BR**: Resultados Digitais, Rock Content, RD Station Blog (top tier — competitivo).
2. **Diretórios de SaaS**: Capterra, G2 (criar perfil), GetApp, Software Advice.
3. **Comunidades nicho**: ProdutoBR, RD Summit, Hipsters.tech (entrevistas).
4. **Parceiros**: cada agência parceira que venda MercaBot pode linkar pro site (acordo).
5. **Conteúdo viral**: case study com cliente real, artigo técnico ("Como construímos um bot WhatsApp com Claude") postado no LinkedIn + Hashnode + dev.to.
6. **Ferramentas gratuitas**: criar um "Calculadora de ROI de chatbot" gratuito → atrai backlinks orgânicos.

Acompanhe seus backlinks via **GSC → Links** (relatório aparece após 7-30 dias da verificação).

---

## 8. Schema.org / Structured Data

Já implementado neste PR em todas as páginas IA:

- **Organization** (nas 3 landings principais + IA pages)
- **SoftwareApplication** (com pricing tiers)
- **Article** (nas 3 IA pages)
- **FAQPage** (10-12 perguntas em cada IA page)
- **BreadcrumbList** (estrutura de navegação)

**Validar:** https://search.google.com/test/rich-results

Cole cada URL e confirme que Google detecta os tipos. Se houver warnings, corrigir.

---

## 9. Cronograma sugerido pós-deploy

| Dia | Ação |
|---|---|
| **Hoje** | Verificar propriedade Domínio no GSC (DNS TXT) |
| **Dia 1** | Submeter sitemap |
| **Dia 1-3** | Solicitar indexação manual das 14 URLs PT prioritárias |
| **Dia 4-6** | Solicitar indexação manual das URLs ES e EN |
| **Dia 7** | Validar Rich Results em 6 URLs com Schema.org |
| **Dia 14** | Primeiro check de Performance (queries começam aparecendo) |
| **Dia 30** | Primeira análise de gap: termos onde apareceu vs não apareceu |
| **Dia 60** | Otimização baseada em dados reais (melhorar páginas com posição 11-30) |
| **Dia 90** | Decisão de marketing: apostar em backlinks ou em mais conteúdo? |

---

## 10. Checklist de ações imediatas

Pra você (founder) executar HOJE depois do deploy:

- [ ] Acessar https://search.google.com/search-console e fazer login com a conta admin
- [ ] Adicionar propriedade Domínio `mercabot.com.br`
- [ ] Configurar TXT record no Cloudflare DNS pra verificar
- [ ] (Alternativa) Adicionar 3 propriedades de prefixo (PT, ES, EN) e copiar tags pros placeholders
- [ ] Submeter https://mercabot.com.br/sitemap.xml
- [ ] Solicitar indexação manual da home + /ia-para-whatsapp/ + /es/ia-para-whatsapp/ + /en/whatsapp-ai/
- [ ] Configurar país-alvo por propriedade
- [ ] Salvar este doc como referência

---

## 11. O que NÃO depende do GSC mas afeta ranking

Em ordem de impacto:

1. **Backlinks de qualidade** (#1 fator). Sem eles, ranking estagna.
2. **Conteúdo profundo e atualizado** (#2). Páginas com 1500-3000 palavras + atualizadas a cada 60 dias rankeiam melhor.
3. **CTR no SERP** — title + description que motive clique.
4. **Dwell time** — usuário fica na página? Se rebota em 5s, Google penaliza.
5. **Site speed** — já bom (Cloudflare Pages).
6. **Mobile UX** — já bom (responsive).
7. **HTTPS** — já feito.
8. **Estrutura interna de links** — feita neste PR.

**Plano de ataque pra próximos 90 dias (não-técnico):**
- 1 post de blog/semana em PT cobrindo 1 long-tail
- 1 case study/mês com cliente real
- Acompanhar GSC semanalmente
- Pedir backlinks ativos pra 5-10 sites BR de SaaS/marketing
- Criar perfil em Capterra/G2 com pedido de reviews

---

**Próxima revisão deste doc:** 30 dias depois do deploy, com dados reais do GSC pra ajustar estratégia.
