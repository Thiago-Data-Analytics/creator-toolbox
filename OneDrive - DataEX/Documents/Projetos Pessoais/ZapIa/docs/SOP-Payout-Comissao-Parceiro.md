# SOP — Pagamento Mensal de Comissão de Parceiros (PIX manual)

**Versão:** 1.0 · **Cadência:** Todo dia 10 (útil), até 18:00 BRT · **Responsável:** Admin (founder)

---

## Visão geral

O MercaBot paga **30% recorrente** sobre o MRR de cada cliente ativo vinculado a um parceiro. O cálculo é automatizado (cron mensal no dia 1), mas o **payout é manual via PIX** até termos volume que justifique automação bancária (Open Finance / Stripe Connect). Este SOP descreve a rotina operacional.

## Pré-requisitos

- Acesso ao painel admin do MercaBot (e-mail = `ADMIN_EMAIL`).
- App do banco logado com saldo PIX disponível.
- Token de sessão Supabase válido (login normal pelo painel).

## Calendário

| Data | Ação |
|---|---|
| Dia 1, 04:00 BRT | **Cron automático.** Calcula comissões do mês anterior. Cria rows em `partner_commissions` e `partner_payouts` com status `pending`. |
| Dias 2-9 | Janela de auditoria. Parceiros podem reportar discrepâncias (clientes faltando, valores errados). Você corrige caso a caso. |
| Dia 10 | **Payout day.** Você paga todos os payouts pendentes via PIX manual e marca como confirmados no sistema. |
| Dia 11+ | Notificação automática enviada aos parceiros (TODO: implementar email). Por ora, mande WhatsApp/email manual. |

## Passo a passo do dia 10

### 1. Listar payouts pendentes

```bash
TOKEN=<seu-jwt-supabase>
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.mercabot.com.br/admin/payouts/pending | jq .
```

Retorna array de payouts com:
- `id` — UUID do payout
- `partner_id`, `partner_email`, `partner_company_name`
- `reference_month` — `YYYY-MM-01`
- `total_amount_brl_cents` — valor total da comissão (em centavos)
- `client_count` — quantos clientes foram comissionados
- `pix_key`, `pix_key_type` — se o parceiro cadastrou (vem de `partner_data.config`)

### 2. Validar antes de pagar

Para cada payout:

**(a)** Confira que `pix_key` e `pix_key_type` estão preenchidos. Se não estiver:
- Mande mensagem ao parceiro pedindo a chave PIX. Não pague sem chave registrada — auditoria fica difícil.

**(b)** Bata o valor com o que aparece no painel do próprio parceiro (`/painel-parceiro/` → aba Comissões). Os valores devem coincidir.

**(c)** Spot check: pegue 1 cliente do payout, confira que ele está ativo no Stripe e que o `partner_id` no Supabase aponta pra esse parceiro.

### 3. Pagar via PIX

No app do banco:
- Cole a chave PIX exatamente como veio na resposta da API (sem espaços).
- Confirme nome do recebedor (deve casar com `partner_company_name` ou nome do dono).
- Valor: `total_amount_brl_cents / 100` (ex.: `438000` cents = `R$ 4.380,00`).
- **Descrição da transferência:** `MercaBot - Comissão MM/AA - <partner_company_name>`. Ex.: `MercaBot - Comissão 04/26 - Agência Vendas`.
- Salve o comprovante (PDF ou screenshot).
- Suba o comprovante pro Cloudflare R2 (ou Drive da empresa) e copie a URL pública.

### 4. Marcar como pago no sistema

Para cada payout pago:

```bash
PAYOUT_ID=<uuid-do-payout>
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "receiptUrl": "https://r2.mercabot.com.br/comprovantes/abr26-acme.pdf",
    "notes": "PIX enviado 10/05/26 17:42 — banco Itaú, transação 12345"
  }' \
  https://api.mercabot.com.br/admin/payouts/$PAYOUT_ID/mark-paid
```

Isso:
- Atualiza `partner_payouts.status` → `confirmed` e `paid_at` → agora.
- Salva `receipt_url` e `notes`.
- Vincula todas as `partner_commissions` daquele mês × parceiro ao `payout_id` (audit trail).

### 5. Notificar o parceiro

Por enquanto manual. Mensagem padrão (WhatsApp ou e-mail):

> Olá [nome]! Sua comissão referente a **[mês de referência]** foi paga via PIX agora há pouco no valor de **R$ [valor]**. Comprovante: [link]. Próximo pagamento: dia 10 do mês que vem. Qualquer dúvida, pode falar comigo aqui.

(TODO: automatizar via Resend quando volume justificar — função `enviarEmailComissaoPaga(partnerId, payoutId)` no Worker.)

## Casos especiais

### Parceiro reporta discrepância antes do dia 10

1. Verificar via SQL no Supabase Studio:
```sql
SELECT pc.*, c.company_name AS partner, ct.company_name AS client
FROM partner_commissions pc
JOIN customers c  ON c.id = pc.partner_id
JOIN customers ct ON ct.id = pc.customer_id
WHERE c.user_id = '<parceiro_user_id>'
  AND pc.reference_month = '2026-04-01'
ORDER BY pc.commission_amount_brl_cents DESC;
```

2. Se valor estiver errado:
   - **Cliente falta na lista:** confirme `customers.partner_id = <parceiro_id>` e `status IN ('active','trial','trialing')` no banco. Se sim, force re-cálculo do mês:
     ```bash
     curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
       -d '{"referenceMonth":"2026-04-01"}' \
       https://api.mercabot.com.br/admin/commissions/run
     ```
     O upsert atualiza valores e adiciona linhas faltantes sem duplicar.
   - **Cliente listado errado** (parceiro errado): troque `customers.partner_id` no Supabase Studio. Re-rode o cron acima.

### Cliente cancelou no meio do mês

Política atual: **se cliente estava `active` no momento do cron (dia 1), conta cheio**. O parceiro recebe a comissão mesmo que o cliente cancele dia 5. Isso evita pro-rata complexo e estimula parceiros a manter clientes engajados durante todo o mês.

### Parceiro sem chave PIX cadastrada

Bloqueia o pagamento até parceiro cadastrar via painel (`/painel-parceiro/` → Comissões → "Chave PIX"). Mantenha o payout em `pending` até a chave aparecer.

### Re-pagamento (cliente reembolsado pelo Stripe)

Hoje **não há reversão automática.** Se um cliente é reembolsado e a comissão já foi paga ao parceiro, o admin tem 2 opções:
- (a) Aceitar a perda, deixar como custo de aquisição.
- (b) Compensar no próximo mês descontando manualmente. Documente no campo `notes` do próximo `partner_payouts`.

(TODO futuro: cron de reconciliação Stripe que detecta refunds e gera linhas negativas em `partner_commissions`.)

## Auditoria

Toda execução do cron grava em logs do Cloudflare Worker (`[commissions] YYYY-MM-01: N rows...`). Os payouts pagos têm `paid_at`, `receipt_url`, `notes`. Para fechamento contábil mensal, exporte:

```sql
SELECT
  TO_CHAR(reference_month, 'MM/YYYY') AS mes,
  c.company_name AS parceiro,
  total_amount_brl_cents / 100.0 AS valor_brl,
  status,
  paid_at,
  receipt_url
FROM partner_payouts pp
JOIN customers c ON c.id = pp.partner_id
WHERE reference_month >= '2026-01-01'
ORDER BY reference_month DESC, valor_brl DESC;
```

Salve como CSV pra contabilidade.

## Métricas a acompanhar

- **Total pago por mês** (cresce com aquisição via canal parceiro).
- **% do MRR total que vai pra comissão** (saudável: 15-25% — abaixo é parceiro fraco, acima é margem em risco).
- **Tempo médio de pagamento** (alvo: dia 10, máx dia 12).
- **Discrepâncias reportadas / mês** (alvo: 0 — sinal de que o cron está OK).

---

**Mudanças neste SOP:** abrir PR no repositório atualizando este arquivo. Versionar a `Versão` no topo.
