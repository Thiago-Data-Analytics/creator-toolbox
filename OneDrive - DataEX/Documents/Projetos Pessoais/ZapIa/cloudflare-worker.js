/**
 * MercaBot — Cloudflare Worker
 * 
 * DEPLOY:
 *   1. wrangler login
 *   2. wrangler deploy
 * 
 * VARIÁVEIS (configure em: Cloudflare Dashboard → Workers → mercabot-api → Settings → Variables):
 *
 *   — Supabase (obrigatórias) ───────────────────────────────────────────────────
 *   SUPABASE_URL            = https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = eyJ...  (Supabase → Settings → API → service_role)
 *
 *   — IA / Anthropic (obrigatória para IA features) ────────────────────────────
 *   ANTHROPIC_API_KEY       = sk-ant-...  (console.anthropic.com → API Keys)
 *
 *   — Stripe ───────────────────────────────────────────────────────────────────
 *   STRIPE_SECRET_KEY       = sk_live_...  (Stripe Dashboard → Developers → API Keys)
 *   STRIPE_WEBHOOK_SECRET   = whsec_...    (Stripe Dashboard → Webhooks → Signing Secret)
 *   STRIPE_PRICE_ADDON_1K_BRL            = price_...  (pacote +1.000 msgs IA — BRL)
 *   STRIPE_PRICE_ADDON_1K_USD            = price_...  (pacote +1.000 msgs IA — USD)
 *   STRIPE_PRICE_STARTER_USD             = [Starter mensual USD]
 *   STRIPE_PRICE_PRO_USD                 = [Pro mensual USD]
 *   STRIPE_PRICE_PARCEIRO_USD            = [Socio mensual USD]
 *   STRIPE_PRICE_STARTER_ANUAL_USD       = [Starter anual USD]
 *   STRIPE_PRICE_PRO_ANUAL_USD           = [Pro anual USD]
 *   STRIPE_PRICE_PARCEIRO_ANUAL_USD      = [Socio anual USD]
 *
 *   — WhatsApp / Meta ──────────────────────────────────────────────────────────
 *   WHATSAPP_APP_SECRET     = <App Secret>  (Meta for Developers → App → Settings → Basic → App Secret)
 *                             Usado para verificar assinatura HMAC-SHA256 dos webhooks do Meta.
 *                             Opcional — se ausente, a validação de assinatura é ignorada (não recomendado em prod).
 *
 *   — Email / misc ─────────────────────────────────────────────────────────────
 *   RESEND_API_KEY          = re_...   (resend.com → API Keys)
 *   ALLOWED_ORIGIN          = https://mercabot.com.br
 *   FROM_EMAIL              = MercaBot <contato@mercabot.com.br>
 *
 * STRIPE PRICE IDs (crie em Stripe Dashboard → Products):
 *   price_starter_monthly_BRL  → R$197/mês
 *   price_pro_monthly_BRL      → R$497/mês
 *   price_parceiro_monthly_BRL → R$1297/mês
 *
 * ROTA WEBHOOK no Stripe: https://api.mercabot.com.br/webhook
 * Eventos a escutar: checkout.session.completed, customer.subscription.deleted,
 *   customer.subscription.updated, invoice.payment_failed, invoice.payment_succeeded
 */

// ── CORS HEADERS ──────────────────────────────────────────────────
const SUPABASE_URL = 'https://rurnemgzamnfjvmlbdug.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_OQKR0S4iTFpwHQ1PIQgdvQ_fi48V9KJ';

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === 'https://mercabot.com.br' || origin === 'https://www.mercabot.com.br') return true;
  return /^https:\/\/[a-z0-9-]+\.mercabot\.pages\.dev$/i.test(origin);
}

function corsHeaders(origin) {
  const allowedOrigin = isAllowedOrigin(origin) ? (origin || 'https://mercabot.com.br') : 'https://mercabot.com.br';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Origin-Agent-Cluster': '?1',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=(self)',
    'Cache-Control': 'no-store, no-cache',
    'Vary': 'Origin',
  };
}

function shouldEnforceOrigin(url) {
  const pathname = url.pathname || '/';
  if (pathname === '/health') return false;
  if (pathname === '/checkout/readiness') return false;
  if (pathname === '/webhook') return false;
  if (pathname === '/whatsapp/webhook') return false;
  if (pathname.startsWith('/admin/')) return false;
  return true;
}

function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

function textResponse(body, status = 200, origin, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'text/plain; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function redirectResponse(location, status = 302) {
  return new Response(null, {
    status,
    headers: {
      Location: location,
      'Cache-Control': 'no-store, no-cache',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

// ── AI QUOTA — mensagens IA por plano/mês ────────────────────────
const AI_MSGS_PLAN_LIMITS = { starter: 1000, pro: 4000, parceiro: 15000 };
const AI_QUOTA_ALERT_PCT  = 0.80; // e-mail de alerta ao cliente ao atingir 80%

// ── WAMID DEDUPLICATION — evita processar retries do Meta duas vezes ─────────
// Cloudflare Workers são stateless entre requests, mas o mesmo isolate pode
// atender múltiplas requisições simultâneas. O Set é bounded (max 2000) para
// evitar crescimento ilimitado de memória dentro do mesmo isolate.
const _processedWamids = new Set();
const _WAMID_MAX_SIZE  = 2000;
function _isWamidSeen(wamid) {
  if (!wamid) return false;
  if (_processedWamids.has(wamid)) return true;
  if (_processedWamids.size >= _WAMID_MAX_SIZE) {
    // Remove the oldest entry (first inserted) to keep the set bounded
    _processedWamids.delete(_processedWamids.values().next().value);
  }
  _processedWamids.add(wamid);
  return false;
}

// ── HISTÓRICO DE CONVERSA POR CONTATO ────────────────────────────────────────
// Guarda as últimas mensagens trocadas por número de telefone para que a IA
// tenha contexto ao responder. Bounded por tamanho e TTL para não vazar memória.
const _convHistory = new Map(); // key = `${customerId}:${from}`, value = { ts, msgs }
const _CONV_MAX_PAIRS = 12;     // máximo de pares (user + assistant) por conversa
                                 // 12 pares = 24 mensagens de histórico — suficiente para
                                 // qualificações de lead que costumam ter 5-10 trocas.
const _CONV_TTL_MS = 30 * 60 * 1000; // 30 minutos de inatividade zera o histórico
const _CONV_MAX_ENTRIES = 500;  // máximo de conversas simultâneas no isolate

function _convKey(customerId, from) { return `${customerId}:${from}`; }

function _getConvHistory(customerId, from) {
  const key = _convKey(customerId, from);
  const entry = _convHistory.get(key);
  if (!entry) return [];
  if (Date.now() - entry.ts > _CONV_TTL_MS) { _convHistory.delete(key); return []; }
  return entry.msgs;
}

function _appendConvHistory(customerId, from, userText, assistantText) {
  const key = _convKey(customerId, from);
  const prev = _getConvHistory(customerId, from);
  const next = [...prev,
    { role: 'user',      content: userText },
    { role: 'assistant', content: assistantText },
  ].slice(-_CONV_MAX_PAIRS * 2); // mantém só os últimos N pares
  if (_convHistory.size >= _CONV_MAX_ENTRIES && !_convHistory.has(key)) {
    // Remove entrada mais antiga
    _convHistory.delete(_convHistory.keys().next().value);
  }
  _convHistory.set(key, { ts: Date.now(), msgs: next });
}

// Recarrega histórico do Supabase quando o cache em memória está vazio.
// Crítico em 3 cenários:
//   1. Novo isolate do Cloudflare Worker pegou a mensagem (cache não compartilhado)
//   2. >30 min de inatividade (TTL expirou)
//   3. Dono do bot pausou a IA, atendeu manualmente, e a IA voltou depois
// Sem isso o bot responde como se fosse uma conversa nova, ignorando trocas
// recentes do dia (ex.: cliente dizendo "Sim" ao retornar).
async function _loadConvHistoryFromDb(customerId, from, limit) {
  if (!customerId || !from) return [];
  const max = Math.max(1, Math.min(limit || _CONV_MAX_PAIRS * 2, 40));
  const path = `conversation_logs?customer_id=eq.${encodeURIComponent(customerId)}&contact_phone=eq.${encodeURIComponent(from)}&order=created_at.desc&limit=${max}&select=user_text,assistant_text,created_at,direction`;
  const res = await supabaseAdminRest(path).catch(() => null);
  if (!res || !res.ok || !Array.isArray(res.data)) return [];
  // Server retorna desc; vira asc para alimentar o modelo na ordem cronológica.
  const rows = res.data.slice().reverse();
  const msgs = [];
  for (const row of rows) {
    if (row.user_text)      msgs.push({ role: 'user',      content: row.user_text });
    if (row.assistant_text) msgs.push({ role: 'assistant', content: row.assistant_text });
  }
  return msgs.slice(-_CONV_MAX_PAIRS * 2);
}

// Versão preferida: usa cache em memória se houver, senão hidrata do banco.
async function _resolveConvHistory(customerId, from) {
  const inMem = _getConvHistory(customerId, from);
  if (inMem && inMem.length) return inMem;
  const fromDb = await _loadConvHistoryFromDb(customerId, from);
  if (fromDb.length) {
    // Aproveita pra popular o cache do isolate atual.
    _convHistory.set(_convKey(customerId, from), { ts: Date.now(), msgs: fromDb });
  }
  return fromDb;
}

// Detecta se a resposta da IA sinalizou escalada para humano (handoff).
// Verifica termos que o bot usa quando não consegue resolver e precisa de equipe.
const _HANDOFF_TERMS = [
  'encaminhar', 'equipe', 'atendente', 'atendimento humano',
  'responsável', 'entrar em contato', 'nossa equipe', 'falar com alguém',
];
function _detectHandoff(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return _HANDOFF_TERMS.some(term => lower.includes(term));
}

// ── PERSISTÊNCIA DE CONVERSA NO SUPABASE ─────────────────────────────────────
// Fire-and-forget: registra cada par (usuário → IA) no banco para o dashboard
// de métricas do cliente. Nunca bloqueia o handler do webhook.
// needsHuman=true quando o bot detecta que a conversa deve ser escalada para humano.
async function logConversation(customerId, contactPhone, userText, assistantText, needsHuman) {
  if (!customerId) return;
  const phone = String(contactPhone || '').slice(0, 30);
  try {
    await supabaseAdminRest('conversation_logs', 'POST', {
      customer_id:    customerId,
      contact_phone:  phone,
      user_text:      String(userText      || '').slice(0, 4000),
      assistant_text: String(assistantText || '').slice(0, 4000),
      needs_human:    !!needsHuman,
      direction:      'inbound',
    });
  } catch (_) {}
  // Mantém o registro do contato atualizado (upsert fire-and-forget)
  // logConversation é sempre chamado para mensagens inbound do webhook (isInbound=true)
  // → atualiza last_user_msg_at para lógica de follow-up
  if (phone) upsertContact(customerId, phone, true).catch(() => {});
}

async function getJsonBody(request) {
  try {
    return await request.json();
  } catch (_) {
    return null;
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

// ── MODELOS ANTHROPIC — fallback automático se o primário estiver depreciado ──
// Atualizar a lista quando a Anthropic lançar novos modelos.
const ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',   // primário — mais barato/rápido
  'claude-sonnet-4-5-20250929',  // fallback 1
  'claude-sonnet-4-20250514',    // fallback 2
  'claude-opus-4-20250514',      // fallback 3 (caro, último recurso)
];

async function deriveEncryptionKey() {
  const secret = String(STRIPE_SECRET_KEY || 'mercabot-fallback-secret');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptSecret(secret) {
  const key = await deriveEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secret)
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decryptSecret(ciphertext) {
  const parts = String(ciphertext || '').split('.');
  if (parts.length !== 2) throw new Error('cipher_invalid');
  const key = await deriveEncryptionKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(parts[0]) },
    key,
    base64ToBytes(parts[1])
  );
  return new TextDecoder().decode(plain);
}

async function getSupabaseUser(jwt) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${jwt}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function supabaseRest(path, jwt, method = 'GET', body) {
  const headers = {
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${jwt}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
  return { ok: res.ok, status: res.status, data: payload };
}

async function supabaseAdminRest(path, method = 'GET', body, extraHeaders) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, data: { error: 'Serviço temporariamente indisponível.' } };
  }
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extraHeaders,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
  return { ok: res.ok, status: res.status, data: payload };
}

// Upsert via PostgREST — requer Prefer: resolution=merge-duplicates
async function supabaseAdminUpsert(table, conflictCols, body) {
  const path = `${table}?on_conflict=${encodeURIComponent(conflictCols)}`;
  return supabaseAdminRest(path, 'POST', body, {
    'Prefer': 'resolution=merge-duplicates',
  });
}

// Extrai o e-mail autenticado do JWT do Cloudflare Access (enviado como
// Authorization: Bearer <cf_jwt>).  Não verifica a assinatura — a rota
// /painel-parceiro já é protegida pelo Cloudflare Access na borda;
// aqui usamos o token apenas para particionar dados por e-mail.
function extractPartnerEmail(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice(0, (4 - b64.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    const email = String(payload.email || '').trim().toLowerCase();
    const exp = Number(payload.exp || 0);
    if (exp && Math.floor(Date.now() / 1000) > exp) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  } catch (_) { return null; }
}

async function supabaseAdminAuth(path, method = 'GET', body) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, data: { error: 'Serviço temporariamente indisponível.' } };
  }
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
  return { ok: res.ok, status: res.status, data: payload };
}

function normalizePlanCode(rawPlan) {
  const value = String(rawPlan || '').trim().toLowerCase();
  if (!value) return 'starter';
  if (value.startsWith('parceiro')) return 'parceiro';
  if (value.startsWith('pro')) return 'pro';
  return 'starter';
}

function detectBillingPeriod(rawPlan) {
  return String(rawPlan || '').toLowerCase().includes('anual') ? 'annual' : 'monthly';
}

// findProfileByEmail: retorna registro da tabela profiles pelo e-mail (ou null)
async function findProfileByEmail(email) {
  if (!email) return null;
  const res = await supabaseAdminRest(
    `profiles?email=eq.${encodeURIComponent(email)}&select=id,email&limit=1`
  );
  return Array.isArray(res.data) && res.data[0] ? res.data[0] : null;
}

// getCustomerByEmail: resolve customer via profiles → user_id (evita depender de coluna email em customers)
async function getCustomerByEmail(email, selectFields) {
  if (!email) return null;
  const profileRes = await supabaseAdminRest(
    `profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`
  );
  const userId = Array.isArray(profileRes.data) && profileRes.data[0] ? profileRes.data[0].id : null;
  if (!userId) return null;
  const sel = selectFields || 'id,plan_code,status,company_name,stripe_customer_id';
  const custRes = await supabaseAdminRest(
    `customers?user_id=eq.${encodeURIComponent(userId)}&select=${sel}&limit=1`
  );
  return Array.isArray(custRes.data) && custRes.data[0] ? custRes.data[0] : null;
}

async function ensureAuthUserByEmail(email, fullName = '') {
  if (!email) return null;
  let profile = await findProfileByEmail(email);
  if (profile) return profile;

  const createRes = await supabaseAdminAuth('users', 'POST', {
    email,
    email_confirm: true,
    user_metadata: {
      full_name: fullName || '',
      role: 'client',
    },
  });

  if (!createRes.ok && createRes.status !== 422) {
    return null;
  }

  profile = await findProfileByEmail(email);
  return profile;
}

async function ensureCustomerSeedFromCheckout(session) {
  const email = (session.customer_email || session.metadata?.email || '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'email_missing' };

  const nome = String(session.metadata?.nome || '').trim();
  const empresa = String(session.metadata?.empresa || '').trim();
  const whats = String(session.metadata?.whats || '').trim();
  const plano = String(session.metadata?.plano || '').trim();
  const planCode = normalizePlanCode(plano);
  const billingPeriod = detectBillingPeriod(plano);
  const stripeCustomerId = String(session.customer || '').trim();
  const stripeSubscriptionId = String(session.subscription || '').trim();

  // ── Determina se o pagamento já foi confirmado neste momento ──────
  // Cartão/PIX aprovado → payment_status='paid'                → ativa imediatamente
  // Trial 7 dias        → payment_status='no_payment_required' → ativa (Stripe cobra no fim do trial)
  // Boleto gerado       → payment_status='unpaid' (status='complete') → NÃO ativa (espera pagamento)
  //
  // ATENÇÃO: o check antigo era `... || session.status === 'complete'`, o que tratava
  // boleto gerado (status='complete' + unpaid) como pago — o cliente recebia e-mail de
  // boas-vindas e acesso à IA antes de pagar. Removido.
  const isPaid =
    session.payment_status === 'paid' ||
    session.payment_status === 'no_payment_required';

  const profile = await ensureAuthUserByEmail(email, nome);
  if (!profile?.id) return { ok: false, reason: 'profile_missing' };

  const customerRes = await supabaseAdminRest(`customers?user_id=eq.${encodeURIComponent(profile.id)}&select=id,company_name,whatsapp_number,plan_code,status,stripe_customer_id&limit=1`);
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer?.id) return { ok: false, reason: 'customer_missing' };

  const customerPatch = {
    company_name: empresa || customer.company_name || nome || '',
    plan_code: planCode,
    // Já ativo? mantém. Pagamento confirmado? ativa. Caso contrário: pending_payment
    status: customer.status === 'active'
      ? 'active'
      : (isPaid ? 'active' : 'pending_payment'),
    activated_at: isPaid ? new Date().toISOString() : (customer.activated_at || null),
  };
  if (whats) customerPatch.whatsapp_number = whats;
  if (stripeCustomerId) customerPatch.stripe_customer_id = stripeCustomerId;

  await supabaseAdminRest(`customers?id=eq.${encodeURIComponent(customer.id)}`, 'PATCH', customerPatch);

  const settingsRes = await supabaseAdminRest(`client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=id,whatsapp_display_number,api_key_masked&limit=1`);
  const settings = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0] : null;
  if (settings?.id) {
    const settingsPatch = {};
    if (whats) settingsPatch.whatsapp_display_number = whats;

    const bundle = parseStoredBundle(settings.api_key_masked);
    const runtimeConfig = sanitizeRuntimeConfig(bundle.config || {});
    let shouldPatchBundle = false;
    if (whats && !runtimeConfig.whatsapp_number) {
      runtimeConfig.whatsapp_number = whats;
      shouldPatchBundle = true;
    }
    if (whats && !runtimeConfig.human) {
      runtimeConfig.human = whats;
      shouldPatchBundle = true;
    }
    if (shouldPatchBundle) {
      bundle.config = runtimeConfig;
      settingsPatch.api_key_masked = JSON.stringify(bundle);
    }

    // Quota de IA: só libera se pagamento confirmado
    // ai_msgs_limit = 0 bloqueia checkAndIncrementAiQuota independente do saldo
    settingsPatch.ai_msgs_limit = isPaid ? getPlanAiLimit(planCode) : 0;

    if (Object.keys(settingsPatch).length > 0) {
      await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(settings.id)}`, 'PATCH', settingsPatch);
    }
  }

  if (stripeSubscriptionId) {
    const subscriptionRes = await supabaseAdminRest(`subscriptions?stripe_subscription_id=eq.${encodeURIComponent(stripeSubscriptionId)}&select=id,status&limit=1`);
    const subscription = Array.isArray(subscriptionRes.data) && subscriptionRes.data[0] ? subscriptionRes.data[0] : null;
    const subscriptionPayload = {
      customer_id: customer.id,
      stripe_subscription_id: stripeSubscriptionId,
      plan_code: planCode,
      billing_period: billingPeriod,
      status: isPaid ? 'active' : 'pending_payment',
    };
    if (subscription?.id) {
      await supabaseAdminRest(`subscriptions?id=eq.${encodeURIComponent(subscription.id)}`, 'PATCH', subscriptionPayload);
    } else {
      await supabaseAdminRest('subscriptions', 'POST', subscriptionPayload);
    }
  }

  return { ok: true, customerId: customer.id, profileId: profile.id, isPaid };
}

function parseStoredBundle(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return {};
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return { masked: rawValue };
  }
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function phonesMatch(a, b) {
  const pa = normalizePhone(a);
  const pb = normalizePhone(b);
  // Require at least 8 digits to allow partial matching (avoids spurious matches on short strings)
  if (!pa || !pb || pa.length < 8 || pb.length < 8) return pa === pb;
  // Exact match or last-10-digits match (handles country code variations like +55 prefix)
  if (pa === pb) return true;
  if (pa.length >= 10 && pb.length >= 10 && pa.slice(-10) === pb.slice(-10)) return true;
  // Allow suffix match only when the shorter number is at least 10 digits
  const shorter = pa.length <= pb.length ? pa : pb;
  const longer  = pa.length <= pb.length ? pb : pa;
  if (shorter.length >= 10 && longer.endsWith(shorter)) return true;
  return false;
}

function sanitizeRuntimeConfig(input) {
  const cfg = input || {};
  return {
    nome: sanitizeInput(cfg.nome || cfg.company_name || '', 120),
    segmento: sanitizeInput(cfg.segmento || cfg.seg || '', 120),
    cidade: sanitizeInput(cfg.cidade || '', 120),
    horario: sanitizeInput(cfg.horario || cfg.hr || '', 200),
    descricao: String(cfg.descricao || cfg.desc || '').trim().slice(0, 1200),
    instrucao: String(cfg.instrucao || '').trim().slice(0, 4000), // instrução principal do painel
    faq: String(cfg.faq || '').trim().slice(0, 2400),
    deve: String(cfg.deve || '').trim().slice(0, 1800),
    nunca: String(cfg.nunca || '').trim().slice(0, 1800),
    human: sanitizeInput(cfg.human || cfg.whatsapp || cfg.whatsapp_number || '', 120),
    whatsapp_number: sanitizeInput(cfg.whatsapp_number || cfg.whatsapp || cfg.human || '', 120),
    tom: sanitizeInput(cfg.tom || '', 80),
    nia: sanitizeInput(cfg.nia || '', 120),
  };
}

async function ensureClientSettingsRecord(customerId) {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!normalizedCustomerId) return null;

  const existingRes = await supabaseAdminRest(
    `client_settings?customer_id=eq.${encodeURIComponent(normalizedCustomerId)}&select=id,customer_id,api_key_masked,whatsapp_display_number,bot_enabled,business_hours_enabled,lead_qualification_enabled,followup_enabled,human_handoff_enabled&limit=1`
  );
  const existing = Array.isArray(existingRes.data) && existingRes.data[0] ? existingRes.data[0] : null;
  if (existing) return existing;

  const createPayload = {
    customer_id: normalizedCustomerId,
    api_key_masked: JSON.stringify({ updatedAt: new Date().toISOString() }),
    whatsapp_display_number: null,
    bot_enabled: false,
    business_hours_enabled: false,
    lead_qualification_enabled: false,
    followup_enabled: false,
    human_handoff_enabled: false,
  };
  const createRes = await supabaseAdminRest('client_settings', 'POST', createPayload);
  if (!createRes.ok) return null;

  const createdRes = await supabaseAdminRest(
    `client_settings?customer_id=eq.${encodeURIComponent(normalizedCustomerId)}&select=id,customer_id,api_key_masked,whatsapp_display_number,bot_enabled,business_hours_enabled,lead_qualification_enabled,followup_enabled,human_handoff_enabled&limit=1`
  );
  return Array.isArray(createdRes.data) && createdRes.data[0] ? createdRes.data[0] : null;
}

async function getOrCreateClientSettings(customerId, selectFields) {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!normalizedCustomerId) return null;

  const safeSelect = String(selectFields || 'id,customer_id,api_key_masked,whatsapp_display_number,bot_enabled,business_hours_enabled,lead_qualification_enabled,followup_enabled,human_handoff_enabled').trim();
  const readRes = await supabaseAdminRest(
    `client_settings?customer_id=eq.${encodeURIComponent(normalizedCustomerId)}&select=${safeSelect}&limit=1`
  );
  const existing = Array.isArray(readRes.data) && readRes.data[0] ? readRes.data[0] : null;
  if (existing) return existing;

  const ensured = await ensureClientSettingsRecord(normalizedCustomerId);
  if (!ensured) return null;

  const rereadRes = await supabaseAdminRest(
    `client_settings?customer_id=eq.${encodeURIComponent(normalizedCustomerId)}&select=${safeSelect}&limit=1`
  );
  return Array.isArray(rereadRes.data) && rereadRes.data[0] ? rereadRes.data[0] : ensured;
}

function maskSecret(value, visible = 6) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, visible) + '••••••••';
}

function sanitizeChannelPayload(input, fallbackDisplayNumber = '') {
  const raw = input || {};
  const displayNumber = normalizePhone(raw.display_phone_number || raw.whatsapp_number || fallbackDisplayNumber || '');
  const phoneNumberId = normalizePhone(raw.phone_number_id || '');
  return {
    provider: sanitizeInput(raw.provider || 'meta', 40).toLowerCase() || 'meta',
    phone_number_id: phoneNumberId,
    display_phone_number: displayNumber,
    access_token: String(raw.access_token || '').trim(),
  };
}

function isValidOfficialDisplayNumber(value) {
  const digits = normalizePhone(value);
  return digits.length >= 10 && digits.length <= 15;
}

function sanitizePanelCustomer(customer) {
  return {
    id: customer?.id || '',
    company_name: sanitizeInput(customer?.company_name || '', 120),
    whatsapp_number: normalizePhone(customer?.whatsapp_number || ''),
    plan_code: normalizePlanCode(customer?.plan_code || 'starter'),
    stripe_customer_id: sanitizeInput(customer?.stripe_customer_id || '', 80),
    status: ['active','past_due','pending_payment','canceled','at_risk'].includes(customer?.status)
      ? customer.status : 'active',
  };
}

function sanitizePanelSettings(settings) {
  return {
    bot_enabled: !!settings?.bot_enabled,
    business_hours_enabled: !!settings?.business_hours_enabled,
    lead_qualification_enabled: !!settings?.lead_qualification_enabled,
    followup_enabled: !!settings?.followup_enabled,
    human_handoff_enabled: !!settings?.human_handoff_enabled,
    whatsapp_display_number: normalizePhone(settings?.whatsapp_display_number || ''),
  };
}

function sanitizePanelWorkspace(workspace) {
  const raw = workspace && typeof workspace === 'object' ? workspace : {};
  return {
    notes: sanitizeInput(raw.notes || '', 4000),
    specialHours: sanitizeInput(raw.specialHours || '', 200),
    quickReplies: Array.isArray(raw.quickReplies) ? raw.quickReplies.map((item) => sanitizeInput(item || '', 220)).slice(0, 10) : [],
    goal: sanitizeInput(raw.goal || '', 80),
    leadLabels: sanitizeInput(raw.leadLabels || '', 220),
    priorityReplies: sanitizeInput(raw.priorityReplies || '', 1200),
    followupReminder: sanitizeInput(raw.followupReminder || '', 220),
  };
}

function sanitizePanelChannel(channel, fallbackDisplayNumber = '') {
  const raw = channel && typeof channel === 'object' ? channel : {};
  const display = normalizePhone(raw.display_phone_number || fallbackDisplayNumber || '');
  const phoneNumberId = normalizePhone(raw.phone_number_id || '');
  const tokenMasked = sanitizeInput(raw.access_token_masked || '', 80);
  return {
    provider: sanitizeInput(raw.provider || (phoneNumberId || tokenMasked ? 'meta' : 'pending'), 40).toLowerCase() || 'pending',
    phone_number_id: phoneNumberId,
    display_phone_number: display,
    access_token_masked: tokenMasked,
    verified_name: sanitizeInput(raw.verified_name || '', 120),
    pending: !phoneNumberId || !tokenMasked,
  };
}

function parsePlanCode(plan) {
  const value = String(plan || '').trim().toLowerCase();
  if (!value) return 'starter';
  return value.replace(/_anual$/i, '');
}

// Retorna o limite mensal de mensagens IA para um dado plano
function getPlanAiLimit(planCode) {
  const code = normalizePlanCode(planCode);
  return AI_MSGS_PLAN_LIMITS[code] || AI_MSGS_PLAN_LIMITS.starter;
}

// Verifica se o cliente tem cota disponível e incrementa o contador.
// Retorna { allowed, used, limit, pct, justReset?, exhausted? }
async function checkAndIncrementAiQuota(settingsId, planCode) {
  if (!settingsId) return { allowed: true, used: 0, limit: getPlanAiLimit(planCode) };

  const res = await supabaseAdminRest(
    `client_settings?id=eq.${encodeURIComponent(settingsId)}&select=ai_msgs_used,ai_msgs_limit,ai_msgs_reset_at&limit=1`
  );
  if (!res.ok || !Array.isArray(res.data) || !res.data[0]) {
    // DB indisponível → não bloquear o cliente (fail-open)
    return { allowed: true, used: 0, limit: getPlanAiLimit(planCode) };
  }

  const row     = res.data[0];
  let used      = Number(row.ai_msgs_used  || 0);
  let limit     = Number(row.ai_msgs_limit || getPlanAiLimit(planCode));
  const resetAt = row.ai_msgs_reset_at ? new Date(row.ai_msgs_reset_at) : null;
  const now     = new Date();

  // Reset mensal se passou da data de renovação
  if (resetAt && now >= resetAt) {
    const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(settingsId)}`, 'PATCH', {
      ai_msgs_used:     1,
      ai_msgs_limit:    limit,
      ai_msgs_reset_at: nextReset.toISOString(),
    });
    return { allowed: true, used: 1, limit, pct: 1 / limit, justReset: true };
  }

  // Cota esgotada
  if (used >= limit) {
    return { allowed: false, used, limit, pct: 1.0, exhausted: true };
  }

  // Incremento normal
  const newUsed = used + 1;
  await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(settingsId)}`, 'PATCH', {
    ai_msgs_used: newUsed,
  });

  const newPct = newUsed / limit;
  // justExhausted: este foi o último msg permitido — cota atinge 100%
  const justExhausted = newUsed >= limit;
  // Detecção de cruzamento de threshold (disparo único por nível):
  // Calcula se a mensagem anterior estava abaixo do threshold e agora cruzou.
  const crossed80 = !justExhausted && used < Math.floor(limit * 0.80) && newUsed >= Math.floor(limit * 0.80);
  const crossed90 = !justExhausted && used < Math.floor(limit * 0.90) && newUsed >= Math.floor(limit * 0.90);

  return { allowed: true, used: newUsed, limit, pct: newPct, justExhausted, crossed80, crossed90 };
}

// ── Meta token auto-refresh ───────────────────────────────────────────────────
/**
 * Renova um long-lived token Meta (60 dias → novo ciclo de 60 dias).
 * Usa fb_exchange_token — não requer interação do usuário.
 * Retorna { access_token, expires_at } ou null em caso de falha.
 */
async function refreshMetaLongLivedToken(currentToken) {
  const appId     = typeof META_APP_ID     !== 'undefined' ? String(META_APP_ID     || '').trim() : '';
  const appSecret = typeof META_APP_SECRET !== 'undefined' ? String(META_APP_SECRET || '').trim() : '';
  if (!appId || !appSecret || !currentToken) return null;
  try {
    const res  = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(currentToken)}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) return null;
    const newToken  = String(data.access_token);
    const dbg       = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(newToken)}&access_token=${encodeURIComponent(appId + '|' + appSecret)}`
    );
    const dbgData   = await dbg.json().catch(() => ({}));
    const expiresAt = dbgData?.data?.expires_at
      ? new Date(dbgData.data.expires_at * 1000).toISOString()
      : new Date(Date.now() + 59 * 24 * 60 * 60 * 1000).toISOString();
    return { access_token: newToken, expires_at: expiresAt };
  } catch (_) { return null; }
}

/**
 * Percorre todos os clientes e renova tokens Meta que expiram em < 14 dias.
 * Chamado pelo Cron semanal (toda segunda às 06:05 UTC).
 */
async function refreshExpiringMetaTokens() {
  const cutoff = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const res    = await supabaseAdminRest(`client_settings?select=id,api_key_masked&limit=500`);
  if (!Array.isArray(res?.data)) return 0;
  let count = 0;
  for (const row of res.data) {
    try {
      const bundle  = parseStoredBundle(row.api_key_masked);
      const channel = bundle.channel;
      if (!channel?.access_token_cipher) continue;
      if (channel.connected_via !== 'embedded_signup') continue;
      const expiresAt = channel.token_expires_at ? new Date(channel.token_expires_at) : null;
      if (expiresAt && expiresAt > new Date(cutoff)) continue; // still valid
      const currentToken    = await decryptSecret(channel.access_token_cipher).catch(() => null);
      if (!currentToken) continue;
      const refreshed = await refreshMetaLongLivedToken(currentToken);
      if (!refreshed) continue;
      const newCipher  = await encryptSecret(refreshed.access_token);
      const newChannel = {
        ...channel,
        access_token_cipher: newCipher,
        access_token_masked: maskSecret(refreshed.access_token, 8),
        token_expires_at:    refreshed.expires_at,
        token_refreshed_at:  new Date().toISOString(),
      };
      const newBundle = { ...bundle, channel: newChannel, updatedAt: new Date().toISOString() };
      await supabaseAdminRest(
        `client_settings?id=eq.${encodeURIComponent(row.id)}`, 'PATCH',
        { api_key_masked: JSON.stringify(newBundle) }
      );
      count++;
    } catch (_) {}
  }
  return count;
}

// Reset mensal em massa — chamado pelo Cron Trigger (dia 1 de cada mês)
async function resetMonthlyAiQuotas() {
  const now       = new Date();
  const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  // Busca todos os clientes com reset vencido
  const res = await supabaseAdminRest(
    `client_settings?ai_msgs_reset_at=lte.${encodeURIComponent(now.toISOString())}&select=id,customer_id`
  );
  if (!res.ok || !Array.isArray(res.data) || !res.data.length) return 0;

  let count = 0;
  for (const row of res.data) {
    await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(row.id)}`, 'PATCH', {
      ai_msgs_used:     0,
      ai_msgs_reset_at: nextReset.toISOString(),
    });
    count++;
  }
  return count;
}

function getPlanDefinition(rawPlan) {
  const code = parsePlanCode(normalizePlanCode(rawPlan));
  const catalog = {
    starter: {
      code: 'starter',
      label: 'Starter',
      price: 'R$197/mês',
      conversationLimit: 500,
      numbersLimit: 1,
      capabilitySlots: 3,
      capabilities: {
        advancedOps: false,
        followup: false,
        partnerMode: false,
      },
      nextUpgrade: 'pro',
    },
    pro: {
      code: 'pro',
      label: 'Pro',
      price: 'R$497/mês',
      conversationLimit: 1500,
      numbersLimit: 1,
      capabilitySlots: 4,
      capabilities: {
        advancedOps: true,
        followup: true,
        partnerMode: false,
      },
      nextUpgrade: 'parceiro',
    },
    parceiro: {
      code: 'parceiro',
      label: 'Parceiro',
      price: 'R$1.297/mês',
      conversationLimit: 3000,
      numbersLimit: 1,
      capabilitySlots: 4,
      capabilities: {
        advancedOps: true,
        followup: true,
        partnerMode: true,
      },
      nextUpgrade: '',
    },
  };
  return catalog[code] || catalog.starter;
}

function buildMonthKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 7);
}

function normalizeUsageMetrics(input) {
  const usage = input && typeof input === 'object' ? input : {};
  const monthKey = String(usage.monthKey || buildMonthKey()).slice(0, 7);
  const contactHashes = Array.isArray(usage.contactHashes)
    ? usage.contactHashes.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 5000)
    : [];
  return {
    monthKey,
    inboundMessagesMonth: Number.isFinite(Number(usage.inboundMessagesMonth)) ? Math.max(0, Number(usage.inboundMessagesMonth)) : 0,
    uniqueContactsMonth: Number.isFinite(Number(usage.uniqueContactsMonth)) ? Math.max(0, Number(usage.uniqueContactsMonth)) : 0,
    totalInboundMessages: Number.isFinite(Number(usage.totalInboundMessages)) ? Math.max(0, Number(usage.totalInboundMessages)) : 0,
    lastInboundAt: usage.lastInboundAt ? String(usage.lastInboundAt) : '',
    contactHashes,
  };
}

function sanitizeWorkspacePayload(input) {
  const payload = input && typeof input === 'object' ? input : {};
  return {
    notes: String(payload.notes || '').trim().slice(0, 4000),
    specialHours: sanitizeInput(payload.specialHours || '', 200),
    quickReplies: Array.isArray(payload.quickReplies)
      ? payload.quickReplies.map((item) => String(item || '').trim().slice(0, 220)).filter(Boolean).slice(0, 10)
      : [],
    goal: sanitizeInput(payload.goal || 'vender', 80),
    leadLabels: sanitizeInput(payload.leadLabels || '', 220),
    priorityReplies: String(payload.priorityReplies || '').trim().slice(0, 1200),
    followupReminder: sanitizeInput(payload.followupReminder || '', 220),
  };
}

function mergeWorkspacePayload(currentWorkspace, incomingWorkspace, mode = 'base') {
  const current = currentWorkspace && typeof currentWorkspace === 'object' ? currentWorkspace : {};
  const incoming = sanitizeWorkspacePayload(incomingWorkspace);
  if (mode === 'advanced') {
    return {
      ...current,
      goal: incoming.goal,
      leadLabels: incoming.leadLabels,
      priorityReplies: incoming.priorityReplies,
      followupReminder: incoming.followupReminder,
    };
  }
  return {
    ...current,
    notes: incoming.notes,
    specialHours: incoming.specialHours,
    quickReplies: incoming.quickReplies,
  };
}

function getAllowedSettingsPatch(planDefinition, body) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'bot_enabled')) {
    patch.bot_enabled = !!body.bot_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'business_hours_enabled')) {
    patch.business_hours_enabled = !!body.business_hours_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'lead_qualification_enabled')) {
    patch.lead_qualification_enabled = !!body.lead_qualification_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'human_handoff_enabled')) {
    patch.human_handoff_enabled = !!body.human_handoff_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'followup_enabled')) {
    if (!planDefinition.capabilities.followup && body.followup_enabled) {
      return { ok: false, error: 'A retomada automática faz parte do plano Pro ou superior.' };
    }
    patch.followup_enabled = planDefinition.capabilities.followup ? !!body.followup_enabled : false;
  }
  return { ok: true, patch };
}

function getFeatureUsageSnapshot(planDefinition, settings, workspace) {
  const enabled = [
    !!settings?.business_hours_enabled,
    !!settings?.lead_qualification_enabled,
    !!settings?.human_handoff_enabled,
    !!settings?.followup_enabled && !!planDefinition.capabilities.followup,
  ].filter(Boolean).length;
  const advancedConfigured = !!(workspace?.goal || workspace?.leadLabels || workspace?.priorityReplies || workspace?.followupReminder);
  return {
    enabled,
    total: planDefinition.capabilitySlots,
    advancedConfigured,
  };
}

function getUpgradeRecommendation(planDefinition, usage, featureUsage, runtime) {
  const currentPlan = planDefinition.label;
  const config = runtime?.config || {};
  const hasConfiguredFaq = !!String(config.faq || '').trim();
  const hasConfiguredDescription = !!String(config.descricao || '').trim();
  const utilization = planDefinition.conversationLimit > 0
    ? usage.inboundMessagesMonth / planDefinition.conversationLimit
    : 0;

  if (planDefinition.code === 'starter') {
    if (featureUsage.advancedConfigured) {
      return {
        shouldUpgrade: true,
        targetPlan: 'Pro',
        title: 'Sua operação já pede controles do plano Pro',
        reason: 'Você já começou a estruturar regras de operação avançada. O Pro libera esses controles sem improviso.',
      };
    }
    if (utilization >= 0.7 || usage.uniqueContactsMonth >= 80) {
      return {
        shouldUpgrade: true,
        targetPlan: 'Pro',
        title: 'Sua operação está perto da faixa do Starter',
        reason: 'O volume deste mês já está próximo da faixa do Starter. O Pro dá mais espaço e mais controle sem travar a operação.',
      };
    }
    if (runtime?.channel?.phone_number_id && hasConfiguredFaq && hasConfiguredDescription && usage.uniqueContactsMonth >= 20) {
      return {
        shouldUpgrade: true,
        targetPlan: 'Pro',
        title: 'Seu canal já está rodando como operação comercial',
        reason: 'Seu canal já está configurado e recebendo contatos reais. O Pro ajuda a qualificar e organizar melhor a operação na próxima fase.',
      };
    }
  }

  if (planDefinition.code === 'pro') {
    if (utilization >= 0.8 || usage.uniqueContactsMonth >= 250) {
      return {
        shouldUpgrade: true,
        targetPlan: 'Parceiro',
        title: 'Seu volume já aponta para operação multi-cliente',
        reason: 'O uso atual já está alto para o Pro. O plano Parceiro abre uma estrutura mais robusta para escalar e organizar carteiras.',
      };
    }
  }

  return {
    shouldUpgrade: false,
    targetPlan: '',
    title: 'Seu plano atual está adequado',
    reason: 'No momento, o uso e a configuração da sua conta ainda cabem bem no plano atual.',
  };
}

function getSubscriptionStatusLabel(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'active') return 'Assinatura ativa';
  if (value === 'trialing') return 'Ativação em andamento';
  if (value === 'past_due') return 'Cobrança pendente';
  if (value === 'canceled') return 'Assinatura cancelada';
  return 'Configuração em andamento';
}

function buildBillingHistory(planDefinition, customer, latestSubscription) {
  const customerStatus = String(customer?.status || '').trim().toLowerCase();
  if (!latestSubscription) {
    return [{
      date: customer?.created_at ? String(customer.created_at).slice(0, 10) : 'Conta criada',
      desc: `${planDefinition.label} — ${customerStatus === 'active' ? 'assinatura em preparação' : 'ativação inicial'}`,
      val: planDefinition.price,
      status: customerStatus === 'active' ? 'paid' : 'pending',
    }];
  }
  return [{
    date: latestSubscription.created_at ? String(latestSubscription.created_at).slice(0, 10) : 'Atual',
    desc: `${planDefinition.label} — ${latestSubscription.billing_period === 'annual' ? 'anual' : 'mensal'}`,
    val: planDefinition.price,
    status: String(latestSubscription.status || '').toLowerCase() === 'active' ? 'paid' : 'pending',
  }];
}

function buildPlanSummary(runtime, latestSubscription) {
  const bundle = parseStoredBundle(runtime?.settings?.api_key_masked);
  const usage = normalizeUsageMetrics(bundle.analytics || {});
  const planDefinition = getPlanDefinition(runtime?.customer?.plan_code);
  const featureUsage = getFeatureUsageSnapshot(planDefinition, runtime?.settings, bundle.workspace || {});
  const activatedAt = runtime?.customer?.activated_at || runtime?.customer?.created_at || new Date().toISOString();
  const recommendation = getUpgradeRecommendation(planDefinition, usage, featureUsage, runtime);
  return {
    plan: {
      code: planDefinition.code,
      label: planDefinition.label,
      price: planDefinition.price,
      statusLabel: getSubscriptionStatusLabel(latestSubscription?.status || runtime?.customer?.status),
      capabilities: planDefinition.capabilities,
      limits: {
        conversations: planDefinition.conversationLimit,
        numbers: planDefinition.numbersLimit,
        features: planDefinition.capabilitySlots,
      },
      nextUpgrade: recommendation.targetPlan,
    },
    usage: {
      monthKey: usage.monthKey,
      conversations: usage.inboundMessagesMonth,
      uniqueContacts: usage.uniqueContactsMonth,
      totalInboundMessages: usage.totalInboundMessages,
      lastInboundAt: usage.lastInboundAt,
      channelsConnected: runtime?.channel?.phone_number_id ? 1 : 0,
      featureUsage,
      daysActive: Math.max(Math.floor((Date.now() - new Date(activatedAt).getTime()) / 86400000), 1),
      // Cota de mensagens IA
      aiMsgsUsed:    Number(runtime?.settings?.ai_msgs_used    || 0),
      aiMsgsLimit:   Number(runtime?.settings?.ai_msgs_limit   || getPlanAiLimit(runtime?.customer?.plan_code || 'starter')),
      aiMsgsResetAt: runtime?.settings?.ai_msgs_reset_at || null,
      aiMsgsPct:     Number(runtime?.settings?.ai_msgs_limit   || 1) > 0
        ? Number(runtime?.settings?.ai_msgs_used || 0) / Number(runtime?.settings?.ai_msgs_limit || 1)
        : 0,
    },
    billing: {
      hasPortal: !!runtime?.customer?.stripe_customer_id,
      status: getSubscriptionStatusLabel(latestSubscription?.status || runtime?.customer?.status),
      history: buildBillingHistory(planDefinition, runtime?.customer, latestSubscription),
      latestSubscription: latestSubscription || null,
    },
    checkout: buildCheckoutReadiness(),
    recommendation,
  };
}

function buildCheckoutReadiness() {
  const hasStripeSecret = !!String(typeof STRIPE_SECRET_KEY !== 'undefined' ? STRIPE_SECRET_KEY : '').trim();
  const usdKeys = {
    STRIPE_PRICE_STARTER_USD: String(typeof STRIPE_PRICE_STARTER_USD !== 'undefined' ? STRIPE_PRICE_STARTER_USD : '').trim(),
    STRIPE_PRICE_PRO_USD: String(typeof STRIPE_PRICE_PRO_USD !== 'undefined' ? STRIPE_PRICE_PRO_USD : '').trim(),
    STRIPE_PRICE_PARCEIRO_USD: String(typeof STRIPE_PRICE_PARCEIRO_USD !== 'undefined' ? STRIPE_PRICE_PARCEIRO_USD : '').trim(),
    STRIPE_PRICE_STARTER_ANUAL_USD: String(typeof STRIPE_PRICE_STARTER_ANUAL_USD !== 'undefined' ? STRIPE_PRICE_STARTER_ANUAL_USD : '').trim(),
    STRIPE_PRICE_PRO_ANUAL_USD: String(typeof STRIPE_PRICE_PRO_ANUAL_USD !== 'undefined' ? STRIPE_PRICE_PRO_ANUAL_USD : '').trim(),
    STRIPE_PRICE_PARCEIRO_ANUAL_USD: String(typeof STRIPE_PRICE_PARCEIRO_ANUAL_USD !== 'undefined' ? STRIPE_PRICE_PARCEIRO_ANUAL_USD : '').trim(),
  };
  const missingUsd = Object.entries(usdKeys)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const ptReady = hasStripeSecret;
  const esReady = hasStripeSecret && missingUsd.length === 0;
  return {
    pt: {
      ready: ptReady,
      currency: 'BRL',
      note: ptReady
        ? 'Checkout em reais pronto para o fluxo principal.'
        : 'Falta a STRIPE_SECRET_KEY para ativar o checkout em reais.',
      missing: ptReady ? [] : ['STRIPE_SECRET_KEY'],
    },
    es: {
      ready: esReady,
      currency: 'USD',
      note: esReady
        ? 'Checkout em dólares pronto para a jornada em espanhol.'
        : 'Ainda faltam price IDs USD para o checkout em espanhol.',
      missing: hasStripeSecret ? missingUsd : ['STRIPE_SECRET_KEY'].concat(missingUsd),
    },
    branding: {
      ready: false,
      note: 'Revise no painel Stripe se o Checkout já exibe MercaBot como marca pública.',
    },
  };
}

async function hashValue(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function trackInboundUsage(runtime, from) {
  if (!runtime?.settings?.id) return;
  const bundle = parseStoredBundle(runtime.settings.api_key_masked);
  const usage = normalizeUsageMetrics(bundle.analytics || {});
  const currentMonth = buildMonthKey();
  if (usage.monthKey !== currentMonth) {
    usage.monthKey = currentMonth;
    usage.inboundMessagesMonth = 0;
    usage.uniqueContactsMonth = 0;
    usage.contactHashes = [];
  }
  usage.inboundMessagesMonth += 1;
  usage.totalInboundMessages += 1;
  usage.lastInboundAt = new Date().toISOString();
  const contactHash = await hashValue(normalizePhone(from));
  if (contactHash && !usage.contactHashes.includes(contactHash)) {
    usage.contactHashes = usage.contactHashes.concat(contactHash).slice(-5000);
    usage.uniqueContactsMonth += 1;
  }
  bundle.analytics = usage;
  bundle.updatedAt = new Date().toISOString();
  await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(runtime.settings.id)}`, 'PATCH', {
    api_key_masked: JSON.stringify(bundle),
  });
}

async function loadLatestSubscription(customerId, jwt) {
  if (!customerId) return null;
  const res = await supabaseRest(
    `subscriptions?customer_id=eq.${encodeURIComponent(customerId)}&select=id,status,plan_code,billing_period,created_at,stripe_subscription_id&order=created_at.desc&limit=1`,
    jwt
  );
  return Array.isArray(res.data) && res.data[0] ? res.data[0] : null;
}

// findProfileByEmail: definição única — ver a versão acima (getCustomerByEmail usa profiles internamente)
async function ensureProfileByEmail(email, nome = '') {
  let profile = await findProfileByEmail(email);
  if (profile) return profile;

  const createRes = await supabaseAdminAuth('users', 'POST', {
    email,
    email_confirm: true,
    user_metadata: {
      full_name: nome || '',
      role: 'client',
    },
  });

  if (!createRes.ok) {
    const message = String(createRes.data?.msg || createRes.data?.message || createRes.data?.error || '');
    if (!/already/i.test(message)) {
      return null;
    }
  }

  profile = await findProfileByEmail(email);
  return profile;
}

async function ensureCustomerRecordForUser(user) {
  const userId = String(user?.id || '').trim();
  if (!userId) return null;

  const existingRes = await supabaseAdminRest(
    `customers?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,company_name,whatsapp_number,plan_code,status,created_at,activated_at,stripe_customer_id&limit=1`
  );
  const existing = Array.isArray(existingRes.data) && existingRes.data[0] ? existingRes.data[0] : null;
  if (existing) return existing;

  const fallbackName = sanitizeInput(
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'Nova conta',
    100
  ) || 'Nova conta';

  const createPayload = {
    user_id: userId,
    company_name: fallbackName,
    plan_code: 'starter',
    status: 'trial',
    whatsapp_number: null,
    activated_at: new Date().toISOString(),
  };

  const createRes = await supabaseAdminRest('customers', 'POST', createPayload);
  if (!createRes.ok && createRes.status !== 409) {
    return null;
  }

  const rereadRes = await supabaseAdminRest(
    `customers?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,company_name,whatsapp_number,plan_code,status,created_at,activated_at,stripe_customer_id&limit=1`
  );
  return Array.isArray(rereadRes.data) && rereadRes.data[0] ? rereadRes.data[0] : null;
}

async function ensureCustomerDataFromCheckout(session) {
  const email = String(session?.customer_email || session?.metadata?.email || '').trim().toLowerCase();
  const nome = sanitizeInput(session?.metadata?.nome || '', 100);
  const empresa = sanitizeInput(session?.metadata?.empresa || '', 100);
  const whats = sanitizeInput(session?.metadata?.whats || '', 30);
  const plano = parsePlanCode(session?.metadata?.plano || '');
  if (!email) return;

  const profile = await ensureProfileByEmail(email, nome);
  if (!profile?.id) return;

  const customerRes = await supabaseAdminRest(`customers?user_id=eq.${encodeURIComponent(profile.id)}&select=id,company_name,whatsapp_number,stripe_customer_id,plan_code,status&limit=1`);
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer?.id) return;

  const customerPatch = {
    plan_code: plano || customer.plan_code || 'starter',
    status: session?.payment_status === 'paid' || session?.status === 'complete' ? 'active' : (customer.status || 'trial'),
    activated_at: new Date().toISOString(),
  };
  if (empresa && empresa !== customer.company_name) customerPatch.company_name = empresa;
  if (whats && whats !== customer.whatsapp_number) customerPatch.whatsapp_number = whats;
  if (session?.customer && session.customer !== customer.stripe_customer_id) customerPatch.stripe_customer_id = String(session.customer);

  await supabaseAdminRest(`customers?id=eq.${encodeURIComponent(customer.id)}`, 'PATCH', customerPatch);

  const settingsRes = await supabaseAdminRest(`client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=id,api_key_masked,whatsapp_display_number&limit=1`);
  const settings = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0] : null;
  if (settings?.id) {
    const bundle = parseStoredBundle(settings.api_key_masked);
    const nextConfig = sanitizeRuntimeConfig({
      ...(bundle.config || {}),
      nome: (bundle.config || {}).nome || empresa || '',
      whatsapp_number: (bundle.config || {}).whatsapp_number || whats || '',
      human: (bundle.config || {}).human || whats || '',
    });
    await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(settings.id)}`, 'PATCH', {
      api_key_masked: JSON.stringify({ ...bundle, config: nextConfig, updatedAt: new Date().toISOString() }),
      whatsapp_display_number: whats || settings.whatsapp_display_number || null,
    });
  }

  if (session?.subscription) {
    const subId = String(session.subscription);
    const existingSubRes = await supabaseAdminRest(`subscriptions?stripe_subscription_id=eq.${encodeURIComponent(subId)}&select=id&limit=1`);
    const existingSub = Array.isArray(existingSubRes.data) && existingSubRes.data[0] ? existingSubRes.data[0] : null;
    const subPayload = {
      customer_id: customer.id,
      stripe_subscription_id: subId,
      stripe_price_id: String(session?.metadata?.price_id || ''),
      plan_code: plano || 'starter',
      billing_period: /_anual$/i.test(String(session?.metadata?.plano || '')) ? 'annual' : 'monthly',
      status: session?.payment_status === 'paid' || session?.status === 'complete' ? 'active' : 'trialing',
    };
    if (existingSub?.id) {
      await supabaseAdminRest(`subscriptions?id=eq.${encodeURIComponent(existingSub.id)}`, 'PATCH', subPayload);
    } else {
      await supabaseAdminRest('subscriptions', 'POST', subPayload);
    }
  }
}

// Strings de erro localizadas (PT/ES/EN). Chaves usadas pelos endpoints
// que recebem `lang` no body (criar-checkout, onboarding, magic-link, etc).
// Frontend exibe como toast direto — não precisa mapear no cliente.
const _ERR_BUNDLES = {
  pt: {
    INVALID_EMAIL:        'Email inválido.',
    INVALID_PHONE:        'Número de WhatsApp inválido.',
    PHONE_REQUIRED:       'Informe o número oficial da empresa para continuar.',
    PLAN_OR_EMAIL:        'Plano inválido ou email ausente',
    USD_NOT_READY:        'O checkout em dólares ainda não está configurado. Entre em contato com o suporte.',
    RATE_LIMIT:           'Muitas tentativas. Aguarde 1 minuto e tente novamente.',
    SESSION_INVALID:      'Sessão inválida.',
    GENERIC:              'Não foi possível concluir agora. Tente novamente em instantes.',
    TIMEOUT:              'A conexão expirou. Verifique sua internet e tente de novo.',
    AUTH_DELIVERY:        'Se o endereço informado puder receber acesso, enviaremos o link em instantes.',
    REDIRECT_INVALID:     'URL de retorno inválida.',
    ORIGIN_NOT_ALLOWED:   'Origem de autenticação não autorizada.',
    INVALID_DATA:         'Dados inválidos.'
  },
  es: {
    INVALID_EMAIL:        'Correo electrónico inválido.',
    INVALID_PHONE:        'Número de WhatsApp inválido.',
    PHONE_REQUIRED:       'Ingresa el número oficial de la empresa para continuar.',
    PLAN_OR_EMAIL:        'Plan inválido o correo ausente',
    USD_NOT_READY:        'El checkout en dólares aún no está configurado. Contacta a soporte.',
    RATE_LIMIT:           'Demasiados intentos. Espera 1 minuto e intenta de nuevo.',
    SESSION_INVALID:      'Sesión inválida.',
    GENERIC:              'No fue posible completar ahora. Intenta de nuevo en unos instantes.',
    TIMEOUT:              'La conexión expiró. Verifica tu internet e intenta de nuevo.',
    AUTH_DELIVERY:        'Si la dirección informada puede recibir acceso, enviaremos el enlace en breve.',
    REDIRECT_INVALID:     'URL de retorno inválida.',
    ORIGIN_NOT_ALLOWED:   'Origen de autenticación no autorizado.',
    INVALID_DATA:         'Datos inválidos.'
  },
  en: {
    INVALID_EMAIL:        'Invalid email.',
    INVALID_PHONE:        'Invalid WhatsApp number.',
    PHONE_REQUIRED:       'Enter your business official number to continue.',
    PLAN_OR_EMAIL:        'Invalid plan or missing email',
    USD_NOT_READY:        'USD checkout is not yet configured. Please contact support.',
    RATE_LIMIT:           'Too many attempts. Wait 1 minute and try again.',
    SESSION_INVALID:      'Invalid session.',
    GENERIC:              'Could not complete right now. Please try again shortly.',
    TIMEOUT:              'Connection timed out. Check your internet and try again.',
    AUTH_DELIVERY:        'If the address provided can receive access, we will send the link shortly.',
    REDIRECT_INVALID:     'Invalid return URL.',
    ORIGIN_NOT_ALLOWED:   'Authentication origin not allowed.',
    INVALID_DATA:         'Invalid data.'
  }
};
// Resolve mensagem localizada por chave + lang (default pt). Fallback PT
// quando a chave não existe no bundle do idioma.
function _errMsg(code, lang) {
  const L = (lang === 'es' || lang === 'en') ? lang : 'pt';
  return (_ERR_BUNDLES[L] && _ERR_BUNDLES[L][code])
      || (_ERR_BUNDLES.pt[code])
      || code;
}

// Detecta idioma esperado pelo código de país do número de telefone.
// Retorna 'pt' (Brasil +55), 'en' (EUA/Canadá +1) ou 'es' (demais países LatAm).
function _phoneLang(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return 'auto';
  if (digits.startsWith('55')) return 'pt';
  if (digits.startsWith('1'))  return 'en';
  return 'es';
}

// Mensagens de fallback localizadas para casos onde o bot não pode responder
// com IA (bot pausado, chave IA ausente, etc). Mantém o lead engajado até a
// equipe humana retornar, em vez de silenciar.
function _fallbackBotPaused(phone, humanPhone) {
  const lang = _phoneLang(phone);
  const human = String(humanPhone || '').trim();
  if (lang === 'en') {
    return human
      ? `Hi! Our automated service is paused right now. A team member will reach out shortly. For urgent matters, you can also message: ${human}`
      : `Hi! We received your message. Our automated service is paused right now — a team member will get back to you soon.`;
  }
  if (lang === 'es') {
    return human
      ? `¡Hola! Nuestro atendimiento automático está pausado en este momento. Un miembro del equipo le responderá en breve. Si es urgente, puede escribir directamente al: ${human}`
      : `¡Hola! Recibimos su mensaje. Nuestro atendimiento automático está pausado — un miembro del equipo le responderá en breve.`;
  }
  return human
    ? `Olá! No momento o atendimento automático está pausado. Em breve um de nossos atendentes entra em contato. Se for urgente, fale também pelo: ${human}`
    : `Olá! Recebemos sua mensagem. O atendimento automático está pausado — um de nossos atendentes responde em breve.`;
}

async function callAnthropic(apiKey, config, messages, senderPhone) {
  const resolvedApiKey = String(apiKey || (typeof ANTHROPIC_API_KEY !== 'undefined' ? ANTHROPIC_API_KEY : '') || '').trim();
  if (!resolvedApiKey || !resolvedApiKey.startsWith('sk-ant')) {
    return {
      ok: false,
      status: 500,
      data: JSON.stringify({ error: { message: 'IA premium indisponível no backend.' } }),
    };
  }
  const systemPrompt = buildAssistantPrompt(config, senderPhone);
  // Itera pelos modelos em ordem — se o primário estiver depreciado (404), tenta o próximo.
  // Garante que uma atualização de modelo da Anthropic nunca derruba o bot silenciosamente.
  for (const model of ANTHROPIC_MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), 25000);
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': resolvedApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 1024, system: systemPrompt, messages }),
        signal: controller.signal,
      });
      const rawText = await anthropicRes.text();
      // 404 = modelo depreciado ou inexistente → tenta próximo da lista
      if (anthropicRes.status === 404) continue;
      // Detecta erros de billing/saldo da Anthropic — exige reload de créditos.
      // 402 = Payment Required; 401 = chave inválida; corpo contém "credit balance"
      // ou type=billing_error. Sinaliza com flag billingError para o caller alertar admin.
      const billingError = (anthropicRes.status === 402)
        || (anthropicRes.status === 401)
        || /credit\s*balance|billing|insufficient.*funds|payment.*required/i.test(rawText || '');
      return { ok: anthropicRes.ok, status: anthropicRes.status, data: rawText, billingError };
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    ok: false,
    status: 404,
    data: JSON.stringify({ error: { message: 'Nenhum modelo de IA disponível. Atualize a lista ANTHROPIC_MODELS.' } }),
  };
}

async function loadCustomerRuntimeByWhatsApp(displayPhone) {
  const settingsRes = await supabaseAdminRest('client_settings?select=id,customer_id,whatsapp_display_number,api_key_masked,ai_msgs_used,ai_msgs_limit,ai_msgs_reset_at,bot_enabled,human_handoff_enabled');
  if (!settingsRes.ok || !Array.isArray(settingsRes.data)) return null;

  for (const row of settingsRes.data) {
    const bundle = parseStoredBundle(row.api_key_masked);
    const savedConfig = sanitizeRuntimeConfig(bundle.config || {});
    const savedChannel = sanitizeChannelPayload(bundle.channel || {}, row.whatsapp_display_number || '');
    const candidates = [
      row.whatsapp_display_number,
      savedConfig.whatsapp_number,
      savedConfig.human,
      savedChannel.display_phone_number,
    ];
    if (!candidates.some((candidate) => phonesMatch(candidate, displayPhone))) continue;

    const customerRes = await supabaseAdminRest(`customers?id=eq.${encodeURIComponent(row.customer_id)}&select=id,company_name,whatsapp_number,plan_code,status&limit=1`);
    const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
    if (!customer) continue;

    // Bloqueia processamento para clientes sem pagamento confirmado
    // pending_payment = boleto não pago | past_due = inadimplente | canceled = cancelado
    const BLOCKED_STATUSES = ['pending_payment', 'past_due', 'canceled'];
    if (BLOCKED_STATUSES.includes(customer.status)) continue;

    let apiKey = '';
    if (bundle.cipher) {
      try { apiKey = await decryptSecret(bundle.cipher); } catch (_) {}
    }

    let channelAccessToken = '';
    if (bundle.channel && bundle.channel.access_token_cipher) {
      try { channelAccessToken = await decryptSecret(bundle.channel.access_token_cipher); } catch (_) {}
    }

    const savedWorkspace = bundle.workspace && typeof bundle.workspace === 'object' ? bundle.workspace : {};
    const config = {
      ...savedConfig,
      nome: savedConfig.nome || customer.company_name || '',
      human: savedConfig.human || savedChannel.display_phone_number || row.whatsapp_display_number || customer.whatsapp_number || '',
      whatsapp_number: savedConfig.whatsapp_number || savedChannel.display_phone_number || row.whatsapp_display_number || customer.whatsapp_number || '',
      // Instrução principal do painel → incorporada no prompt da IA
      instrucao: savedConfig.instrucao || String(savedWorkspace.notes || '').trim(),
      horario: savedConfig.horario || String(savedWorkspace.specialHours || '').trim(),
    };

    return {
      customer,
      settings: row,
      apiKey,
      config,
      workspace: savedWorkspace, // expõe followupReminder e outros campos avançados
      phoneNumberId: savedChannel.phone_number_id || '',
      accessToken: channelAccessToken || '',
    };
  }

  return null;
}

async function loadCustomerRuntimeByJwt(jwt) {
  const user = await getSupabaseUser(jwt);
  if (!user?.id) return null;

  let customerRes = await supabaseRest(`customers?user_id=eq.${encodeURIComponent(user.id)}&select=id,company_name,whatsapp_number,plan_code,status,created_at,activated_at,stripe_customer_id&limit=1`, jwt);
  let customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer) {
    customer = await ensureCustomerRecordForUser(user);
  }
  if (!customer) return null;

  let settingsRes = await supabaseRest(`client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=id,api_key_masked,whatsapp_display_number,bot_enabled,business_hours_enabled,lead_qualification_enabled,followup_enabled,human_handoff_enabled,ai_msgs_used,ai_msgs_limit,ai_msgs_reset_at&limit=1`, jwt);
  let settings = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0] : null;
  if (!settings) {
    settings = await getOrCreateClientSettings(customer.id, 'id,api_key_masked,whatsapp_display_number,bot_enabled,business_hours_enabled,lead_qualification_enabled,followup_enabled,human_handoff_enabled,ai_msgs_used,ai_msgs_limit,ai_msgs_reset_at');
  }
  if (!settings) return null;

  const bundle = parseStoredBundle(settings.api_key_masked);
  const savedConfig = sanitizeRuntimeConfig(bundle.config || {});
  const savedChannel = sanitizeChannelPayload(bundle.channel || {}, settings.whatsapp_display_number || customer.whatsapp_number || '');

  let apiKey = '';
  if (bundle.cipher) {
    try { apiKey = await decryptSecret(bundle.cipher); } catch (_) {}
  }

  let channelAccessToken = '';
  if (bundle.channel && bundle.channel.access_token_cipher) {
    try { channelAccessToken = await decryptSecret(bundle.channel.access_token_cipher); } catch (_) {}
  }

  const savedWorkspace = bundle.workspace && typeof bundle.workspace === 'object' ? bundle.workspace : {};
  const config = {
    ...savedConfig,
    nome: savedConfig.nome || customer.company_name || '',
    human: savedConfig.human || savedChannel.display_phone_number || settings.whatsapp_display_number || customer.whatsapp_number || '',
    whatsapp_number: savedConfig.whatsapp_number || savedChannel.display_phone_number || settings.whatsapp_display_number || customer.whatsapp_number || '',
    // Instrução principal do painel → incorporada no prompt da IA
    instrucao: savedConfig.instrucao || String(savedWorkspace.notes || '').trim(),
    horario: savedConfig.horario || String(savedWorkspace.specialHours || '').trim(),
  };

  return {
    customer,
    settings,
    apiKey,
    config,
    userEmail: user.email || '',
    phoneNumberId: savedChannel.phone_number_id || '',
    accessToken: channelAccessToken || '',
    channel: savedChannel,
  };
}

async function sendWhatsAppText(phoneNumberId, to, text, accessToken) {
  const token = String(accessToken || WHATSAPP_TOKEN || '').trim();
  if (!token || !phoneNumberId || !to || !text) {
    return { ok: false, status: 500, data: { error: 'Credenciais ou destino do WhatsApp ausentes.' } };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      text: { body: text.slice(0, 4096) },
    }),
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: payload };
}

async function validateWhatsAppChannel(channel) {
  const provider = String(channel?.provider || 'meta').toLowerCase();
  if (provider !== 'meta') {
    return { ok: false, status: 400, data: { error: 'Provedor de canal ainda não suportado nesta validação.' } };
  }

  const token = String(channel?.access_token || '').trim();
  const phoneNumberId = String(channel?.phone_number_id || '').trim();
  if (!token || !phoneNumberId) {
    return { ok: false, status: 400, data: { error: 'Credenciais do canal incompletas.' } };
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error?.message || payload?.message || 'Não foi possível validar o número oficial informado.';
    return { ok: false, status: res.status, data: { error: message } };
  }

  return {
    ok: true,
    status: 200,
    data: {
      id: payload?.id || phoneNumberId,
      display_phone_number: payload?.display_phone_number || channel.display_phone_number || '',
      verified_name: payload?.verified_name || '',
    },
  };
}

function extractInboundWhatsAppText(msg) {
  const type = String(msg?.type || '').trim();
  if (type === 'text') {
    return String(msg?.text?.body || '').trim();
  }
  if (type === 'button') {
    return String(msg?.button?.text || msg?.button?.payload || '').trim();
  }
  if (type === 'interactive') {
    const interactive = msg?.interactive || {};
    const buttonReply = interactive?.button_reply || {};
    const listReply = interactive?.list_reply || {};
    return String(
      buttonReply?.title ||
      buttonReply?.id ||
      listReply?.title ||
      listReply?.description ||
      listReply?.id ||
      ''
    ).trim();
  }
  if (type === 'image' || type === 'video' || type === 'document') {
    return String(msg?.[type]?.caption || '').trim();
  }
  return '';
}

// ── ROUTER ────────────────────────────────────────────────────────

// ── Rate limiting for checkout endpoint ──────────────────────────
// Uses Cloudflare's built-in IP via CF-Connecting-IP header
const RATE_LIMIT = new Map(); // In-memory, resets per Worker instance
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_REQUESTS = 5;   // Max 5 sensitive attempts per IP per minute

function checkRateLimit(ip, bucket = 'default', maxRequests = RATE_MAX_REQUESTS, windowMs = RATE_WINDOW_MS) {
  const now = Date.now();
  const key = `${bucket}:${ip || 'unknown'}`;
  const record = RATE_LIMIT.get(key) || { count: 0, windowStart: now };
  
  if (now - record.windowStart > windowMs) {
    // New window
    RATE_LIMIT.set(key, { count: 1, windowStart: now });
    return false; // Not limited
  }
  
  if (record.count >= maxRequests) {
    return true; // Rate limited
  }
  
  record.count++;
  RATE_LIMIT.set(key, record);
  return false; // Not limited
}

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown';
}


// ── Input sanitization ────────────────────────────────────────────
function sanitizeInput(str, maxLen = 200) {
  if (!str) return '';
  return String(str)
    .trim()
    .slice(0, maxLen)
    .replace(/[<>"'`]/g, ''); // Strip HTML-dangerous chars
}

function validateEmail(email) {
  return /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,10}$/.test(email);
}

function validatePhone(phone) {
  if (!phone) return true; // Optional field
  return /^[+\d\s\-().]{7,20}$/.test(phone);
}

function buildWhatsAppSalesRedirect(url) {
  const salesNumber = String((typeof WHATSAPP_SALES_NUMBER !== 'undefined' ? WHATSAPP_SALES_NUMBER : '') || '5531998219149')
    .replace(/\D/g, '')
    .trim();
  if (!salesNumber) return null;
  const text = sanitizeInput(url.searchParams.get('text') || '', 900);
  const params = new URLSearchParams();
  if (text) params.set('text', text);
  const query = params.toString();
  return `https://wa.me/${salesNumber}${query ? `?${query}` : ''}`;
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// Cron Trigger — executa todo dia 1 de cada mês às 00:05 UTC
addEventListener('scheduled', event => {
  event.waitUntil(handleScheduled(event));
});

async function handleScheduled(event) {
  const cron = event.cron || '';
  // Reset mensal de cotas de IA (dia 1 de cada mês às 00:05 UTC)
  if (cron === '5 0 1 * *' || cron === '') {
    const count = await resetMonthlyAiQuotas().catch(() => 0);
    console.log(`[cron] resetMonthlyAiQuotas: ${count} contas resetadas`);
  }
  // Renovação semanal de tokens Meta prestes a expirar (toda segunda às 06:05 UTC)
  if (cron === '5 6 * * 1' || cron === '') {
    const count = await refreshExpiringMetaTokens().catch(() => 0);
    console.log(`[cron] refreshExpiringMetaTokens: ${count} tokens renovados`);
    // Relatório semanal de desempenho para cada cliente ativo
    const sent = await enviarRelatoriosSemanais().catch(() => 0);
    console.log(`[cron] enviarRelatoriosSemanais: ${sent} emails enviados`);
  }
  // Nudge de onboarding diário (10:05 UTC = 7:05 BRT — clientes que pagaram mas não configuraram)
  if (cron === '5 10 * * *' || cron === '') {
    const count = await enviarNudgesOnboarding().catch(() => 0);
    console.log(`[cron] enviarNudgesOnboarding: ${count} nudges enviados`);
    // Follow-ups automáticos para contatos que pararam de responder há 24h+
    const followups = await enviarFollowupsAutomaticos().catch(() => 0);
    console.log(`[cron] enviarFollowupsAutomaticos: ${followups} mensagens enviadas`);
  }
}

// ── FOLLOW-UP AUTOMÁTICO ──────────────────────────────────────────────────────
// Diariamente: para cada cliente com followup_enabled=true, detecta contatos que
// pararam de responder há 24h–72h e envia um follow-up personalizado pela IA.
// Limites: máx 5 follow-ups por cliente/dia para evitar spam.
async function enviarFollowupsAutomaticos() {
  const nowMs   = Date.now();
  const since24h = new Date(nowMs - 24 * 3600000).toISOString(); // 24h atrás
  const since72h = new Date(nowMs - 72 * 3600000).toISOString(); // 72h atrás (limite superior)

  // 1. Clientes ativos com followup_enabled e canal configurado
  const settingsRes = await supabaseAdminRest(
    `client_settings?followup_enabled=eq.true&bot_enabled=eq.true&select=id,customer_id,api_key_masked,whatsapp_display_number&limit=100`
  ).catch(() => null);
  const settingsList = Array.isArray(settingsRes?.data) ? settingsRes.data : [];
  if (!settingsList.length) return 0;

  let totalSent = 0;

  for (const settings of settingsList) {
    if (!settings.customer_id || !settings.whatsapp_display_number) continue;
    try {
      // 2. Contatos deste cliente com last_user_msg_at entre 24h e 72h atrás
      //    E followup_sent_at nulo ou anterior a last_user_msg_at (evita envio duplicado)
      const contactsRes = await supabaseAdminRest(
        `contacts?customer_id=eq.${encodeURIComponent(settings.customer_id)}` +
        `&last_user_msg_at=gte.${encodeURIComponent(since72h)}` +
        `&last_user_msg_at=lte.${encodeURIComponent(since24h)}` +
        `&select=id,phone,followup_sent_at,last_user_msg_at&limit=5`
      ).catch(() => null);
      const contacts = Array.isArray(contactsRes?.data) ? contactsRes.data : [];

      // Filtra: só envia se followup_sent_at é nulo ou anterior a last_user_msg_at
      const pending = contacts.filter(c =>
        !c.followup_sent_at ||
        new Date(c.followup_sent_at) < new Date(c.last_user_msg_at)
      );
      if (!pending.length) continue;

      // 3. Carrega o runtime do cliente para ter config da IA e canal WhatsApp
      const runtime = await loadCustomerRuntimeByWhatsApp(settings.whatsapp_display_number).catch(() => null);
      if (!runtime?.phoneNumberId || !runtime?.accessToken) continue;

      const apiKey = String(runtime.apiKey || (typeof ANTHROPIC_API_KEY !== 'undefined' ? ANTHROPIC_API_KEY : '') || '').trim();
      if (!apiKey || !apiKey.startsWith('sk-ant')) continue;

      // Texto de retomada configurado pelo cliente no workspace
      const followupInstruction = String(runtime.config?.followup || runtime.workspace?.followupReminder || '').trim();

      let sentThisCustomer = 0;
      for (const contact of pending) {
        if (sentThisCustomer >= 5) break; // limite de segurança por cliente
        try {
          // 4. Gera a mensagem de follow-up via IA
          const systemPrompt = buildAssistantPrompt(runtime.config);
          const userMsg = followupInstruction
            ? `[SISTEMA] O cliente ${contact.phone} não respondeu há mais de 24h. Sua instrução de retomada é: "${followupInstruction}". Gere UMA mensagem curta, amigável e não insistente para retomar a conversa. Máximo 2 frases.`
            : `[SISTEMA] O cliente ${contact.phone} não respondeu há mais de 24h. Gere UMA mensagem curta e amigável para verificar se ainda pode ajudar. Máximo 2 frases.`;

          const anthropicResult = await callAnthropic(apiKey, runtime.config, [
            { role: 'user', content: userMsg },
          ], contact.phone).catch(() => null);
          if (!anthropicResult?.ok) continue;

          let parsed = {};
          try { parsed = anthropicResult.data ? JSON.parse(anthropicResult.data) : {}; } catch (_) {}
          const followupText = String(parsed?.content?.[0]?.text || '').trim();
          if (!followupText) continue;

          // 5. Envia via WhatsApp
          await sendWhatsAppText(runtime.phoneNumberId, contact.phone, followupText, runtime.accessToken);

          // 6. Registra o envio
          const nowIso = new Date().toISOString();
          await supabaseAdminUpsert('contacts', 'customer_id,phone', {
            customer_id:       settings.customer_id,
            phone:             contact.phone,
            followup_sent_at:  nowIso,
            updated_at:        nowIso,
          });

          // Log como outbound
          supabaseAdminRest('conversation_logs', 'POST', {
            customer_id:    settings.customer_id,
            contact_phone:  contact.phone,
            user_text:      '',
            assistant_text: followupText,
            needs_human:    false,
            direction:      'outbound',
          }).catch(() => {});

          sentThisCustomer++;
          totalSent++;
        } catch (_) { /* próximo contato */ }
      }
    } catch (_) { /* próximo cliente */ }
  }
  return totalSent;
}

// ── ONBOARDING NUDGE — clientes ativos sem WhatsApp configurado ──────
// Busca clientes com status=active e sem whatsapp_display_number em client_settings,
// criados há 24h–72h, e envia um e-mail de incentivo para completar a configuração.
async function enviarNudgesOnboarding() {
  const now = Date.now();
  const since24h = new Date(now - 24 * 3600 * 1000).toISOString();
  const since48h = new Date(now - 48 * 3600 * 1000).toISOString();

  // Busca clientes ativos criados no intervalo 24h–48h atrás.
  // Janela de 24h (exatamente um ciclo do cron diário) garante que cada cliente
  // receba no máximo 1 nudge, evitando envio duplicado em dias consecutivos.
  const res = await supabaseAdminRest(
    `customers?status=eq.active&created_at=gte.${encodeURIComponent(since48h)}&created_at=lte.${encodeURIComponent(since24h)}&select=id,email,company_name&limit=50`
  ).catch(() => null);

  if (!res?.data || !Array.isArray(res.data) || res.data.length === 0) return 0;

  let sent = 0;
  for (const customer of res.data) {
    if (!customer.email) continue;
    try {
      // Verifica se já tem canal configurado
      const settingsRes = await supabaseAdminRest(
        `client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=whatsapp_display_number&limit=1`
      ).catch(() => null);
      const settings = Array.isArray(settingsRes?.data) && settingsRes.data[0] ? settingsRes.data[0] : null;
      if (settings?.whatsapp_display_number) continue; // já configurou o número — não precisa de nudge

      await enviarEmailNudgeOnboarding({ email: customer.email, nome: customer.company_name });
      sent++;
    } catch (_) { /* continua para o próximo */ }
  }
  return sent;
}

async function enviarEmailNudgeOnboarding({ email, nome }) {
  const primeiroNome = (nome || 'cliente').split(' ')[0];
  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d120e;color:#e8f0e9;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1a2e1c,#0d120e);padding:32px 32px 24px;border-bottom:1px solid rgba(0,230,118,.15)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00e676;margin-bottom:8px">MercaBot</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3">Seu bot está quase no ar 🚀</h1>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;color:#9ab09c;line-height:1.7">Olá, <strong style="color:#e8f0e9">${primeiroNome}</strong>!</p>
      <p style="margin:0 0 16px;line-height:1.7">Sua conta MercaBot está ativa, mas ainda falta configurar o número do WhatsApp para o bot começar a atender.</p>
      <div style="background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.2);border-radius:12px;padding:16px 20px;margin:20px 0">
        <p style="margin:0 0 8px;font-weight:700;color:#00e676">São só 3 passos:</p>
        <ol style="margin:0;padding-left:1.2rem;color:#9ab09c;line-height:1.9;font-size:.95rem">
          <li><strong style="color:#e8f0e9">Informe o número oficial</strong> — o WhatsApp Business da empresa</li>
          <li><strong style="color:#e8f0e9">Configure a operação</strong> — como a IA deve atender e a primeira resposta rápida</li>
          <li><strong style="color:#e8f0e9">Rode o primeiro teste</strong> — valide a IA antes de divulgar o número</li>
        </ol>
      </div>
      <a href="https://mercabot.com.br/acesso" style="display:inline-block;background:#00e676;color:#080c09;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.9rem;margin-top:8px">Continuar configuração →</a>
      <p style="margin:20px 0 0;font-size:.85rem;color:#5a7060;line-height:1.6">Dúvidas? Responda este e-mail ou fale com a equipe em <a href="mailto:contato@mercabot.com.br" style="color:#00e676">contato@mercabot.com.br</a>.</p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid rgba(234,242,235,.07);font-size:12px;color:#5a7060">MercaBot — atendimento automático para o seu WhatsApp Business</div>
  </div>`;
  return enviarEmail({
    to: email,
    subject: `${primeiroNome}, seu bot MercaBot ainda não foi configurado`,
    html,
  });
}

async function handleRequest(request) {
  const url    = new URL(request.url);
  const origin = request.headers.get('Origin') || '';

  // Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (shouldEnforceOrigin(url) && origin && !isAllowedOrigin(origin)) {
      return json({ error: 'Origem não autorizada.' }, 403, origin);
    }
    if (url.pathname === '/whatsapp/webhook' && request.method === 'GET') {
      return await verifyWhatsAppWebhook(request);
    }
    if (url.pathname === '/whatsapp/webhook' && request.method === 'POST') {
      return await handleWhatsAppWebhook(request, origin);
    }
    if (url.pathname === '/whatsapp/abrir' && request.method === 'GET') {
      const redirectUrl = buildWhatsAppSalesRedirect(url);
      if (!redirectUrl) {
        return textResponse('Canal comercial indisponível.', 503, origin);
      }
      return redirectResponse(redirectUrl);
    }
    if (url.pathname === '/criar-checkout' && request.method === 'POST') {
      return await criarCheckout(request, origin);
    }
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return await handleWebhook(request);
    }
    if (url.pathname === '/verificar-pagamento' && request.method === 'GET') {
      return await verificarPagamento(request, origin);
    }
    if (url.pathname === '/auth/magic-link' && request.method === 'POST') {
      return await enviarMagicLink(request, origin);
    }
    if (url.pathname === '/auth/magic-link-preview' && request.method === 'POST') {
      return await gerarPreviewMagicLink(request, origin);
    }
    if (url.pathname === '/ia/messages' && request.method === 'POST') {
      return await proxyAnthropicMessages(request, origin);
    }
    if (url.pathname === '/ia/atender' && request.method === 'POST') {
      return await atenderComIA(request, origin);
    }
    if (url.pathname === '/ia/salvar-chave' && request.method === 'POST') {
      return await salvarChaveIA(request, origin);
    }
    if (url.pathname === '/ia/salvar-config' && request.method === 'POST') {
      return await salvarConfigIA(request, origin);
    }
    if (url.pathname === '/ia/validar-chave' && request.method === 'POST') {
      return await validarChaveIA(request, origin);
    }
    if (url.pathname === '/whatsapp/salvar-canal' && request.method === 'POST') {
      return await salvarCanalWhatsApp(request, origin);
    }
    if (url.pathname === '/whatsapp/embedded-signup' && request.method === 'POST') {
      return await handleEmbeddedSignup(request, origin);
    }
    if (url.pathname === '/whatsapp/autoteste' && request.method === 'POST') {
      return await autotestarCanalWhatsApp(request, origin);
    }
    if (url.pathname === '/whatsapp/diagnostico' && request.method === 'GET') {
      return await diagnosticoCanalWhatsApp(request, origin);
    }
    if (url.pathname === '/whatsapp/reparar-webhook' && request.method === 'POST') {
      return await repararWebhookCanal(request, origin);
    }
    if (url.pathname === '/whatsapp/perfil' && request.method === 'GET') {
      return await getWhatsAppPerfil(request, origin);
    }
    if (url.pathname === '/whatsapp/perfil' && request.method === 'POST') {
      return await updateWhatsAppPerfil(request, origin);
    }
    if (url.pathname === '/whatsapp/perfil/foto' && request.method === 'POST') {
      return await uploadWhatsAppFoto(request, origin);
    }
    if (url.pathname === '/whatsapp/nome/solicitar' && request.method === 'POST') {
      return await solicitarNomeWhatsApp(request, origin);
    }
    if (url.pathname === '/account/usage' && request.method === 'GET') {
      return await carregarUsoConta(request, origin);
    }
    if (url.pathname === '/account/conversations' && request.method === 'GET') {
      return await carregarConversas(request, origin);
    }
    if (url.pathname === '/whatsapp/reply' && request.method === 'POST') {
      return await enviarRespostaHumana(request, origin);
    }
    if (url.pathname === '/account/contacts' && request.method === 'GET') {
      return await carregarContatos(request, origin);
    }
    if (url.pathname === '/account/contacts' && request.method === 'PATCH') {
      return await atualizarContato(request, origin);
    }
    if (url.pathname === '/criar-checkout-addon' && request.method === 'POST') {
      return await criarCheckoutAddon(request, origin);
    }
    if (url.pathname === '/account/summary' && request.method === 'GET') {
      return await carregarResumoConta(request, origin);
    }
    if (url.pathname === '/account/settings' && request.method === 'GET') {
      return await carregarPreferenciasConta(request, origin);
    }
    if (url.pathname === '/account/settings' && request.method === 'POST') {
      return await salvarPreferenciasConta(request, origin);
    }
    if (url.pathname === '/account/workspace' && request.method === 'GET') {
      return await carregarWorkspaceConta(request, origin);
    }
    if (url.pathname === '/account/workspace' && request.method === 'POST') {
      return await salvarWorkspaceConta(request, origin);
    }
    if (url.pathname === '/account/workspace/generate' && request.method === 'POST') {
      return await gerarWorkspaceComIA(request, origin);
    }
    if (url.pathname === '/partner/sync' && request.method === 'GET') {
      return await carregarDadosParceiro(request, origin);
    }
    if (url.pathname === '/partner/sync' && request.method === 'POST') {
      return await salvarDadosParceiro(request, origin);
    }
    if (url.pathname === '/billing/portal' && request.method === 'GET') {
      return await carregarBillingPortalStatus(request, origin);
    }
    if (url.pathname === '/billing/portal' && request.method === 'POST') {
      return await criarBillingPortal(request, origin);
    }
    if (url.pathname === '/checkout/readiness' && request.method === 'GET') {
      return json({ ok: true, readiness: buildCheckoutReadiness() }, 200, origin);
    }
    if (url.pathname === '/health') {
      return json({ ok: true, ts: Date.now() }, 200, origin);
    }
    if (url.pathname === '/admin/diagnostics' && request.method === 'GET') {
      return await adminDiagnostics(request, origin);
    }
    if (url.pathname === '/admin/test-email' && request.method === 'POST') {
      return await adminTestEmail(request, origin);
    }
    if (url.pathname === '/admin/recovery-blast' && request.method === 'POST') {
      return await adminRecoveryBlast(request, origin);
    }
    if (url.pathname === '/onboarding' && request.method === 'POST') {
      return await salvarOnboarding(request, origin);
    }
    return json({ error: 'Not found' }, 404, origin);
  } catch (err) {
    console.error('Worker error: unexpected runtime failure');
    return json({ error: 'Não foi possível concluir a solicitação agora.' }, 500, origin);
  }
}

async function enviarMagicLink(request, origin) {
  const body = await getJsonBody(request);
  // lang vem do body OU do referer (acesso/login pode passar)
  const lang = (() => {
    const L = String((body && body.lang) || '').trim().toLowerCase();
    return (L === 'es' || L === 'en') ? L : 'pt';
  })();

  if (!body || typeof body !== 'object') {
    return json({ error: _errMsg('INVALID_DATA', lang) }, 400, origin);
  }
  const email = (body?.email || '').trim().toLowerCase().slice(0, 200);
  const redirectTo = String(body?.redirectTo || 'https://mercabot.com.br/acesso/').trim();
  const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

  if (checkRateLimit(clientIP, 'magic-link', 4, 60_000)) {
    return json({ error: _errMsg('RATE_LIMIT', lang) }, 429, origin);
  }

  if (!validateEmail(email)) {
    return json({ error: _errMsg('INVALID_EMAIL', lang) }, 400, origin);
  }

  let redirectUrl;
  try {
    redirectUrl = new URL(redirectTo);
  } catch (_) {
    return json({ error: _errMsg('REDIRECT_INVALID', lang) }, 400, origin);
  }

  if (!isAllowedOrigin(redirectUrl.origin)) {
    return json({ error: _errMsg('ORIGIN_NOT_ALLOWED', lang) }, 400, origin);
  }
  redirectUrl.pathname = '/acesso/';
  redirectUrl.search = '';
  redirectUrl.hash = '';

  const supabaseRes = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      email,
      create_user: true,
      options: {
        emailRedirectTo: redirectUrl.toString(),
      },
    }),
  });

  const rawText = await supabaseRes.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch (_) {
    payload = { raw: rawText };
  }

  if (!supabaseRes.ok) {
    return json({ error: _errMsg('AUTH_DELIVERY', lang) }, 200, origin);
  }

  return json({ ok: true }, 200, origin);
}

async function gerarPreviewMagicLink(request, origin) {
  const body = await getJsonBody(request);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Payload inválido.' }, 400, origin);
  }
  const email = (body?.email || '').trim().toLowerCase().slice(0, 200);
  const redirectTo = String(body?.redirectTo || 'https://mercabot.com.br/acesso/').trim();
  if (!validateEmail(email)) {
    return json({ error: 'E-mail inválido.' }, 400, origin);
  }
  let redirectUrl;
  try {
    redirectUrl = new URL(redirectTo);
  } catch (_) {
    return json({ error: 'URL de retorno inválida.' }, 400, origin);
  }
  if (!isAllowedOrigin(redirectUrl.origin)) {
    return json({ error: 'Origem de autenticação não autorizada.' }, 400, origin);
  }
  redirectUrl.pathname = '/acesso/';
  redirectUrl.search = '';
  redirectUrl.hash = '';

  const generateRes = await supabaseAdminAuth('generate_link', 'POST', {
    type: 'magiclink',
    email,
    redirect_to: redirectUrl.toString(),
  });
  if (!generateRes.ok) {
    return json({ error: 'Não foi possível gerar o preview do link.' }, 500, origin);
  }
  const data = generateRes.data || {};
  return json({
    ok: true,
    email,
    requestedRedirectTo: redirectUrl.toString(),
    action_link: data.action_link || '',
    email_otp: data.email_otp || '',
    hashed_token: data.hashed_token || '',
    verification_type: data.verification_type || '',
    raw: data,
  }, 200, origin);
}

async function proxyAnthropicMessages(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'ia-proxy', 12, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const body = await getJsonBody(request);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Nenhuma mensagem foi enviada para a IA.' }, 400, origin);
  }
  const apiKey = String(body?.apiKey || '').trim() || String((typeof ANTHROPIC_API_KEY !== 'undefined' ? ANTHROPIC_API_KEY : '') || '').trim();
  const clientModel = sanitizeInput(body?.model || '', 80); // modelo explicitamente solicitado pelo cliente
  const system = String(body?.system || '').slice(0, 12000);
  const maxTokensRaw = Number(body?.max_tokens || body?.maxTokens || 300);
  const maxTokens = Math.min(Math.max(Number.isFinite(maxTokensRaw) ? maxTokensRaw : 300, 64), 1024);
  const messages = Array.isArray(body?.messages)
    ? body.messages.slice(-20).map((m) => ({
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content || '').slice(0, 4000),
      })).filter((m) => m.content)
    : [];

  if (!apiKey || !apiKey.startsWith('sk-ant')) {
    return json({ error: 'IA premium indisponível no momento.' }, 500, origin);
  }

  if (!messages.length) {
    return json({ error: 'Nenhuma mensagem foi enviada para a IA.' }, 400, origin);
  }

  // Se o cliente especificou um modelo, usa só ele (sem fallback).
  // Se não especificou, itera ANTHROPIC_MODELS para resiliência a depreciações.
  const modelsToTry = clientModel ? [clientModel] : ANTHROPIC_MODELS;

  for (const model of modelsToTry) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), 25000);
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
        signal: controller.signal,
      });
      const rawText = await anthropicRes.text();
      if (anthropicRes.status === 404 && !clientModel) continue; // modelo depreciado → tenta próximo
      if (!anthropicRes.ok) {
        const status = anthropicRes.status >= 500 ? 502 : anthropicRes.status;
        return json({ error: 'A IA premium não respondeu como esperado.' }, status, origin);
      }
      return textResponse(rawText, 200, origin);
    } catch (err) {
      if (String(err).includes('timeout') || err?.name === 'AbortError') {
        return json({ error: 'A IA demorou mais do que o esperado. Tente novamente em alguns instantes.' }, 504, origin);
      }
      return json({ error: 'Falha ao processar a resposta da IA.' }, 502, origin);
    } finally {
      clearTimeout(timeout);
    }
  }
  return json({ error: 'Nenhum modelo de IA disponível no momento.' }, 502, origin);
}

async function validarChaveIA(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'ia-validate', 8, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const body = await getJsonBody(request);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Chave da IA inválida.' }, 400, origin);
  }
  const apiKey = String(body?.apiKey || '').trim();

  if (!apiKey || !apiKey.startsWith('sk-ant')) {
    return json({ error: 'Chave da IA inválida.' }, 400, origin);
  }

  // Testa a chave contra cada modelo disponível — valida mesmo se o primário estiver depreciado.
  for (const model of ANTHROPIC_MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), 15000);
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 32,
          messages: [{ role: 'user', content: 'Responda apenas com OK.' }],
        }),
        signal: controller.signal,
      });
      if (anthropicRes.status === 404) continue; // modelo depreciado → tenta próximo
      if (!anthropicRes.ok) {
        if (anthropicRes.status >= 400 && anthropicRes.status < 500) {
          return json({ error: 'Chave da IA inválida.' }, 400, origin);
        }
        return json({ error: 'Não foi possível validar a chave da IA agora.' }, 502, origin);
      }
      return json({ ok: true }, 200, origin);
    } catch (err) {
      if (String(err).includes('timeout') || err?.name === 'AbortError') {
        return json({ error: 'A validação da chave demorou mais do que o esperado.' }, 504, origin);
      }
      return json({ error: 'Falha ao validar a chave da IA.' }, 502, origin);
    } finally {
      clearTimeout(timeout);
    }
  }
  return json({ error: 'Nenhum modelo de IA disponível para validação.' }, 502, origin);
}

function buildMercabotSalesPrompt(cfg, senderPhone) {
  const _lang = _phoneLang(senderPhone);

  const _defaultLangMap = { pt: 'PORTUGUES', en: 'INGLES', es: 'ESPANHOL', auto: null };
  const _defaultLang = _defaultLangMap[_lang];

  const langBlock = _defaultLang
    ? `IDIOMA — REGRA DE PRIORIDADE MAXIMA (acima de qualquer outra instrucao):
O numero do contato indica que o idioma padrao e ${_defaultLang}. Responda em ${_defaultLang} desde a primeira mensagem, sem perguntar, sem explicar.
- Se o lead escrever em espanhol → responda EM ESPANHOL, sempre, sem excecao
- Se o lead escrever em ingles → responda em INGLES, sempre, sem excecao
- Se o lead escrever em portugues → responda em PORTUGUES, sempre, sem excecao
- NUNCA responda em portugues se o lead escreveu em outro idioma
- NUNCA explique nem se desculpe pelo idioma — simplesmente responda no idioma certo
- Mantenha o mesmo idioma em TODA a conversa

`
    : `IDIOMA — REGRA DE PRIORIDADE MAXIMA:
- Detecte o idioma do lead pela primeira mensagem e mantenha-o em toda a conversa
- Se o lead escrever em espanhol → responda EM ESPANHOL, sempre, sem excecao
- Se o lead escrever em ingles → responda em INGLES, sempre, sem excecao
- Se o lead escrever em portugues → responda em PORTUGUES, sempre, sem excecao
- NUNCA troque de idioma no meio da conversa
- NUNCA explique nem se desculpe pelo idioma — simplesmente responda no idioma certo

`;

  return `${langBlock}Voce e o assistente oficial da MercaBot — a plataforma que transforma o WhatsApp em um canal de atendimento e vendas com IA. Esta conversa e, ela mesma, a demonstracao ao vivo da tecnologia MercaBot: cada resposta sua prova ao lead o que os clientes dele vao receber.

═══════════════════════════════════════════════════════════════════
REGRA ABSOLUTA #1 — ANTI-ALUCINACAO (acima de TUDO, inclusive idioma)
═══════════════════════════════════════════════════════════════════
Voce NAO TEM acesso a Stripe, banco de dados, painel autenticado ou
status de assinatura de NINGUEM nesta conversa. Voce e um canal
PUBLICO de pre-venda.

Se o lead disser qualquer das frases abaixo (ou variacoes):
  "ja assinei", "fiz a assinatura", "sou cliente Pro/Starter/Parceiro",
  "tenho conta ativa", "paguei recentemente", "estou configurando o bot"

→ NUNCA confirme o plano. NUNCA escreva "que bom que voce esta no
   plano X". NUNCA comece a explicar configuracao tecnica do bot.
→ RESPONDA ASSIM (adapte ao idioma):
   "Otimo! Para confirmar sua assinatura e configurar o bot, acesse
    mercabot.com.br/painel-cliente e entre com o e-mail do cadastro.
    No painel voce ve seu plano ativo, mensagens disponiveis e o
    assistente de configuracao guiada do bot. Posso te ajudar com
    duvidas gerais sobre o produto aqui mesmo se quiser."

NUNCA invente nomes de telas, abas ou opcoes do painel. Se nao
souber o nome exato de uma feature do painel, NAO de passo-a-passo
de UI — direcione para o painel-cliente onde o assistente de
configuracao guiada existe de verdade.

═══════════════════════════════════════════════════════════════════
MAPA REAL DA UI DO PAINEL (so use estes nomes — nada inventado)
═══════════════════════════════════════════════════════════════════
URL: https://mercabot.com.br/painel-cliente
Abas existentes:
  📊 Painel    — visao geral, metricas, status do bot
  💬 Inbox     — conversas em andamento, assumir conversa manualmente
  👥 Contatos  — lista de leads/clientes que mensagearam
  💳 Plano     — assinatura, faturas, atualizar cartao (Stripe)
  📈 Analise   — graficos de volume e desempenho
  Suporte     — central digital de ajuda
  ⚙️ Config.   — Notificacoes, Horario de atendimento, Identidade
                 do bot (nome + saudacao), Tour

Configuracao do bot (FAQ, instrucoes, tom de voz, frases prontas)
acontece pelo ASSISTENTE DE CONFIGURACAO GUIADA que aparece
automaticamente apos o cadastro e pode ser refeito pela aba Config..
NAO existe aba "Base de Conhecimento", nao existe "Configuracoes >
FAQ" como menu separado.

MISSAO: responder qualquer pergunta com autonomia total, qualificar o lead e recomendar o plano certo. Nunca encaminhe para humano, nunca peca para o cliente entrar em contato por outro canal — voce tem todas as informacoes necessarias para resolver qualquer duvida aqui e agora.

---PRODUTO---
A MercaBot conecta um chatbot de IA ao WhatsApp Business API oficial (Meta). O bot atende, qualifica leads, responde perguntas frequentes, faz follow-up automatico e entrega o contato ao atendente humano na hora certa — sem equipe tecnica.
- Canal: WhatsApp Business API oficial (numero verificado pela Meta)
- Aparencia: o bot responde com o nome e foto da empresa — o cliente nao ve "bot"
- Ativacao: guiada pelo painel, ~30 minutos, sem TI
- Seguranca: dados criptografados, conformidade com LGPD/GDPR
- Site: mercabot.com.br | Cadastro: mercabot.com.br/cadastro | Painel: mercabot.com.br/painel-cliente

---PLANOS E PRECOS---
STARTER — R$ 197/mes | USD 49/mes
- 1.000 mensagens de IA/mes | 1 numero WhatsApp
- Chatbot IA 24h + qualificacao de leads + painel completo + horario comercial + handoff humano
- Ideal para: autonomos, profissionais liberais, pequenos negocios

PRO — R$ 497/mes | USD 119/mes
- 4.000 mensagens de IA/mes | 1 numero WhatsApp
- Tudo do Starter + follow-up automatico + qualificacao avancada de leads
- Ideal para: PMEs, equipes de vendas, clinicas, imobiliarias

PARCEIRO — R$ 1.297/mes | USD 279/mes
- 15.000 mensagens de IA/mes | Multiplos numeros e clientes
- Tudo do Pro + white-label (marca propria) + gestao multi-cliente + rede de parceiros MercaBot
- Ideal para: agencias, consultores, implantadores, operacao multi-cliente

PLANOS ANUAIS: 10x o valor mensal (equivale a 2 meses gratis)

ADD-ON DE MENSAGENS (compra avulsa sem mudar de plano):
+1.000 msgs -> R$ 47 | +5.000 msgs -> R$ 235 | +10.000 msgs -> R$ 470

PAGAMENTO: cartao de credito, PIX e boleto bancario. Planos disponiveis em BRL e USD.

---PERGUNTAS FREQUENTES---
P: Preciso de um numero novo?
R: Nao obrigatoriamente. Voce pode migrar o WhatsApp Business atual para a API oficial da Meta ou ativar um numero novo. O painel guia todo o processo.

P: O cliente vai saber que e um bot?
R: Nao. O bot responde com o nome e foto da empresa — nenhuma indicacao visual de "bot" aparece para o cliente.

P: Quanto tempo leva para ativar?
R: Cerca de 30 minutos. O painel guia passo a passo: conectar numero via Meta, configurar o bot, testar. Sem precisar de equipe tecnica.

P: O que conta como mensagem de IA?
R: Cada resposta gerada pelo bot para um cliente = 1 mensagem. Mensagens enviadas manualmente por voce nao contam.

P: O que acontece quando as mensagens acabam?
R: O bot pausa automaticamente. Voce recebe alerta em 80% e 100% do limite. Pode comprar add-on diretamente no painel, sem mudar de plano.

P: Posso cancelar quando quiser?
R: Sim. Sem fidelidade obrigatoria nos planos mensais. Cancela direto pelo painel.

P: Funciona com meu CRM ou sistema?
R: Sim, via webhook e API REST. Funciona com qualquer sistema que aceite HTTP.

P: Posso usar com minha marca (white-label)?
R: Sim, no plano Parceiro. O bot responde com a marca do cliente, voce gerencia pelo painel centralizado.

P: Quais segmentos usam mais a MercaBot?
R: Clinicas, imobiliarias, lojas, academias, contabilidades, agencias e consultores. Qualquer negocio que atende pelo WhatsApp se beneficia.

P: Como e o suporte?
R: Via WhatsApp (este canal) e central digital em mercabot.com.br/suporte. Respondemos aqui mesmo.

P: Tem aplicativo?
R: O painel e web (mercabot.com.br/painel-cliente), acessivel por celular ou PC. Nao ha app separado, mas funciona perfeitamente pelo navegador do celular.

P: A MercaBot e segura? Segue LGPD?
R: Sim. Dados criptografados em transito e em repouso, servidores em conformidade com LGPD e GDPR.

P: Qual IA a MercaBot usa?
R: IA de ultima geracao. Nao divulgamos o fornecedor especifico por politica comercial.

P: Como funciona o plano Parceiro para agencias?
R: Voce gerencia varios clientes em um unico painel. Cada cliente tem seu proprio bot com sua marca, seu numero e suas configuracoes. Voce cobra o servico com sua propria precificacao.

P: Posso testar antes de assinar?
R: Voce pode criar conta gratuita em mercabot.com.br/cadastro e explorar o painel. Esta conversa aqui e a demonstracao ao vivo — voce esta usando a tecnologia agora.

P: Como comecar?
R: Acesse mercabot.com.br/cadastro, escolha o plano e siga o wizard de ativacao. Em 30 minutos seu bot esta no ar.

---ESCOPO: O QUE A MERCABOT FAZ E NAO FAZ (anti-promessa)---
✓ FAZ: chatbot IA generativa (Claude/Anthropic) no WhatsApp Business API oficial Meta;
  conexao 1-clique pela Meta (Embedded Signup); deteccao automatica de idioma pelo +DDI;
  memoria de 12 pares de mensagens; tom de voz adaptavel; inbox estilo WhatsApp para o
  dono assumir manualmente; CRM basico (contatos com notas/status); metricas; horario
  comercial; handoff humano configuravel; qualificacao automatica de leads (Pro+);
  follow-up automatico apos 24h sem resposta (Pro+); painel multi-cliente e white-label
  com domino proprio (Parceiro); kit comercial pronto (Parceiro); Stripe PCI-DSS Level 1
  com cartao + Pix + boleto; BRL e USD; add-ons de mensagens; sem fidelidade; LGPD+GDPR.

✗ NAO FAZ (cada item recusado de proposito — outras ferramentas fazem melhor):
  • CRM completo (pipeline avancado, scoring, automacoes marketing) → use Pipedrive, RD Station, HubSpot
  • ERP / gestao de estoque / nota fiscal → use Bling, Tiny, Conta Azul
  • Disparo em massa de mensagens / campanhas marketing → use Take Blip, Twilio
  • Agendamento de posts em redes sociais → use Buffer, Later, mLabs
  • Atendimento omnichannel (email, Instagram DM, Messenger, chat web, telefone) → use Zendesk, Crisp
  • WhatsApp nao-oficial (Selenium, whatsapp-web.js) → arrisca banimento, recusamos por design
  • Aceitar numero pessoal — o numero passa a operar so via API e o app do WhatsApp para de receber nele
  • Substituir 100% atendimento humano — IA resolve ~80% e escala o resto pra equipe
  • Garantir vendas ou conversoes — entregamos a tecnologia, nao o resultado comercial
  • Vender ou compartilhar a lista de leads do cliente — contatos sao do cliente
  • App mobile nativo iOS/Android — painel e web, mobile-friendly, mas nao tem app
  • Cobrar implantacao ou setup — setup e R$ 0, so paga a mensalidade
  • Plano com fidelidade obrigatoria — mensal sem multa de saida; anual da 2 meses gratis
  • Suporte 24/7 telefonico — suporte digital + WhatsApp em horario comercial (24h utuis; 4h Parceiros)
  • Modificar/treinar o modelo de IA por cliente — usamos Claude para todos; ajuste vem de instrucao+FAQ

Quando o lead pedir algo da lista de NAO FAZ, seja honesto e direto: "Isso a MercaBot
nao faz. Para esse caso, [ferramenta sugerida] resolve melhor. A MercaBot e focada em
atendimento por WhatsApp e ai entrega valor real."

PDFs publicos com tudo isso detalhado, prontos pra mandar pro lead:
  • mercabot.com.br/docs/MercaBot-Guia-Cliente.pdf
  • mercabot.com.br/docs/MercaBot-Guia-Parceiro.pdf
  • mercabot.com.br/docs/MercaBot-Escopo-Faz-NaoFaz.pdf
  • mercabot.com.br/docs/ (pagina com os 3)

---QUALIFICACAO DO LEAD---
Para recomendar o plano correto, voce precisa entender:
1. Segmento e tamanho do negocio (autonomo, PME, agencia?)
2. Volume estimado de conversas/mes no WhatsApp
3. Ja usa WhatsApp Business API ou numero comum?
4. Uso proprio ou white-label para clientes?
5. Opera solo ou tem equipe de atendimento?

REGRA CRITICA: NUNCA refaca uma pergunta cuja resposta JA esta no historico desta conversa. Antes de perguntar qualquer coisa, releia o que o cliente ja disse. Se ele ja informou segmento, NAO pergunte segmento de novo. Se ja informou volume, NAO pergunte volume. Pergunte SOMENTE o que falta — uma pergunta por vez quando possivel. Use frases como "Voce mencionou que tem [X], so falta entender [Y]" para mostrar que prestou atencao. Quando todas as respostas estiverem disponiveis, recomende o plano com justificativa clara e direta.

---REGRA DE QUALIDADE MAXIMA (acima de tudo, exceto IDIOMA)---
Antes de formular CADA resposta, faca este check obrigatorio:
1. RELEIA o historico completo da conversa atual
2. ENTENDA exatamente o que o lead esta perguntando AGORA
3. VERIFIQUE se a resposta para sua pergunta ja foi dada antes nesta conversa
4. Se ja foi: USE essa informacao, nao pergunte de novo. Avance.
5. Se voce vai listar perguntas/passos, REMOVA da lista qualquer item ja respondido pelo lead
6. Quando reconhecer que algo ja foi mencionado, demonstre isso ("Voce mencionou X — entao...") em vez de ignorar e repetir

EXEMPLO RUIM (proibido):
  Lead: "Tenho uma loja de mobilidade eletrica."
  Bot: "Otimo! Para recomendar um plano: 1. Qual seu segmento? 2. Quantos clientes?..."
EXEMPLO BOM (esperado):
  Lead: "Tenho uma loja de mobilidade eletrica."
  Bot: "Loja de mobilidade eletrica — segmento entendido. So preciso saber: quantas conversas/mes voce recebe hoje?"

Repetir uma pergunta ja respondida e o pior erro possivel. Quebra confianca, parece descuidado, e prova ao lead que a IA nao "entende" — exatamente o oposto do que voce esta vendendo. Releia, entenda, avance.

---LEAD QUE AFIRMA TER ASSINATURA — REGRA OBRIGATORIA (anti-alucinacao)---
Se o lead disser que JA assinou (Starter, Pro, Parceiro) ou que tem conta ativa:
- VOCE NAO TEM COMO VERIFICAR isso aqui. Este e o canal comercial publico, nao o painel autenticado, nao ha integracao com o Stripe nesta conversa.
- NUNCA confirme o plano. NUNCA escreva frases como "Otimo, vamos configurar seu Pro" ou "Voce esta no caminho certo com o plano X". Isso e alucinacao — pode haver pagamento recusado, assinatura vencida, conta inexistente.
- NUNCA comece a listar passos tecnicos de configuracao do bot (como configurar IA, FAQ, horario, etc) com base na afirmacao do lead.
- ENCAMINHE SEMPRE para o painel autenticado, onde o status real aparece:
  "Otimo! Para confirmar sua assinatura e configurar o bot, acesse mercabot.com.br/painel-cliente e entre com o e-mail usado no cadastro. No painel voce ve o plano ativo, as mensagens disponiveis e o assistente de configuracao guiada do seu bot."
- Se o pagamento falhou ou esta vencido, o lead descobre no painel (ou por e-mail). Daqui voce NAO sabe nada sobre o estado da assinatura dele.
- Se o lead insistir pedindo configuracao por aqui, reforce gentilmente:
  "A configuracao acontece no painel autenticado — por aqui eu nao consigo acessar sua conta. Acesse mercabot.com.br/painel-cliente com o e-mail do cadastro e o assistente de configuracao guia voce passo a passo. Se quiser, posso explicar EM GERAL como cada parte funciona, mas a configuracao real precisa ser feita la."

Em TODOS os casos: voce pode explicar genericamente o que cada plano FAZ ou COMO funciona — mas nunca trate o lead como se ja estivesse confirmado como cliente daquele plano.

---COMPORTAMENTO---
SEMPRE:
- Seja consultivo: entenda o problema antes de recomendar
- Use exemplos do segmento (ex: "Para uma clinica com 200 pacientes/mes...")
- Indique o proximo passo: mercabot.com.br/cadastro (novo lead) ou mercabot.com.br/painel-cliente (cliente afirma ter conta)
- Respostas objetivas e bem estruturadas — sem blocos de texto longos e densos
- Responda qualquer pergunta com autonomia — nao existe duvida que nao possa resolver aqui
- Reconheca explicitamente o que o lead ja disse antes de avancar

NUNCA:
- Confirmar plano ou status de assinatura que o lead afirma ter (REGRA CRITICA — voce nao tem como verificar)
- Comecar a configurar o bot por aqui como se a conta dele estivesse ativa
- Repetir uma pergunta cuja resposta ja foi dada nesta conversa (REGRA CRITICA)
- Listar a mesma bateria de perguntas iniciais quando o lead ja deu parte das respostas
- Inventar funcionalidade, integracao ou prazo que nao existe
- Empurrar o plano mais caro sem justificativa baseada no perfil do lead
- Usar jargao tecnico desnecessario
- Continuar insistindo apos o lead demonstrar desinteresse claro
- Mencionar "Claude", "Anthropic" ou detalhes do modelo de IA
- Encaminhar para humano ou pedir para o cliente entrar em contato por outro numero
- Quebrar o personagem: voce e a MercaBot, nao um assistente generico

LEMBRE-SE: esta conversa e a vitrine da MercaBot. Cada resposta demonstra ao vivo o que a plataforma entrega. Seja preciso, humano e util — e prove que voce ESCUTA o lead em vez de repetir scripts.`;
}

function buildAssistantPrompt(config, senderPhone) {
  const cfg = config || {};
  const businessName = sanitizeInput(cfg.nome || cfg.company_name || '', 120);
  const segment      = sanitizeInput(cfg.segmento || cfg.seg || '', 120);
  const city         = sanitizeInput(cfg.cidade || '', 120);
  const businessHours = sanitizeInput(cfg.horario || cfg.hr || '', 120);
  const description  = String(cfg.descricao || cfg.desc || '').slice(0, 1200);
  const whatsappNum  = String(cfg.whatsapp_number || cfg.human || '').replace(/\D/g, '');
  const instrucao = String(cfg.instrucao || '').slice(0, 4000);
  const faq       = String(cfg.faq  || '').slice(0, 2400);
  const alwaysDo  = String(cfg.deve || '').slice(0, 1800);
  const neverDo   = String(cfg.nunca || '').slice(0, 1800);
  const human     = sanitizeInput(cfg.human || cfg.whatsapp || cfg.whatsapp_number || '', 120);
  const tone      = sanitizeInput(cfg.tom || 'amigável', 80);

  // ── FALLBACK MERCABOT ─────────────────────────────────────────────────────────
  // Dispara quando: não há config personalizada (faq, deve, nunca, descricao) E
  // o número ou nome da empresa indica que é a própria conta de vendas/demo da MercaBot.
  // Garante que o número de vendas responda com todo o roteiro comercial mesmo sem
  // o formulário de onboarding preenchido.
  // NÃO dispara quando há config personalizada — nesse caso o prompt do cliente prevalece.
  const hasNoCustomConfig = !faq && !alwaysDo && !neverDo && !description && !instrucao;
  const lowerName = (businessName || '').toLowerCase();
  const isMercabotSalesNumber =
    whatsappNum === '5531998219149' || whatsappNum === '553198219149' ||
    whatsappNum === '31998219149'   || whatsappNum === '3198219149';
  const isMercabotName = lowerName === 'mercabot' || lowerName.startsWith('mercabot');
  if (hasNoCustomConfig && (isMercabotSalesNumber || isMercabotName)) {
    return buildMercabotSalesPrompt(cfg, senderPhone);
  }

  const displayName = businessName || 'nossa empresa';

  // ── CASO ZERO-CONFIG — nenhuma informação cadastrada ─────────────────────────
  const hasAnyContext = !!(businessName || segment || description || faq || alwaysDo || instrucao);

  // ── PERSONA ──────────────────────────────────────────────────────────────────
  let prompt = `Você é o atendente virtual de ${displayName}`;
  if (segment) prompt += `, especializado em ${segment}`;
  prompt += `. Responda como um atendente humano e profissional — nunca revele que é uma IA, modelo ou sistema automático.`;

  if (!hasAnyContext) {
    // Bot completamente sem configuração — evita inventar qualquer informação
    prompt += `\n\nATENÇÃO: As informações do negócio ainda não foram configuradas no sistema. Não invente nada. Se o cliente perguntar sobre produtos, serviços, preços ou qualquer detalhe da empresa, responda educadamente que o atendimento estará disponível em breve e que a equipe entrará em contato.`;
    const _langZeroMap = { pt: 'português do Brasil', en: 'English', es: 'espanhol', auto: 'português do Brasil' };
    const _langZero = _langZeroMap[_phoneLang(senderPhone)] || 'português do Brasil';
    prompt += `\n\nCOMPORTAMENTO:\n- Seja cordial mas honesto: não há dados disponíveis ainda\n- Não prometa nada\n- Tom: amigável e prestativo\n- Responda em ${_langZero}; se o cliente escrever em outro idioma, responda naquele idioma`;
    return prompt;
  }

  // ── INSTRUÇÃO PRINCIPAL (do painel — campo "Instrução principal do bot") ──────
  // Esta é a instrução mais importante: define como o bot deve se comportar,
  // o que priorizar, e como falar com os clientes. Siga-a rigorosamente.
  if (instrucao) {
    prompt += `\n\nINSTRUÇÃO PRINCIPAL (siga sempre):\n${instrucao}`;
  }

  // ── CONTEXTO DO NEGÓCIO ──────────────────────────────────────────────────────
  const hasBusinessContext = !!(businessName || segment || description || city || businessHours);
  if (hasBusinessContext) {
    prompt += `\n\nINFORMAÇÕES DO NEGÓCIO:`;
    if (businessName)   prompt += `\n- Nome: ${businessName}`;
    if (segment)        prompt += `\n- Segmento: ${segment}`;
    if (city)           prompt += `\n- Cidade: ${city}`;
    if (businessHours)  prompt += `\n- Horário de atendimento: ${businessHours}`;
    if (description)    prompt += `\n- Sobre: ${description}`;
  }

  // ── PERGUNTAS FREQUENTES ─────────────────────────────────────────────────────
  if (faq) {
    prompt += `\n\nPERGUNTAS FREQUENTES — USE ESTAS RESPOSTAS QUANDO A PERGUNTA SE ENCAIXAR:`;
    prompt += `\n${faq}`;
    prompt += `\n(Se a pergunta do cliente corresponder a uma das acima, use exatamente aquela resposta, adaptando o tom se necessário.)`;
  }

  // ── REGRA DE QUALIDADE MÁXIMA — checagem obrigatória antes de cada resposta
  prompt += `\n\nREGRA DE QUALIDADE MÁXIMA (verificar ANTES de cada resposta):`;
  prompt += `\n1. RELEIA o histórico desta conversa antes de formular qualquer resposta`;
  prompt += `\n2. ENTENDA exatamente o que o cliente está perguntando AGORA`;
  prompt += `\n3. VERIFIQUE nas INFORMAÇÕES DO NEGÓCIO acima e na FAQ acima — a resposta já está lá?`;
  prompt += `\n4. VERIFIQUE no histórico — o cliente já mencionou nome, telefone, segmento ou outro dado que você está prestes a perguntar?`;
  prompt += `\n5. Se a info já existe (no negócio, na FAQ ou no histórico), USE-A. NÃO pergunte de novo.`;
  prompt += `\n6. Pergunte SOMENTE o que verdadeiramente falta. Demonstre atenção: "Você mencionou X — então..."`;
  prompt += `\n   Repetir uma pergunta cuja resposta já foi dada quebra a confiança do cliente.`;

  // ── REGRAS GERAIS DE COMPORTAMENTO ──────────────────────────────────────────
  const _clientLang = _phoneLang(senderPhone);
  prompt += `\n\nREGRAS GERAIS:`;
  prompt += `\n- Interprete a pergunta do cliente e responda com base nas informações acima`;
  prompt += `\n- Seja específico e direto — nunca use listas genéricas do que pode fazer`;
  prompt += `\n- Se não souber a resposta, diga que vai verificar — nunca invente informações`;
  prompt += `\n- Tom de voz: ${tone}`;
  if (_clientLang === 'en') {
    prompt += `\n- LANGUAGE: The customer's number indicates English. Respond in ENGLISH from the first message, always, without exception`;
  } else if (_clientLang === 'es') {
    prompt += `\n- IDIOMA: O número do cliente indica espanhol. Responda em ESPANHOL desde a primeira mensagem, sempre, sem exceção`;
  } else {
    prompt += `\n- Responda em português do Brasil por padrão; se o cliente escrever em espanhol ou inglês, responda naquele idioma`;
  }
  prompt += `\n- Não mencione Claude, Anthropic, IA ou qualquer detalhe técnico`;

  if (alwaysDo) prompt += `\n\nSEMPRE FAÇA:\n${alwaysDo}`;
  if (neverDo)  prompt += `\n\nNUNCA FAÇA:\n${neverDo}`;
  if (human)    prompt += `\n\nSe o cliente precisar de atendimento humano ou você não souber responder, informe que pode encaminhar para: ${human}`;

  return prompt;
}

async function atenderComIA(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'ia-runtime', 20, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const body = await getJsonBody(request);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Nenhuma mensagem foi enviada para atendimento.' }, 400, origin);
  }
  let apiKey = String(body?.apiKey || '').trim();
  let config = sanitizeRuntimeConfig(body?.config || {});
  const messages = Array.isArray(body?.messages)
    ? body.messages.slice(-20).map((m) => ({
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content || '').slice(0, 4000),
      })).filter((m) => m.content)
    : [];

  if ((!apiKey || !apiKey.startsWith('sk-ant')) && request.headers.get('Authorization')) {
    const jwt = request.headers.get('Authorization').replace(/^Bearer\s+/i, '').trim();
    const user = await getSupabaseUser(jwt);
    if (user?.id) {
      const customerRes = await supabaseRest(`customers?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, jwt);
      const customerId = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0].id : null;
      if (customerId) {
        const settingsRes = await supabaseRest(`client_settings?customer_id=eq.${encodeURIComponent(customerId)}&select=api_key_masked&limit=1`, jwt);
        const rawValue = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0].api_key_masked : '';
        if (rawValue) {
          try {
            const parsed = JSON.parse(rawValue);
            if (parsed?.cipher) apiKey = await decryptSecret(parsed.cipher);
            if (parsed?.config && (!config.nome && !config.descricao && !config.faq)) {
              config = { ...sanitizeRuntimeConfig(parsed.config), ...config };
            }
          } catch (_) {}
        }
      }
    }
  }

  if ((!apiKey || !apiKey.startsWith('sk-ant')) && typeof ANTHROPIC_API_KEY !== 'undefined') {
    apiKey = String(ANTHROPIC_API_KEY || '').trim();
  }

  if (!apiKey || !apiKey.startsWith('sk-ant')) {
    return json({ error: 'IA premium indisponível no momento.' }, 500, origin);
  }

  if (!messages.length) {
    return json({ error: 'Nenhuma mensagem foi enviada para atendimento.' }, 400, origin);
  }

  try {
    const anthropicResult = await callAnthropic(apiKey, config, messages);
    const rawText = anthropicResult.data;
    return textResponse(rawText, anthropicResult.status, origin);
  } catch (err) {
    if (String(err).includes('timeout') || err?.name === 'AbortError') {
      return json({ error: 'A resposta da IA demorou mais do que o esperado.' }, 504, origin);
    }
    return json({ error: 'Falha ao gerar a resposta da IA.' }, 502, origin);
  }
}

async function salvarChaveIA(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'ia-save-key', 6, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return json({ error: 'Sessão inválida.' }, 401, origin);
  }

  const user = await getSupabaseUser(jwt);
  if (!user?.id) {
    return json({ error: 'Sessão inválida.' }, 401, origin);
  }

  const body = await getJsonBody(request);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Chave da IA inválida.' }, 400, origin);
  }
  const apiKey = String(body?.apiKey || '').trim();
  if (!apiKey || !apiKey.startsWith('sk-ant')) {
    return json({ error: 'Chave da IA inválida.' }, 400, origin);
  }

  const validation = await validarChaveIA(new Request('https://internal/ia/validar-chave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  }), origin);
  if (validation.status !== 200) {
    return validation;
  }

  const customerRes = await supabaseRest(`customers?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, jwt);
  const customerId = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0].id : null;
  if (!customerId) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  let settingsRes = await supabaseRest(`client_settings?customer_id=eq.${encodeURIComponent(customerId)}&select=id&limit=1`, jwt);
  let settingsId = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0].id : null;
  if (!settingsId) {
    const ensuredSettings = await getOrCreateClientSettings(customerId, 'id');
    settingsId = ensuredSettings?.id || null;
  }
  if (!settingsId) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  const masked = `${apiKey.substring(0, 16)}••••••••••`;
  const cipher = await encryptSecret(apiKey);
  const storedValue = JSON.stringify({ masked, cipher });

  const updateRes = await supabaseRest(`client_settings?id=eq.${encodeURIComponent(settingsId)}&select=id,api_key_masked`, jwt, 'PATCH', {
    api_key_masked: storedValue,
  });

  if (!updateRes.ok) {
    return json({ error: 'Não foi possível salvar a chave da IA no backend.' }, 500, origin);
  }

  return json({ ok: true, masked }, 200, origin);
}

async function salvarConfigIA(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'ia-save-config', 12, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return json({ error: 'Sessão inválida.' }, 401, origin);
  }

  const user = await getSupabaseUser(jwt);
  if (!user?.id) {
    return json({ error: 'Sessão inválida.' }, 401, origin);
  }

  const body = await request.json().catch(() => ({}));
  const config = sanitizeRuntimeConfig(body?.config || {});

  const customerRes = await supabaseRest(`customers?user_id=eq.${encodeURIComponent(user.id)}&select=id,company_name,whatsapp_number&limit=1`, jwt);
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  let settingsRes = await supabaseRest(`client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=id,api_key_masked,whatsapp_display_number&limit=1`, jwt);
  let settings = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0] : null;
  if (!settings) {
    settings = await getOrCreateClientSettings(customer.id, 'id,api_key_masked,whatsapp_display_number');
  }
  if (!settings) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  const stored = parseStoredBundle(settings.api_key_masked);
  const nextBundle = {
    ...stored,
    config,
    updatedAt: new Date().toISOString(),
  };

  const nextWhatsapp = config.whatsapp_number || config.human || settings.whatsapp_display_number || customer.whatsapp_number || '';
  const updateSettingsRes = await supabaseRest(`client_settings?id=eq.${encodeURIComponent(settings.id)}&select=id,api_key_masked,whatsapp_display_number`, jwt, 'PATCH', {
    api_key_masked: JSON.stringify(nextBundle),
    whatsapp_display_number: nextWhatsapp || null,
  });

  if (!updateSettingsRes.ok) {
    return json({ error: 'Não foi possível salvar a configuração do atendimento.' }, 500, origin);
  }

  const customerPatch = {};
  if (config.nome && config.nome !== customer.company_name) customerPatch.company_name = config.nome;
  if (nextWhatsapp && nextWhatsapp !== customer.whatsapp_number) customerPatch.whatsapp_number = nextWhatsapp;
  if (Object.keys(customerPatch).length) {
    await supabaseRest(`customers?id=eq.${encodeURIComponent(customer.id)}`, jwt, 'PATCH', customerPatch);
  }

  return json({ ok: true, config, whatsapp: nextWhatsapp }, 200, origin);
}

async function salvarCanalWhatsApp(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'wa-save-channel', 8, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const user = await getSupabaseUser(jwt);
  if (!user?.id) return json({ error: 'Sessão inválida.' }, 401, origin);

  const body = await request.json().catch(() => ({}));
  const customerRes = await supabaseRest(`customers?user_id=eq.${encodeURIComponent(user.id)}&select=id,whatsapp_number&limit=1`, jwt);
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer) return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);

  let settingsRes = await supabaseRest(`client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=id,api_key_masked,whatsapp_display_number&limit=1`, jwt);
  let settings = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0] : null;
  if (!settings) {
    settings = await getOrCreateClientSettings(customer.id, 'id,api_key_masked,whatsapp_display_number');
  }
  if (!settings) return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);

  const channel = sanitizeChannelPayload(body?.channel || {}, settings.whatsapp_display_number || customer.whatsapp_number || '');
  if (!channel.display_phone_number) {
    return json({ error: 'Informe o número oficial da empresa.' }, 400, origin);
  }
  if (!isValidOfficialDisplayNumber(channel.display_phone_number)) {
    return json({ error: 'Informe um número oficial válido da empresa.' }, 400, origin);
  }
  if (channel.phone_number_id && !/^\d{6,30}$/.test(channel.phone_number_id)) {
    return json({ error: 'Informe um Phone number ID válido do canal oficial.' }, 400, origin);
  }
  if ((channel.phone_number_id && !channel.access_token) || (!channel.phone_number_id && channel.access_token)) {
    return json({ error: 'Informe juntos o Phone number ID e o token permanente do canal oficial.' }, 400, origin);
  }
  const stored = parseStoredBundle(settings.api_key_masked);
  let validatedDisplayNumber = channel.display_phone_number;
  let nextChannel = {
    ...(stored.channel || {}),
    provider: 'pending',
    display_phone_number: validatedDisplayNumber,
    updatedAt: new Date().toISOString(),
  };

  if (channel.phone_number_id && channel.access_token) {
    if (!/^EAA|^EAA|^[A-Za-z0-9_\-]{20,}$/.test(channel.access_token)) {
      return json({ error: 'Informe um token válido do canal oficial.' }, 400, origin);
    }

    const validation = await validateWhatsAppChannel(channel);
    if (!validation.ok) {
      return json({ error: validation.data?.error || 'Não foi possível validar o canal oficial informado.' }, validation.status || 400, origin);
    }

    validatedDisplayNumber = validation.data?.display_phone_number || channel.display_phone_number;
    const accessTokenCipher = await encryptSecret(channel.access_token);

    // ── AUTO-DESCOBERTA DO WABA ID ────────────────────────────────────
    // Evita que o usuário precise fazer a subscrição do webhook manualmente.
    // O WABA ID é derivado do phone_number_id via Meta Graph API.
    let discoveredWabaId = '';
    try {
      const wabaLookup = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(channel.phone_number_id)}?fields=whatsapp_business_account&access_token=${encodeURIComponent(channel.access_token)}`
      );
      const wabaData = await wabaLookup.json().catch(() => ({}));
      discoveredWabaId = String(wabaData?.whatsapp_business_account?.id || '');
    } catch (_) {}

    nextChannel = {
      provider: channel.provider,
      phone_number_id: channel.phone_number_id,
      display_phone_number: validatedDisplayNumber,
      access_token_masked: maskSecret(channel.access_token, 8),
      access_token_cipher: accessTokenCipher,
      verified_name: validation.data?.verified_name || '',
      ...(discoveredWabaId ? { waba_id: discoveredWabaId } : {}),
      connected_via: 'manual',
      updatedAt: new Date().toISOString(),
    };
  }

  const nextBundle = {
    ...stored,
    channel: nextChannel,
    updatedAt: new Date().toISOString(),
  };

  const updateSettingsRes = await supabaseRest(`client_settings?id=eq.${encodeURIComponent(settings.id)}&select=id,api_key_masked,whatsapp_display_number`, jwt, 'PATCH', {
    api_key_masked: JSON.stringify(nextBundle),
    whatsapp_display_number: validatedDisplayNumber,
  });
  if (!updateSettingsRes.ok) {
    return json({ error: 'Não foi possível salvar o canal oficial.' }, 500, origin);
  }

  if (validatedDisplayNumber !== customer.whatsapp_number) {
    await supabaseRest(`customers?id=eq.${encodeURIComponent(customer.id)}`, jwt, 'PATCH', {
      whatsapp_number: validatedDisplayNumber,
    });
  }

  // ── AUTO-SUBSCRIÇÃO DO WEBHOOK WABA ──────────────────────────────────
  // No fluxo manual (que só usuários avançados acessam), tenta subscrever
  // mas não bloqueia o save. O cliente já sabe o que está fazendo.
  // Erros são logados para debug.
  let subWarning = '';
  if (nextChannel.phone_number_id && nextChannel.access_token_cipher && nextChannel.waba_id) {
    const rawToken = await decryptSecret(nextChannel.access_token_cipher).catch(() => '');
    if (rawToken) {
      const subResult = await _subscribeWabaWebhook(nextChannel.waba_id, rawToken);
      if (!subResult.ok) {
        subWarning = 'webhook_subscription_warning';
        console.warn('[salvarCanal] subscribe failed:', subResult.error);
      }
    }
  }

  return json({
    ok: true,
    channel: {
      provider: nextChannel.provider,
      phone_number_id: nextChannel.phone_number_id || '',
      display_phone_number: validatedDisplayNumber,
      access_token_masked: nextChannel.access_token_masked || '',
      verified_name: nextChannel.verified_name || '',
      waba_id: nextChannel.waba_id || '',
      pending: !nextChannel.phone_number_id || !nextChannel.access_token_masked,
    },
    warning: subWarning || undefined,
  }, 200, origin);
}

// ── GET /whatsapp/diagnostico — checagem do canal sem mexer em nada ─────────
// Cliente ou suporte pode chamar a qualquer momento. Retorna:
//  { connected, webhookSubscribed, fields, tokenExpiresAt, displayPhone, ... }
// Útil para o painel mostrar "Tudo OK" ou "Webhook caiu — clicar para reparar".
async function diagnosticoCanalWhatsApp(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const user = await getSupabaseUser(jwt);
  if (!user?.id) return json({ error: 'Sessão inválida.' }, 401, origin);

  const customerRes = await supabaseRest(
    `customers?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, jwt
  );
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer?.id) return json({ error: 'Conta não encontrada.' }, 404, origin);

  const settingsRes = await supabaseRest(
    `client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=api_key_masked,whatsapp_display_number&limit=1`, jwt
  );
  const settings = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0] : null;

  const bundle = parseStoredBundle(settings?.api_key_masked || '');
  const channel = bundle?.channel || {};

  const result = {
    connected: !!(channel.phone_number_id && channel.access_token_cipher && channel.waba_id),
    displayPhone: channel.display_phone_number || settings?.whatsapp_display_number || '',
    verifiedName: channel.verified_name || '',
    phoneNumberId: channel.phone_number_id || '',
    wabaId: channel.waba_id || '',
    connectedVia: channel.connected_via || (channel.phone_number_id ? 'manual' : ''),
    tokenExpiresAt: channel.token_expires_at || '',
    webhookSubscribed: false,
    subscribedFields: [],
    error: ''
  };

  if (!result.connected) {
    result.error = 'channel_not_connected';
    return json(result, 200, origin);
  }

  // Verifica subscrição via Graph API
  try {
    const rawToken = await decryptSecret(channel.access_token_cipher).catch(() => '');
    if (!rawToken) {
      result.error = 'token_decrypt_failed';
      return json(result, 200, origin);
    }
    const getRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(channel.waba_id)}/subscribed_apps?access_token=${encodeURIComponent(rawToken)}`
    );
    const getBody = await getRes.json().catch(() => ({}));
    if (!getRes.ok) {
      result.error = 'graph_get_failed_' + getRes.status;
      return json(result, 200, origin);
    }
    const apps = Array.isArray(getBody?.data) ? getBody.data : [];
    const ourAppId = (typeof META_APP_ID !== 'undefined') ? String(META_APP_ID || '') : '';
    const sub = apps.find(a => a?.whatsapp_business_api_data?.id === ourAppId) || apps[0];
    result.webhookSubscribed = !!sub;
    result.subscribedFields = sub?.subscribed_fields || [];
  } catch (err) {
    result.error = 'exception_' + (err?.message || 'unknown');
  }

  return json(result, 200, origin);
}

// ── POST /whatsapp/reparar-webhook — re-subscreve sem refazer signup ────────
// Para quando o diagnóstico mostra webhookSubscribed=false. Usa o token já
// salvo, chama _subscribeWabaWebhook, retorna ok/erro claro.
async function repararWebhookCanal(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const user = await getSupabaseUser(jwt);
  if (!user?.id) return json({ error: 'Sessão inválida.' }, 401, origin);

  const customerRes = await supabaseRest(
    `customers?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, jwt
  );
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer?.id) return json({ error: 'Conta não encontrada.' }, 404, origin);

  const settingsRes = await supabaseRest(
    `client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=api_key_masked&limit=1`, jwt
  );
  const settings = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0] : null;
  const bundle = parseStoredBundle(settings?.api_key_masked || '');
  const channel = bundle?.channel || {};

  if (!channel.waba_id || !channel.access_token_cipher) {
    return json({ error: 'Canal não conectado. Conecte o WhatsApp primeiro.' }, 400, origin);
  }
  const rawToken = await decryptSecret(channel.access_token_cipher).catch(() => '');
  if (!rawToken) {
    return json({ error: 'Falha ao acessar credenciais. Reconecte o canal pelo Meta.' }, 500, origin);
  }
  const sub = await _subscribeWabaWebhook(channel.waba_id, rawToken);
  if (!sub.ok) {
    return json({ error: 'Não foi possível inscrever o webhook agora. ' + (sub.error || ''), detail: sub.error }, 502, origin);
  }
  return json({ ok: true, subscribedFields: sub.subscribedFields }, 200, origin);
}

// ── HELPER — Auto-subscribe WABA webhook (com verificação real) ─────────────
// Retorna { ok, error?, subscribedFields? }. Tenta subscribe + valida via GET
// para confirmar que a subscrição realmente entrou em vigor.
// IMPORTANTE: sem isso, o customer vê "conectado!" mas mensagens nunca chegam.
async function _subscribeWabaWebhook(wabaId, accessToken) {
  if (!wabaId || !accessToken) {
    return { ok: false, error: 'missing_waba_or_token' };
  }
  try {
    // 1) POST subscribe — sem body = subscreve aos campos default da app
    const postRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(wabaId)}/subscribed_apps`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
    );
    let postBody = {};
    try { postBody = await postRes.json(); } catch (_) {}
    if (!postRes.ok) {
      console.error('[wabaSubscribe] POST failed', postRes.status, postBody?.error?.message || '');
      return { ok: false, error: postBody?.error?.message || ('http ' + postRes.status), status: postRes.status };
    }
    // 2) GET subscribed_apps — confirma que MercaBot está na lista
    const getRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(wabaId)}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`
    );
    const getBody = await getRes.json().catch(() => ({}));
    if (!getRes.ok) {
      console.error('[wabaSubscribe] GET verify failed', getRes.status);
      return { ok: false, error: 'verify_failed', status: getRes.status };
    }
    const apps = Array.isArray(getBody?.data) ? getBody.data : [];
    const ourAppId = (typeof META_APP_ID !== 'undefined') ? String(META_APP_ID || '') : '';
    const ourSubscription = apps.find(a => a?.whatsapp_business_api_data?.id === ourAppId)
                         || apps.find(a => String(a?.whatsapp_business_api_data?.id || '') !== '');
    if (!ourSubscription) {
      console.error('[wabaSubscribe] subscription NOT confirmed in GET response. apps=', apps.length);
      return { ok: false, error: 'not_confirmed_after_post' };
    }
    return { ok: true, subscribedFields: ourSubscription?.subscribed_fields || [] };
  } catch (err) {
    console.error('[wabaSubscribe] exception', err && err.message);
    return { ok: false, error: 'exception' };
  }
}

// ── POST /whatsapp/embedded-signup — Meta Embedded Signup (zero copy-paste) ──
async function handleEmbeddedSignup(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'embedded-signup', 5, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const body = await getJsonBody(request);
  const code = String(body?.code || '').trim();
  const selectedPhoneNumberId = String(body?.phone_number_id || '').trim();
  if (!code) return json({ error: 'Código de autorização ausente.' }, 400, origin);
  // OAuth codes do Meta têm entre 20 e 512 caracteres alfanuméricos + hifens/underscores/pontos
  if (code.length < 20 || code.length > 512 || !/^[\w.\-]+$/.test(code)) {
    return json({ error: 'Código de autorização inválido.' }, 400, origin);
  }

  // Check Meta App credentials are configured as Worker secrets
  const appId     = typeof META_APP_ID     !== 'undefined' ? String(META_APP_ID     || '').trim() : '';
  const appSecret = typeof META_APP_SECRET !== 'undefined' ? String(META_APP_SECRET || '').trim() : '';
  if (!appId || !appSecret) {
    return json({ error: 'Integração com Meta ainda não configurada. Entre em contato com o suporte.' }, 503, origin);
  }

  // 1. Exchange short-lived code for access_token (server-side — app secret never reaches client)
  const tokenRes  = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`
  );
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    const errMsg = tokenData?.error?.message || 'Falha ao autenticar com a Meta. Tente novamente.';
    return json({ error: errMsg }, 400, origin);
  }
  const accessToken = String(tokenData.access_token);

  // 2. Debug token → get granular_scopes (WABA IDs + phone number IDs) + expiration date
  const debugRes  = await fetch(
    `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appId + '|' + appSecret)}`
  );
  const debugData = await debugRes.json().catch(() => ({}));
  const granularScopes = Array.isArray(debugData?.data?.granular_scopes) ? debugData.data.granular_scopes : [];
  // Save expiration so the weekly cron can refresh before it lapses
  const tokenExpiresAt = debugData?.data?.expires_at
    ? new Date(debugData.data.expires_at * 1000).toISOString()
    : new Date(Date.now() + 59 * 24 * 60 * 60 * 1000).toISOString();

  const wabaIds       = granularScopes.find(s => s.scope === 'whatsapp_business_management')?.target_ids || [];
  const phoneNumberIds = granularScopes.find(s => s.scope === 'whatsapp_business_messaging')?.target_ids || [];

  if (!wabaIds.length || !phoneNumberIds.length) {
    return json({ error: 'Nenhum WhatsApp Business Account encontrado. Verifique se o número está ativo na Meta.' }, 400, origin);
  }
  const wabaId = String(wabaIds[0]);

  // 3. Fetch details for each phone number (up to 5)
  const phones = [];
  for (const phoneId of phoneNumberIds.slice(0, 5)) {
    try {
      const phoneRes  = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}?fields=id,display_phone_number,verified_name&access_token=${encodeURIComponent(accessToken)}`
      );
      const phoneData = await phoneRes.json().catch(() => ({}));
      if (phoneData?.id) {
        phones.push({
          id:                   String(phoneData.id),
          display_phone_number: String(phoneData.display_phone_number || ''),
          verified_name:        String(phoneData.verified_name || ''),
        });
      }
    } catch (_) {}
  }

  if (!phones.length) {
    return json({ error: 'Não foi possível obter os dados do número oficial. Tente novamente.' }, 400, origin);
  }

  // 4. If multiple phones and none selected → return list for client-side selection
  if (phones.length > 1 && !selectedPhoneNumberId) {
    return json({ needsSelection: true, phones }, 200, origin);
  }

  const selectedPhone = selectedPhoneNumberId
    ? (phones.find(p => p.id === selectedPhoneNumberId) || phones[0])
    : phones[0];

  // 5. Subscribe our app to WABA webhook — COM verificação.
  // Se falhar, o cliente PRECISA saber: a "conexão" está incompleta e nenhuma
  // mensagem chegará ao bot até que a subscrição entre em vigor. Retornamos
  // erro 502 claro em vez de salvar o canal e fingir que está OK.
  const subResult = await _subscribeWabaWebhook(wabaId, accessToken);
  if (!subResult.ok) {
    console.error('[embeddedSignup] webhook subscription failed:', subResult.error);
    // Notifica admin para investigação manual
    try {
      const adminEmail = (typeof ADMIN_EMAIL !== 'undefined' && ADMIN_EMAIL) ? ADMIN_EMAIL : 'contato@mercabot.com.br';
      await enviarEmail({
        to: adminEmail,
        subject: '🚨 [MercaBot] Webhook subscription falhou em embedded signup',
        html: `<p>Cliente tentou conectar WhatsApp via Embedded Signup mas a inscrição do webhook falhou.</p><p>WABA: ${wabaId}</p><p>Erro: ${subResult.error}</p><p>Ação: rodar manualmente <code>POST /v21.0/${wabaId}/subscribed_apps</code> com o token do cliente.</p>`,
      }).catch(() => {});
    } catch (_) {}
    return json({
      error: 'A conexão foi feita mas a inscrição do webhook não foi confirmada. Aguarde alguns segundos e tente novamente — se persistir, abra o suporte.'
    }, 502, origin);
  }

  // 6. Load customer via JWT
  const user = await getSupabaseUser(jwt);
  if (!user?.id) return json({ error: 'Sessão inválida.' }, 401, origin);

  const customerRes = await supabaseRest(
    `customers?user_id=eq.${encodeURIComponent(user.id)}&select=id,whatsapp_number&limit=1`, jwt
  );
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer?.id) return json({ error: 'Conta não encontrada.' }, 404, origin);

  const settingsRes = await supabaseRest(
    `client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=id,api_key_masked,whatsapp_display_number&limit=1`, jwt
  );
  const settings = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0] : null;
  if (!settings?.id) return json({ error: 'Configurações da conta não encontradas.' }, 404, origin);

  // 7. Encrypt access token and save channel bundle
  const accessTokenCipher = await encryptSecret(accessToken);
  const stored = parseStoredBundle(settings.api_key_masked);
  const nextChannel = {
    provider:             'meta',
    phone_number_id:      selectedPhone.id,
    display_phone_number: selectedPhone.display_phone_number,
    verified_name:        selectedPhone.verified_name,
    waba_id:              wabaId,
    access_token_cipher:  accessTokenCipher,
    access_token_masked:  maskSecret(accessToken, 8),
    token_expires_at:     tokenExpiresAt,
    connected_via:        'embedded_signup',
    updatedAt:            new Date().toISOString(),
  };
  const nextBundle = { ...stored, channel: nextChannel, updatedAt: new Date().toISOString() };

  await supabaseRest(
    `client_settings?id=eq.${encodeURIComponent(settings.id)}`, jwt, 'PATCH', {
      api_key_masked:           JSON.stringify(nextBundle),
      whatsapp_display_number:  selectedPhone.display_phone_number,
    }
  );

  if (selectedPhone.display_phone_number !== customer.whatsapp_number) {
    await supabaseRest(
      `customers?id=eq.${encodeURIComponent(customer.id)}`, jwt, 'PATCH', {
        whatsapp_number: selectedPhone.display_phone_number,
      }
    );
  }

  return json({
    ok: true,
    channel: {
      provider:             'meta',
      phone_number_id:      selectedPhone.id,
      display_phone_number: selectedPhone.display_phone_number,
      verified_name:        selectedPhone.verified_name,
      waba_id:              wabaId,
      access_token_masked:  maskSecret(accessToken, 8),
      pending:              false,
    },
  }, 200, origin);
}

async function autotestarCanalWhatsApp(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'wa-self-test', 8, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  // Usa a chave do cliente se disponível, com fallback para a chave do sistema (idêntico ao webhook)
  const effectiveApiKey = String(
    runtime.apiKey ||
    (typeof ANTHROPIC_API_KEY !== 'undefined' ? ANTHROPIC_API_KEY : '')
  ).trim();

  const readiness = {
    anthropic: !!(effectiveApiKey && effectiveApiKey.startsWith('sk-ant')),
    displayPhone: !!String(runtime.channel?.display_phone_number || runtime.config?.whatsapp_number || '').trim(),
    phoneNumberId: !!String(runtime.phoneNumberId || '').trim(),
    accessToken: !!String(runtime.accessToken || '').trim(),
    verifiedName: !!String(runtime.channel?.verified_name || '').trim(),
  };
  readiness.channelReady = readiness.displayPhone && readiness.phoneNumberId && readiness.accessToken;

  if (!readiness.anthropic) {
    return json({
      error: 'A chave da IA premium ainda não está pronta para o atendimento automático.',
      readiness,
    }, 409, origin);
  }

  const company = runtime.customer.company_name || runtime.config.nome || 'a empresa';
  const anthropicResult = await callAnthropic(effectiveApiKey, runtime.config, [
    { role: 'user', content: `Explique em até 4 frases o que a ${company} oferece, qual perfil atende melhor e qual próximo passo faz sentido para um cliente que acabou de chegar.` },
  ]).catch((err) => {
    const isTimeout = err?.name === 'AbortError' || String(err || '').includes('timeout');
    return { ok: false, status: isTimeout ? 504 : 502, data: String(err || ''), timedOut: isTimeout };
  });

  if (!anthropicResult.ok) {
    const errMsg = anthropicResult.timedOut
      ? 'O autoteste demorou mais do que o esperado. Verifique sua conexão e tente novamente.'
      : 'A IA premium não respondeu como esperado neste autoteste.';
    return json({
      error: errMsg,
      readiness,
      status: anthropicResult.status || 502,
    }, anthropicResult.status || 502, origin);
  }

  let parsed = {};
  try { parsed = anthropicResult.data ? JSON.parse(anthropicResult.data) : {}; } catch (_) {}
  const preview = String(parsed?.content?.[0]?.text || '').trim();
  if (!preview) {
    return json({
      error: 'A IA premium respondeu sem conteúdo útil no autoteste.',
      readiness,
    }, 502, origin);
  }

  return json({
    ok: true,
    readiness,
    preview,
    company,
  }, 200, origin);
}

// ── GET /whatsapp/perfil ─────────────────────────────────────────────────────
// Retorna perfil de negócio + status de nome (verified_name, name_status) em paralelo.
async function getWhatsAppPerfil(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);
  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer) return json({ error: 'Conta não encontrada.' }, 404, origin);
  if (!runtime.phoneNumberId || !runtime.accessToken) {
    return json({ ok: true, profile: null, nameInfo: null, reason: 'channel_not_configured' }, 200, origin);
  }
  const META_API = 'https://graph.facebook.com/v20.0';
  try {
    // Busca perfil e status de nome em paralelo
    const [profileRes, nameRes] = await Promise.all([
      fetch(
        `${META_API}/${encodeURIComponent(runtime.phoneNumberId)}/whatsapp_business_profile` +
        `?fields=about,address,description,email,profile_picture_url,vertical`,
        { headers: { 'Authorization': `Bearer ${runtime.accessToken}` } }
      ),
      fetch(
        `${META_API}/${encodeURIComponent(runtime.phoneNumberId)}` +
        `?fields=verified_name,name_status,display_phone_number,quality_rating,status`,
        { headers: { 'Authorization': `Bearer ${runtime.accessToken}` } }
      ),
    ]);
    const profileRaw = await profileRes.json();
    const nameRaw    = await nameRes.json();
    const profile  = Array.isArray(profileRaw?.data) ? profileRaw.data[0] : profileRaw;
    const nameInfo = nameRaw?.verified_name ? {
      verified_name:        nameRaw.verified_name,
      name_status:          nameRaw.name_status          || 'UNKNOWN',
      display_phone_number: nameRaw.display_phone_number || '',
      quality_rating:       nameRaw.quality_rating       || '',
      status:               nameRaw.status               || '',
    } : null;

    // Busca solicitação de nome pendente na própria base
    let pendingNameRequest = null;
    try {
      const { data: nrRows } = await supabaseAdminRest(
        `whatsapp_name_requests?customer_id=eq.${runtime.customer.id}&order=created_at.desc&limit=1`,
        'GET'
      );
      if (Array.isArray(nrRows) && nrRows.length > 0) pendingNameRequest = nrRows[0];
    } catch (_) {}

    return json({ ok: true, profile: profile || null, nameInfo, pendingNameRequest }, 200, origin);
  } catch (_) {
    return json({ error: 'Falha ao buscar perfil do WhatsApp.' }, 502, origin);
  }
}

// ── POST /whatsapp/nome/solicitar ────────────────────────────────────────────
// Armazena a solicitação de mudança de nome no Supabase e orienta o cliente.
// A mudança efetiva passa pela Meta (1–3 dias úteis) e é acompanhada pela equipe.
async function solicitarNomeWhatsApp(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'wa-nome', 3, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante.' }, 429, origin);
  }
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);
  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer) return json({ error: 'Conta não encontrada.' }, 404, origin);
  if (!runtime.phoneNumberId) return json({ error: 'Canal não configurado.' }, 400, origin);

  const body = await getJsonBody(request);
  const requestedName = sanitizeInput(String(body?.requested_name || '').trim(), 120);
  if (!requestedName || requestedName.length < 2) {
    return json({ error: 'Informe o nome desejado (mínimo 2 caracteres).' }, 400, origin);
  }

  // Salva a solicitação na tabela whatsapp_name_requests (cria se não existir via upsert)
  // A tabela deve ter: id, customer_id, phone_number_id, requested_name, status, created_at, updated_at
  try {
    await supabaseAdminRest('whatsapp_name_requests', 'POST', {
      customer_id:     runtime.customer.id,
      phone_number_id: runtime.phoneNumberId,
      requested_name:  requestedName,
      status:          'pending',
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    });
  } catch (_) {
    // Se a tabela não existir, retorna mesmo assim (log interno)
    console.error('whatsapp_name_requests: tabela não encontrada ou erro ao inserir');
  }

  // Instrução para o próprio cliente (opcional: abrir Meta Business Manager)
  return json({
    ok: true,
    status: 'pending',
    message:
      'Solicitação registrada! Para confirmar a mudança, acesse o Meta Business Manager → ' +
      'WhatsApp Manager → Números de telefone → Editar nome de exibição. ' +
      'Após o envio, a Meta analisa em 1 a 3 dias úteis.',
    meta_manager_url: 'https://business.facebook.com/settings/whatsapp-business-accounts',
  }, 200, origin);
}

// ── POST /whatsapp/perfil ────────────────────────────────────────────────────
async function updateWhatsAppPerfil(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'wa-perfil', 10, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante.' }, 429, origin);
  }
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);
  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer) return json({ error: 'Conta não encontrada.' }, 404, origin);
  if (!runtime.phoneNumberId || !runtime.accessToken) {
    return json({ error: 'Canal do WhatsApp não está configurado.' }, 400, origin);
  }
  const body = await getJsonBody(request);
  if (!body) return json({ error: 'Dados inválidos.' }, 400, origin);
  const patch = { messaging_product: 'whatsapp' };
  if (typeof body.about === 'string')       patch.about       = body.about.slice(0, 256);
  if (typeof body.address === 'string')     patch.address     = body.address.slice(0, 256);
  if (typeof body.description === 'string') patch.description = body.description.slice(0, 256);
  if (typeof body.email === 'string')       patch.email       = body.email.slice(0, 200);
  if (typeof body.vertical === 'string')    patch.vertical    = body.vertical;
  try {
    const META_API = 'https://graph.facebook.com/v20.0';
    const res = await fetch(
      `${META_API}/${encodeURIComponent(runtime.phoneNumberId)}/whatsapp_business_profile`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${runtime.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }
    );
    const raw = await res.json();
    if (!res.ok) return json({ error: 'Erro ao atualizar perfil: ' + JSON.stringify(raw) }, 502, origin);
    return json({ ok: true }, 200, origin);
  } catch (_) {
    return json({ error: 'Falha ao atualizar perfil do WhatsApp.' }, 502, origin);
  }
}

// ── POST /whatsapp/perfil/foto ────────────────────────────────────────────────
// Recebe { photo_base64: "...", mime_type: "image/jpeg" } e publica a foto de
// perfil do número via Meta Resumable Upload API.
async function uploadWhatsAppFoto(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'wa-foto', 5, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante.' }, 429, origin);
  }
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);
  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer) return json({ error: 'Conta não encontrada.' }, 404, origin);
  if (!runtime.phoneNumberId || !runtime.accessToken) {
    return json({ error: 'Canal do WhatsApp não está configurado.' }, 400, origin);
  }
  const body = await getJsonBody(request);
  const photoB64 = String(body?.photo_base64 || '').trim();
  const mimeType = String(body?.mime_type || 'image/jpeg').trim();
  if (!photoB64) return json({ error: 'Foto não enviada.' }, 400, origin);
  // Decode base64 → bytes
  let fileBytes;
  try { fileBytes = base64ToBytes(photoB64); } catch (_) {
    return json({ error: 'Foto inválida (base64 corrompido).' }, 400, origin);
  }
  const fileSize = fileBytes.byteLength;
  if (fileSize > 5 * 1024 * 1024) {
    return json({ error: 'Foto muito grande. O limite é 5 MB.' }, 400, origin);
  }
  const appId = (typeof META_APP_ID !== 'undefined') ? String(META_APP_ID) : '';
  if (!appId) return json({ error: 'Configuração de app Meta ausente.' }, 500, origin);

  const META_API = 'https://graph.facebook.com/v20.0';
  try {
    // Passo 1: criar sessão de upload
    const sessionRes = await fetch(
      `${META_API}/${appId}/uploads?file_name=profile.jpg&file_length=${fileSize}&file_type=${encodeURIComponent(mimeType)}`,
      { method: 'POST', headers: { 'Authorization': `OAuth ${runtime.accessToken}` } }
    );
    const sessionData = await sessionRes.json();
    const uploadSessionId = sessionData?.id;
    if (!uploadSessionId) {
      return json({ error: 'Falha ao iniciar upload: ' + JSON.stringify(sessionData) }, 502, origin);
    }

    // Passo 2: enviar os bytes
    const uploadRes = await fetch(`${META_API}/${uploadSessionId}`, {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${runtime.accessToken}`,
        'file-offset': '0',
        'Content-Type': mimeType,
      },
      body: fileBytes,
    });
    const uploadData = await uploadRes.json();
    const handle = uploadData?.h;
    if (!handle) {
      return json({ error: 'Falha no upload da foto: ' + JSON.stringify(uploadData) }, 502, origin);
    }

    // Passo 3: associar o handle ao perfil do número
    const profileRes = await fetch(
      `${META_API}/${encodeURIComponent(runtime.phoneNumberId)}/whatsapp_business_profile`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${runtime.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', profile_picture_handle: handle }),
      }
    );
    const profileData = await profileRes.json();
    if (!profileRes.ok) {
      return json({ error: 'Falha ao aplicar foto: ' + JSON.stringify(profileData) }, 502, origin);
    }
    return json({ ok: true }, 200, origin);
  } catch (err) {
    return json({ error: 'Erro ao enviar foto de perfil.' }, 502, origin);
  }
}

async function carregarResumoConta(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'account-summary', 20, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  const latestSubscription = await loadLatestSubscription(runtime.customer.id, jwt);
  const summary = buildPlanSummary(runtime, latestSubscription);
  const bundle = parseStoredBundle(runtime.settings.api_key_masked);
  const safeCustomer = sanitizePanelCustomer(runtime.customer);
  const safeSettings = sanitizePanelSettings(runtime.settings);
  const safeWorkspace = sanitizePanelWorkspace(bundle.workspace || {});
  const safeChannel = sanitizePanelChannel(bundle.channel || {}, runtime.settings.whatsapp_display_number || runtime.customer.whatsapp_number || '');

  return json({
    ok: true,
    customer: safeCustomer,
    settings: safeSettings,
    workspace: safeWorkspace,
    channel: safeChannel,
    summary,
  }, 200, origin);
}

// ── GET /account/usage ────────────────────────────────────────────
// ── POST /criar-checkout-addon ────────────────────────────────────
// Gera sessão de pagamento único para compra de +1.000 mensagens IA
async function criarCheckoutAddon(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'checkout-addon', 5, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível.' }, 404, origin);
  }

  const reqBody   = (await getJsonBody(request)) || {};
  const lang      = reqBody?.lang || 'pt';
  const isEn      = lang === 'es' || lang === 'en';
  // quantity: 1 = +1.000 msgs, 5 = +5.000 msgs, 10 = +10.000 msgs
  const quantity  = Math.min(Math.max(parseInt(reqBody?.quantity || '1', 10), 1), 10);
  const addonMsgs = quantity * 1000;

  const priceId   = isEn
    ? String(typeof STRIPE_PRICE_ADDON_1K_USD !== 'undefined' ? STRIPE_PRICE_ADDON_1K_USD : '')
    : String(typeof STRIPE_PRICE_ADDON_1K_BRL !== 'undefined' ? STRIPE_PRICE_ADDON_1K_BRL : '');

  if (!priceId) {
    return json({ error: 'Pacote extra não disponível para este idioma ainda.' }, 400, origin);
  }

  const stripeKey = String(typeof STRIPE_SECRET_KEY !== 'undefined' ? STRIPE_SECRET_KEY : '').trim();
  if (!stripeKey) return json({ error: 'Pagamento indisponível no momento.' }, 503, origin);

  const customer      = runtime.customer;
  const settings      = runtime.settings;
  const userEmail     = runtime.userEmail || '';
  const stripeCustomer = customer.stripe_customer_id || '';

  const params = new URLSearchParams({
    mode:                            'payment',
    'line_items[0][price]':          priceId,
    'line_items[0][quantity]':       String(quantity),
    'success_url':                   `https://mercabot.com.br/painel-cliente/app/?addon=success&qty=${addonMsgs}`,
    'cancel_url':                    'https://mercabot.com.br/painel-cliente/app/',
    'locale':                        isEn ? 'es-419' : 'pt-BR',
    'metadata[type]':                'addon',
    'metadata[addon_msgs]':          String(addonMsgs),
    'metadata[customer_id]':         customer.id,
    'metadata[settings_id]':         settings.id,
    'metadata[email]':               userEmail,
    'payment_method_types[0]':       'card',
  });
  if (!isEn) {
    params.append('payment_method_types[1]', 'boleto');
    params.append('payment_method_types[2]', 'pix');
  }
  if (stripeCustomer) params.append('customer', stripeCustomer);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    return json({ error: data?.error?.message || 'Erro ao criar checkout.' }, 502, origin);
  }

  return json({ ok: true, url: data.url }, 200, origin);
}

// Processa pagamento confirmado de add-on (checkout.session.completed com type='addon')
async function processarAddonPago(session) {
  const settingsId = session.metadata?.settings_id || '';
  const customerId = session.metadata?.customer_id || '';
  const addonMsgs  = parseInt(session.metadata?.addon_msgs || '1000', 10);
  const email      = session.customer_email || session.metadata?.email || '';

  if (!settingsId && !customerId) return;

  // Busca settings para obter limite atual
  const idQuery = settingsId
    ? `client_settings?id=eq.${encodeURIComponent(settingsId)}&select=id,ai_msgs_limit&limit=1`
    : `client_settings?customer_id=eq.${encodeURIComponent(customerId)}&select=id,ai_msgs_limit&limit=1`;

  const res = await supabaseAdminRest(idQuery);
  const row = Array.isArray(res.data) && res.data[0] ? res.data[0] : null;
  if (!row) return;

  // SOMA ao limite existente (não reseta, não substitui)
  const novoLimite = Number(row.ai_msgs_limit || 0) + addonMsgs;
  await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(row.id)}`, 'PATCH', {
    ai_msgs_limit: novoLimite,
  });

  // E-mail de confirmação do pacote extra
  if (email) {
    await enviarEmailAddonConfirmado({ email, addonMsgs, novoLimite }).catch(() => {});
  }
}

async function carregarUsoConta(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  const planCode = runtime.customer.plan_code || 'starter';
  const used     = Number(runtime.settings.ai_msgs_used  || 0);
  const limit    = Number(runtime.settings.ai_msgs_limit || getPlanAiLimit(planCode));
  const resetAt  = runtime.settings.ai_msgs_reset_at || null;
  const pct      = limit > 0 ? used / limit : 0;

  return json({
    ok: true,
    ai: {
      used,
      limit,
      remaining: Math.max(limit - used, 0),
      pct,
      resetAt,
      alert: pct >= AI_QUOTA_ALERT_PCT,
      exhausted: used >= limit,
    },
    plan: planCode,
  }, 200, origin);
}

// Busca o e-mail do auth user associado ao customer (para envio de alertas)
async function getCustomerEmail(customerId) {
  if (!customerId) return null;
  const res = await supabaseAdminRest(
    `customers?id=eq.${encodeURIComponent(customerId)}&select=user_id&limit=1`
  );
  const userId = Array.isArray(res.data) && res.data[0] ? res.data[0].user_id : null;
  if (!userId) return null;
  const userRes = await supabaseAdminRest(
    `auth/users/${encodeURIComponent(userId)}`
  );
  return userRes.data?.email || null;
}

// E-mail de alerta ao cliente quando atinge 80% da cota de IA
async function enviarEmailAlertaCota(email, companyName, used, limit, planLabel, nextUpgrade) {
  const pct        = Math.round((used / limit) * 100);
  const remaining  = limit - used;
  const upgradeLine = nextUpgrade
    ? `<p style="margin:0 0 12px">Para não interromper o atendimento automático, considere fazer upgrade para o plano <strong>${nextUpgrade.charAt(0).toUpperCase() + nextUpgrade.slice(1)}</strong> ou contrate um pacote extra de mensagens.</p>`
    : `<p style="margin:0 0 12px">Para não interromper o atendimento, contrate um pacote extra de mensagens.</p>`;

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d120e;color:#e8f0e9;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1a2e1c,#0d120e);padding:32px 32px 24px;border-bottom:1px solid rgba(0,230,118,.15)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00e676;margin-bottom:8px">MercaBot</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3">Você usou ${pct}% das respostas de IA deste mês</h1>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;color:#9ab09c;line-height:1.7">Olá, <strong style="color:#e8f0e9">${companyName}</strong>!</p>
      <p style="margin:0 0 16px;line-height:1.7">O bot do seu plano <strong>${planLabel}</strong> já gerou <strong>${used.toLocaleString('pt-BR')}</strong> de <strong>${limit.toLocaleString('pt-BR')}</strong> respostas de IA disponíveis neste mês. Restam apenas <strong>${remaining.toLocaleString('pt-BR')} respostas</strong>.</p>
      ${upgradeLine}
      <div style="background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.2);border-radius:12px;padding:16px 20px;margin:20px 0">
        <div style="font-size:13px;color:#9ab09c;margin-bottom:6px">Consumo atual</div>
        <div style="background:rgba(255,255,255,.08);border-radius:999px;height:10px;overflow:hidden">
          <div style="background:#00e676;height:100%;width:${pct}%;border-radius:999px"></div>
        </div>
        <div style="font-size:13px;color:#9ab09c;margin-top:6px;text-align:right">${used.toLocaleString('pt-BR')} / ${limit.toLocaleString('pt-BR')} mensagens</div>
      </div>
      <a href="https://mercabot.com.br/painel-cliente/app/" style="display:inline-block;background:#00e676;color:#0d120e;font-weight:700;padding:12px 24px;border-radius:10px;text-decoration:none;font-size:15px">Acessar meu painel</a>
    </div>
    <div style="padding:16px 32px;border-top:1px solid rgba(234,242,235,.07);font-size:12px;color:#5a7060">MercaBot — atendimento automático para o seu WhatsApp Business</div>
  </div>`;

  return enviarEmail({
    to: email,
    subject: `⚠️ ${pct}% da sua cota de IA usada este mês — ${companyName}`,
    html,
  });
}

async function carregarPreferenciasConta(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  return json({
    ok: true,
    settings: {
      bot_enabled: !!runtime.settings.bot_enabled,
      business_hours_enabled: !!runtime.settings.business_hours_enabled,
      lead_qualification_enabled: !!runtime.settings.lead_qualification_enabled,
      followup_enabled: !!runtime.settings.followup_enabled,
      human_handoff_enabled: !!runtime.settings.human_handoff_enabled,
    },
    plan: runtime.customer.plan_code || 'starter',
  }, 200, origin);
}

async function salvarPreferenciasConta(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'account-settings', 12, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  const body = await request.json().catch(() => ({}));
  const planDefinition = getPlanDefinition(runtime.customer.plan_code);
  const allowed = getAllowedSettingsPatch(planDefinition, body || {});
  if (!allowed.ok) {
    return json({ error: allowed.error }, 403, origin);
  }
  if (!Object.keys(allowed.patch).length) {
    return json({ error: 'Nenhuma configuração válida foi informada.' }, 400, origin);
  }

  const updateRes = await supabaseRest(
    `client_settings?id=eq.${encodeURIComponent(runtime.settings.id)}&select=id`,
    jwt,
    'PATCH',
    allowed.patch
  );
  if (!updateRes.ok) {
    return json({ error: 'Não foi possível salvar as configurações da conta.' }, 500, origin);
  }

  const refreshed = await loadCustomerRuntimeByJwt(jwt);
  const latestSubscription = await loadLatestSubscription(refreshed.customer.id, jwt);
  return json({
    ok: true,
    settings: {
      bot_enabled: !!refreshed.settings.bot_enabled,
      business_hours_enabled: !!refreshed.settings.business_hours_enabled,
      lead_qualification_enabled: !!refreshed.settings.lead_qualification_enabled,
      followup_enabled: !!refreshed.settings.followup_enabled,
      human_handoff_enabled: !!refreshed.settings.human_handoff_enabled,
    },
    summary: buildPlanSummary(refreshed, latestSubscription),
  }, 200, origin);
}

async function carregarWorkspaceConta(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  const stored = parseStoredBundle(runtime.settings.api_key_masked);
  const defaults = {
    notes: '',
    specialHours: '',
    quickReplies: [],
    goal: 'vender',
    leadLabels: '',
    priorityReplies: '',
    followupReminder: '',
  };
  const workspace = {
    ...defaults,
    ...(stored.workspace && typeof stored.workspace === 'object' ? stored.workspace : {}),
  };

  return json({
    ok: true,
    workspace,
    plan: runtime.customer.plan_code || 'starter',
  }, 200, origin);
}

async function salvarWorkspaceConta(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'account-workspace', 12, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  const body = await request.json().catch(() => ({}));
  const mode = String(body?.mode || 'base').trim().toLowerCase();
  const planDefinition = getPlanDefinition(runtime.customer.plan_code);
  if (mode === 'advanced' && !planDefinition.capabilities.advancedOps) {
    return json({ error: 'Os recursos avançados fazem parte do plano Pro ou superior.' }, 403, origin);
  }

  const stored = parseStoredBundle(runtime.settings.api_key_masked);
  const nextWorkspace = mergeWorkspacePayload(stored.workspace || {}, body?.workspace || {}, mode);
  const nextBundle = {
    ...stored,
    workspace: nextWorkspace,
    updatedAt: new Date().toISOString(),
  };

  const updateRes = await supabaseRest(
    `client_settings?id=eq.${encodeURIComponent(runtime.settings.id)}&select=id`,
    jwt,
    'PATCH',
    { api_key_masked: JSON.stringify(nextBundle) }
  );
  if (!updateRes.ok) {
    return json({ error: 'Não foi possível salvar a configuração operacional.' }, 500, origin);
  }

  const refreshed = await loadCustomerRuntimeByJwt(jwt);
  const latestSubscription = await loadLatestSubscription(refreshed.customer.id, jwt);
  return json({
    ok: true,
    workspace: nextWorkspace,
    summary: buildPlanSummary(refreshed, latestSubscription),
  }, 200, origin);
}

// ── POST /account/workspace/generate — gera campos de perfil via IA ──────────
async function gerarWorkspaceComIA(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'workspace-generate', 3, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível para esta operação.' }, 404, origin);
  }

  const body     = await request.json().catch(() => ({}));
  const segment  = sanitizeInput(String(body?.segment  || '').trim(), 80);
  const freeText = String(body?.freeText || '').trim().slice(0, 800);

  // Whitelist de campos permitidos por plano — impede clientes de gerar conteúdo
  // para campos avançados aos quais seu plano não tem acesso.
  const planDef = getPlanDefinition(runtime.customer.plan_code);
  const BASE_FIELDS     = ['notes', 'specialHours', 'quickReplies'];
  const ADVANCED_FIELDS = ['goal', 'leadLabels', 'priorityReplies', 'followupReminder'];
  const allowedFields   = planDef.capabilities.advancedOps
    ? [...BASE_FIELDS, ...ADVANCED_FIELDS]
    : BASE_FIELDS;

  const fields = Array.isArray(body?.fields)
    ? body.fields
        .map(f => sanitizeInput(String(f), 60))
        .filter(f => f && allowedFields.includes(f))
    : [];

  if (!segment)       return json({ error: 'Segmento obrigatório.'    }, 400, origin);
  if (!fields.length) return json({ error: 'Nenhum campo solicitado ou campos não disponíveis no seu plano.' }, 400, origin);

  // Valida chave de API ANTES de debitar cota — evita desperdiçar quota quando a IA não está configurada
  const resolvedApiKey = String(
    (typeof ANTHROPIC_API_KEY !== 'undefined' ? ANTHROPIC_API_KEY : '') || ''
  ).trim();
  if (!resolvedApiKey || !resolvedApiKey.startsWith('sk-ant')) {
    return json({ error: 'IA premium indisponível no momento.' }, 503, origin);
  }

  // Verifica e debita cota de mensagens de IA do plano (após validar pré-condições)
  const quota = await checkAndIncrementAiQuota(runtime.settings.id, runtime.customer.plan_code);
  if (!quota.allowed) {
    return json({
      error: 'Você atingiu o limite de mensagens de IA do seu plano este mês.',
      exhausted: true,
    }, 402, origin);
  }

  const systemPrompt = [
    'Você é um assistente especializado em configuração de chatbots para empresas brasileiras.',
    'Sua tarefa é preencher campos de perfil de negócio com base na descrição fornecida.',
    'Responda APENAS com um objeto JSON válido no formato { "campo": "valor" }.',
    'Não inclua explicações, markdown ou texto fora do JSON.',
    'Os valores devem ser concisos, objetivos e em português do Brasil.',
    'Máximo de 200 caracteres por campo.',
  ].join('\n');

  const userMessage = [
    `Segmento: ${segment}`,
    `Descrição do negócio: ${freeText || 'Não fornecida'}`,
    `Campos a preencher: ${fields.join(', ')}`,
    '',
    'Retorne apenas o JSON com os valores preenchidos.',
  ].join('\n');

  // Itera pelos modelos disponíveis — garante geração mesmo com modelo primário depreciado.
  let anthropicRes, rawText;
  for (const model of ANTHROPIC_MODELS) {
    const controller = new AbortController();
    const aiTimeout  = setTimeout(() => controller.abort('timeout'), 25000);
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         resolvedApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: userMessage }],
        }),
        signal: controller.signal,
      });
      rawText = await anthropicRes.text();
      clearTimeout(aiTimeout);
      if (anthropicRes.status === 404) continue; // modelo depreciado → tenta próximo
      break;
    } catch (err) {
      clearTimeout(aiTimeout);
      if (String(err).includes('timeout') || err?.name === 'AbortError') {
        return json({ error: 'A geração com IA demorou mais do que o esperado. Tente novamente.' }, 504, origin);
      }
      return json({ error: 'Falha ao chamar a IA. Tente novamente.' }, 502, origin);
    }
  }

  if (!anthropicRes || !anthropicRes.ok) {
    return json({ error: 'Falha na geração com IA. Tente novamente.' }, 502, origin);
  }

  let aiData;
  try { aiData = JSON.parse(rawText); } catch (_) {
    return json({ error: 'Resposta inválida da IA.' }, 502, origin);
  }

  const aiText = String(aiData?.content?.[0]?.text || '');

  let generatedFields;
  try {
    // Tenta parse direto primeiro (IA respondeu JSON puro)
    generatedFields = JSON.parse(aiText);
    if (typeof generatedFields !== 'object' || generatedFields === null || Array.isArray(generatedFields)) {
      throw new Error('not an object');
    }
  } catch (_) {
    // Fallback: extrai o primeiro bloco {...} do texto (ex: IA adicionou markdown)
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) throw new Error('no JSON block found');
      generatedFields = JSON.parse(jsonMatch[0]);
      if (typeof generatedFields !== 'object' || generatedFields === null || Array.isArray(generatedFields)) {
        throw new Error('not an object');
      }
    } catch (_2) {
      return json({ error: 'Não foi possível interpretar a resposta da IA.' }, 502, origin);
    }
  }

  // Retorna apenas os campos solicitados, sanitizados
  const sanitizedFields = {};
  for (const fieldId of fields) {
    const val = generatedFields[fieldId];
    if (val != null) {
      sanitizedFields[fieldId] = sanitizeInput(String(val).trim(), 400);
    }
  }

  return json({ ok: true, fields: sanitizedFields }, 200, origin);
}

// ── POST /onboarding — AI context setup after payment ────────────
async function salvarOnboarding(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'onboarding', 10, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const body = await getJsonBody(request);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Dados inválidos.' }, 400, origin);
  }

  const email = sanitizeInput(String(body.email || '').trim().toLowerCase(), 200);
  if (!validateEmail(email)) {
    return json({ error: 'E-mail inválido.' }, 400, origin);
  }

  const empresa     = sanitizeInput(String(body.empresa     || '').trim(), 120);
  const responsavel = sanitizeInput(String(body.responsavel || '').trim(), 120);
  const segmento    = sanitizeInput(String(body.segmento    || '').trim(), 120);
  const tom         = sanitizeInput(String(body.tom         || '').trim(), 80);
  const saudacao    = String(body.saudacao   || '').trim().slice(0, 600);
  const h_inicio    = sanitizeInput(String(body.horario_inicio || '09:00').trim(), 10);
  const h_fim       = sanitizeInput(String(body.horario_fim   || '18:00').trim(), 10);
  const fora        = String(body.fora_horario || '').trim().slice(0, 400);
  const whats       = sanitizeInput(String(body.whats || '').trim(), 30);

  // Build FAQ string from array — aceita tanto {q, a} quanto {pergunta, resposta} — exige pergunta E resposta
  const faqArr = Array.isArray(body.faq) ? body.faq.slice(0, 5) : [];
  const faqText = faqArr
    .filter(item => item && String(item.pergunta || item.q || '').trim() && String(item.resposta || item.a || '').trim())
    .map((item, i) => `P${i + 1}: ${String(item.pergunta || item.q || '').trim()}\nR${i + 1}: ${String(item.resposta || item.a || '').trim()}`)
    .join('\n\n')
    .slice(0, 2400);

  // Look up profile
  const profile = await findProfileByEmail(email);
  if (!profile?.id) {
    // User may not exist yet (edge case) — accept gracefully, store nothing
    return json({ ok: true, partial: true }, 200, origin);
  }

  // Look up customer
  const customerRes = await supabaseAdminRest(
    `customers?user_id=eq.${encodeURIComponent(profile.id)}&select=id,company_name,whatsapp_number,plan_code&limit=1`
  );
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer?.id) {
    return json({ ok: true, partial: true }, 200, origin);
  }

  // Update company_name on customers table if provided
  if (empresa) {
    await supabaseAdminRest(`customers?id=eq.${encodeURIComponent(customer.id)}`, 'PATCH', {
      company_name: empresa,
    });
  }

  // Build formatted horario string for the AI context
  const horarioStr = h_inicio && h_fim ? `${h_inicio}–${h_fim}` : '';

  // Update client_settings bundle (config field)
  const settingsRes = await supabaseAdminRest(
    `client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=id,api_key_masked,whatsapp_display_number&limit=1`
  );
  const settings = Array.isArray(settingsRes.data) && settingsRes.data[0] ? settingsRes.data[0] : null;

  if (settings?.id) {
    const bundle = parseStoredBundle(settings.api_key_masked);
    const existingConfig = bundle.config || {};

    const nextConfig = sanitizeRuntimeConfig({
      ...existingConfig,
      nome:            empresa    || existingConfig.nome    || '',
      segmento:        segmento   || existingConfig.segmento || '',
      horario:         horarioStr || existingConfig.horario  || '',
      tom:             tom        || existingConfig.tom       || '',
      descricao:       saudacao   || existingConfig.descricao || '',
      faq:             faqText    || existingConfig.faq       || '',
      deve:            fora       || existingConfig.deve      || '',
      human:           existingConfig.human           || whats || '',
      whatsapp_number: existingConfig.whatsapp_number || whats || '',
    });

    // Store responsavel in workspace for operator reference
    const existingWorkspace = bundle.workspace || {};

    // Pre-populate workspace.notes with a formatted instruction seed from the
    // ativacao wizard so the painel quickstart step 2 isn't blank on first login.
    // Only set when notes is empty — never overwrite what the user typed.
    let seedNotes = existingWorkspace.notes || '';
    if (!seedNotes) {
      const parts = [];
      if (empresa) parts.push(`Empresa: ${empresa}`);
      if (segmento) parts.push(`Segmento: ${segmento}`);
      if (tom) parts.push(`Tom de atendimento: ${tom}`);
      if (saudacao) parts.push(`Saudação padrão: ${saudacao}`);
      if (horarioStr) parts.push(`Horário de atendimento: ${horarioStr}`);
      if (fora) parts.push(`Fora do horário: ${fora}`);
      if (faqText) parts.push(`\nPerguntas frequentes:\n${faqText}`);
      seedNotes = parts.join('\n');
    }

    const nextWorkspace = {
      ...existingWorkspace,
      responsavel: responsavel || existingWorkspace.responsavel || '',
      onboarded_at: new Date().toISOString(),
      notes: seedNotes,
    };

    const nextBundle = {
      ...bundle,
      config: nextConfig,
      workspace: nextWorkspace,
      updatedAt: new Date().toISOString(),
    };

    await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(settings.id)}`, 'PATCH', {
      api_key_masked: JSON.stringify(nextBundle),
      bot_enabled: true,
    });
  }

  // Send confirmation email to user
  // Fetch customer status to personalise message for boleto vs. card users
  const customerForEmail = await supabaseAdminRest(
    `customers?id=eq.${encodeURIComponent(customer.id)}&select=status&limit=1`
  ).catch(() => null);
  const customerStatus = Array.isArray(customerForEmail?.data) && customerForEmail.data[0]
    ? customerForEmail.data[0].status : 'active';
  const isBoleto = customerStatus === 'pending_payment';

  const nomeDisplay = empresa || responsavel || 'usuário';
  const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#080c09;color:#eaf2eb;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<div style="font-size:1.4rem;font-weight:700;margin-bottom:32px">Merca<span style="color:#00e676">Bot</span></div>
<h1 style="font-size:1.3rem;margin-bottom:12px">Configuração salva ✅</h1>
<p style="color:rgba(234,242,235,.75);font-size:.95rem;line-height:1.7">Olá${empresa ? ', ' + empresa : ''}! As informações do seu negócio foram salvas com sucesso.</p>
${isBoleto
  ? `<p style="color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7">Assim que o boleto compensar (até 3 dias úteis), o bot entra em ação automaticamente. Enquanto isso, você já pode acessar o painel e informar o número do WhatsApp.</p>`
  : `<p style="color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7">Acesse o painel para conectar o número do WhatsApp e fazer o primeiro teste — são menos de 5 minutos.</p>`
}
<a href="https://mercabot.com.br/painel-cliente/app/" style="display:inline-block;background:#00e676;color:#080c09;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.9rem;margin-top:16px">Acessar painel →</a>
<div style="margin-top:32px;font-size:.75rem;color:rgba(234,242,235,.3)">MercaBot Tecnologia Ltda. · contato@mercabot.com.br</div>
</div></body></html>`;

  try {
    await enviarEmail({ to: email, subject: '✅ Seu bot está sendo configurado — MercaBot', html: emailHtml });
  } catch (_) {
    // Email failure is non-fatal
  }

  return json({ ok: true }, 200, origin);
}

// ── GET /partner/sync — carrega dados persistidos do painel parceiro ─────────
async function carregarDadosParceiro(request, origin) {
  const email = extractPartnerEmail(request);
  if (!email) return json({ error: 'Sessão de parceiro inválida.' }, 401, origin);

  const res = await supabaseAdminRest(
    `partner_data?partner_email=eq.${encodeURIComponent(email)}&select=clients,resources,config,updated_at&limit=1`
  );
  if (!res.ok) return json({ error: 'Não foi possível carregar os dados.' }, 500, origin);

  const row = Array.isArray(res.data) && res.data[0];
  if (!row) return json({ ok: true, clients: [], resources: [], config: {} }, 200, origin);

  return json({
    ok: true,
    clients:   Array.isArray(row.clients)  ? row.clients  : [],
    resources: Array.isArray(row.resources) ? row.resources : [],
    config:    (typeof row.config === 'object' && row.config !== null) ? row.config : {},
    updatedAt: row.updated_at,
  }, 200, origin);
}

// ── POST /partner/sync — persiste dados do painel parceiro ────────────────────
async function salvarDadosParceiro(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'partner-sync', 20, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante.' }, 429, origin);
  }

  const email = extractPartnerEmail(request);
  if (!email) return json({ error: 'Sessão de parceiro inválida.' }, 401, origin);

  const body = await request.json().catch(() => ({}));
  const clients   = Array.isArray(body?.clients)   ? body.clients.slice(0, 500) : [];
  const resources = Array.isArray(body?.resources)  ? body.resources.slice(0, 50) : [];
  const config    = (typeof body?.config === 'object' && body.config !== null) ? body.config : {};

  // Read-then-write upsert (UNIQUE constraint on partner_email)
  const existing = await supabaseAdminRest(
    `partner_data?partner_email=eq.${encodeURIComponent(email)}&select=id&limit=1`
  );
  const hasRow = Array.isArray(existing.data) && existing.data.length > 0;

  const saveRes = hasRow
    ? await supabaseAdminRest(
        `partner_data?partner_email=eq.${encodeURIComponent(email)}`,
        'PATCH',
        { clients, resources, config, updated_at: new Date().toISOString() }
      )
    : await supabaseAdminRest(
        'partner_data',
        'POST',
        { partner_email: email, clients, resources, config }
      );

  if (!saveRes.ok) {
    return json({ error: 'Não foi possível salvar os dados.' }, 500, origin);
  }

  return json({ ok: true }, 200, origin);
}

async function carregarBillingPortalStatus(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const user = await getSupabaseUser(jwt);
  if (!user?.id) return json({ error: 'Sessão inválida.' }, 401, origin);

  const customerRes = await supabaseRest(`customers?user_id=eq.${encodeURIComponent(user.id)}&select=id,stripe_customer_id&limit=1`, jwt);
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;

  return json({
    ok: true,
    available: !!customer?.stripe_customer_id,
    customerId: customer?.id || '',
    reason: customer?.stripe_customer_id
      ? 'Portal pronto para autosserviço.'
      : 'Sua conta ainda não tem cobrança sincronizada para autosserviço.',
  }, 200, origin);
}

async function criarBillingPortal(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'billing-portal', 10, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const user = await getSupabaseUser(jwt);
  if (!user?.id) return json({ error: 'Sessão inválida.' }, 401, origin);

  const body = await request.json().catch(() => ({}));
  const mode = String(body?.mode || 'billing').trim().toLowerCase();

  const customerRes = await supabaseRest(`customers?user_id=eq.${encodeURIComponent(user.id)}&select=id,stripe_customer_id&limit=1`, jwt);
  const customer = Array.isArray(customerRes.data) && customerRes.data[0] ? customerRes.data[0] : null;
  if (!customer?.stripe_customer_id) {
    return json({ error: 'Sua conta ainda não tem cobrança sincronizada para autosserviço.' }, 409, origin);
  }

  const params = new URLSearchParams();
  params.set('customer', customer.stripe_customer_id);
  params.set('return_url', 'https://mercabot.com.br/painel-cliente/app/');

  if (mode === 'cancel') {
    const subscriptionRes = await supabaseRest(
      `subscriptions?customer_id=eq.${encodeURIComponent(customer.id)}&select=stripe_subscription_id,status,created_at&order=created_at.desc&limit=1`,
      jwt
    );
    const subscription = Array.isArray(subscriptionRes.data) && subscriptionRes.data[0] ? subscriptionRes.data[0] : null;
    if (subscription?.stripe_subscription_id) {
      params.set('flow_data[type]', 'subscription_cancel');
      params.set('flow_data[subscription_cancel][subscription]', subscription.stripe_subscription_id);
      params.set('flow_data[after_completion][type]', 'redirect');
      params.set('flow_data[after_completion][redirect][return_url]', 'https://mercabot.com.br/painel-cliente/app/');
    } else {
      return json({ error: 'Nenhuma assinatura ativa foi encontrada. Acesse o painel da conta para seguir com o cancelamento.' }, 409, origin);
    }
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const stripeBody = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok || !stripeBody?.url) {
    return json({ error: 'Não foi possível abrir o portal de cobrança agora.' }, stripeRes.status || 500, origin);
  }

  return json({ ok: true, url: stripeBody.url }, 200, origin);
}

async function verifyWhatsAppWebhook(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') || '';

  if (mode === 'subscribe' && token && WHATSAPP_VERIFY_TOKEN && token === WHATSAPP_VERIFY_TOKEN) {
    return textResponse(challenge, 200, undefined);
  }
  return textResponse('Forbidden', 403, undefined);
}

async function handleWhatsAppWebhook(request, origin) {
  const rawBody = await request.text().catch(() => '');

  // ── VALIDAÇÃO DE ASSINATURA HMAC-SHA256 (Meta/WhatsApp) ──────────
  // WHATSAPP_APP_SECRET: Meta for Developers → App → Settings → Basic → App Secret
  const appSecret = (typeof WHATSAPP_APP_SECRET !== 'undefined') ? WHATSAPP_APP_SECRET : '';
  if (appSecret) {
    const sigHeader = request.headers.get('X-Hub-Signature-256') || '';
    const valid = await verifyWhatsAppSignature(rawBody, sigHeader, appSecret);
    if (!valid) return json({ ok: false }, 403, origin);
  }

  let payload = {};
  try { payload = JSON.parse(rawBody); } catch (_) {}
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      const phoneNumberId = metadata?.phone_number_id || '';
      const displayPhone = metadata?.display_phone_number || phoneNumberId;
      const messages = Array.isArray(value?.messages) ? value.messages : [];

      for (const msg of messages) {
        // Idempotência: ignora retries do Meta para o mesmo WAMID
        const wamid = String(msg?.id || '').trim();
        if (_isWamidSeen(wamid)) continue;

        const inboundText = extractInboundWhatsAppText(msg);
        const from = String(msg?.from || '').trim();
        if (!from) continue;

        const runtime = await loadCustomerRuntimeByWhatsApp(displayPhone);
        if (!runtime) continue;
        try {
          await trackInboundUsage(runtime, from);
        } catch (_) {}

        // ── BOT_ENABLED — respeita o toggle do painel ─────────────────────
        // Se o cliente pausou o bot pelo painel, não silencia: envia fallback
        // localizado para manter o lead engajado até a equipe humana retornar.
        if (runtime.settings?.bot_enabled === false) {
          try {
            await sendWhatsAppText(
              runtime.phoneNumberId || phoneNumberId,
              from,
              _fallbackBotPaused(from, runtime.config?.human),
              runtime.accessToken
            );
          } catch (_) {}
          continue;
        }

        const runtimeApiKey = String(runtime.apiKey || (typeof ANTHROPIC_API_KEY !== 'undefined' ? ANTHROPIC_API_KEY : '') || '').trim();
        if (!runtimeApiKey || !runtimeApiKey.startsWith('sk-ant')) {
          // Chave IA ausente/inválida: avisa o lead em vez de silenciar e
          // dispara alerta interno para o cliente configurar a chave.
          try {
            await sendWhatsAppText(
              runtime.phoneNumberId || phoneNumberId,
              from,
              _fallbackBotPaused(from, runtime.config?.human),
              runtime.accessToken
            );
          } catch (_) {}
          continue;
        }

        // ── GUARDIÃO DE COTA ────────────────────────────────────────
        let quota = { allowed: true };
        try {
          quota = await checkAndIncrementAiQuota(
            runtime.settings?.id,
            runtime.customer?.plan_code || 'starter'
          );
        } catch (_) {}

        if (!quota.allowed) {
          // Cota esgotada — avisa o contato final de forma amigável e localizada
          try {
            await sendWhatsAppText(
              runtime.phoneNumberId || phoneNumberId,
              from,
              _fallbackBotPaused(from, runtime.config?.human),
              runtime.accessToken
            );
          } catch (_) {}
          continue;
        }

        // Alertas de cota — disparo único por threshold (80%, 90%, esgotado)
        if (!quota.justReset) {
          try {
            const customerEmail = await getCustomerEmail(runtime.customer.id);
            if (customerEmail) {
              const planDef = getPlanDefinition(runtime.customer?.plan_code || 'starter');
              if (quota.justExhausted) {
                // 100% — cota esgotada neste exato momento
                enviarEmailCotaEsgotada(
                  customerEmail,
                  runtime.customer.company_name || 'Cliente',
                  quota.limit, planDef.label
                ).catch(() => {});
              } else if (quota.crossed90) {
                // Cruzou 90% — alerta urgente
                enviarEmailAlertaCota(
                  customerEmail,
                  runtime.customer.company_name || 'Cliente',
                  quota.used, quota.limit, planDef.label, planDef.nextUpgrade
                ).catch(() => {});
              } else if (quota.crossed80) {
                // Cruzou 80% — alerta inicial
                enviarEmailAlertaCota(
                  customerEmail,
                  runtime.customer.company_name || 'Cliente',
                  quota.used, quota.limit, planDef.label, planDef.nextUpgrade
                ).catch(() => {});
              }
            }
          } catch (_) {}
        }
        // ── FIM DO GUARDIÃO ─────────────────────────────────────────

        if (!inboundText) {
          try {
            const nomeDaEmpresa = runtime.config?.nome || runtime.customer?.company_name || 'a equipe';
            await sendWhatsAppText(
              runtime.phoneNumberId || phoneNumberId,
              from,
              `Olá! Recebi sua mensagem, mas o atendimento automático de ${nomeDaEmpresa} responde melhor por texto. Escreva sua dúvida em texto e respondo em instantes.`,
              runtime.accessToken
            );
          } catch (_) {}
          continue;
        }

        try {
          const customerId = runtime.customer?.id || runtime.settings?.customer_id || '';
          const userContent = inboundText.slice(0, 4000);
          // Recupera histórico — primeiro do cache em memória, depois do banco como fallback
          // (cobre isolates novos, TTL expirado, retomada após pausa manual)
          const historyMsgs = await _resolveConvHistory(customerId, from);
          const messagesWithHistory = [
            ...historyMsgs,
            { role: 'user', content: userContent },
          ];

          const anthropicResult = await callAnthropic(runtimeApiKey, runtime.config, messagesWithHistory, from);

          if (!anthropicResult.ok) {
            // Erro de saldo Anthropic: alerta admin (dedup 1h) + fallback ao lead.
            // Outros erros (timeout, 5xx, etc): segue silencioso para o lead.
            if (anthropicResult.billingError) {
              alertarAdminSaldoAnthropic({
                status: anthropicResult.status,
                snippet: anthropicResult.data,
                customer: runtime.customer?.company_name || runtime.customer?.id || '',
                plan: runtime.customer?.plan_code || '',
              }).catch(() => {});
              try {
                await sendWhatsAppText(
                  runtime.phoneNumberId || phoneNumberId,
                  from,
                  _fallbackBotPaused(from, runtime.config?.human),
                  runtime.accessToken
                );
              } catch (_) {}
            }
            continue;
          }

          let parsed = {};
          try { parsed = anthropicResult.data ? JSON.parse(anthropicResult.data) : {}; } catch (_) {}
          const reply = String(parsed?.content?.[0]?.text || '').trim();
          if (!reply) continue;

          // Persiste o par user/assistant no histórico para a próxima mensagem
          _appendConvHistory(customerId, from, userContent, reply);

          // Detecta se a IA indicou handoff para humano
          const needsHuman = !!runtime.settings?.human_handoff_enabled && _detectHandoff(reply);

          // Registra no Supabase para dashboard de métricas (fire-and-forget)
          logConversation(customerId, from, userContent, reply, needsHuman).catch(() => {});

          await sendWhatsAppText(runtime.phoneNumberId || phoneNumberId, from, reply, runtime.accessToken);
        } catch (err) {
          // swallow individual message failures to keep webhook responsive
        }
      }
    }
  }

  return json({ ok: true }, 200, origin);
}

// ── 1. CRIAR CHECKOUT SESSION ─────────────────────────────────────
async function criarCheckout(request, origin) {
  // Lê lang antes de qualquer validação para localizar mensagens de erro.
  // Body parse precoce; se falhar, body fica vazio mas lang vira 'pt'.
  let earlyBody = null;
  try { earlyBody = await getJsonBody(request); } catch (_) {}
  const earlyLang = (() => {
    const L = String((earlyBody && earlyBody.lang) || '').trim().toLowerCase();
    return (L === 'es' || L === 'en') ? L : 'pt';
  })();

  // Rate limiting
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'checkout', 5, 60_000)) {
    return json({ error: _errMsg('RATE_LIMIT', earlyLang) }, 429, origin);
  }

  const body = earlyBody;
  if (!body || typeof body !== 'object') {
    return json({ error: _errMsg('PLAN_OR_EMAIL', earlyLang) }, 400, origin);
  }
  const raw = body || {};
  const nome     = sanitizeInput(raw.nome,     100);
  const empresa  = sanitizeInput(raw.empresa,  100);
  const email    = (raw.email || '').trim().toLowerCase().slice(0, 200);
  const whats    = sanitizeInput(raw.whats,     30);
  const plano    = sanitizeInput(raw.plano,     20);
  const planName = sanitizeInput(raw.planName,  50);
  const lang     = earlyLang;

  // Validate email
  if (!validateEmail(email)) {
    return json({ error: _errMsg('INVALID_EMAIL', lang) }, 400, origin);
  }
  if (!whats) {
    return json({ error: _errMsg('PHONE_REQUIRED', lang) }, 400, origin);
  }
  if (!validatePhone(whats)) {
    return json({ error: _errMsg('INVALID_PHONE', lang) }, 400, origin);
  }

  // Bug #12: resolve priceId server-side — never trust frontend
  const PRICE_MAP_BRL = {
    starter:         'price_1TDbtoPH0FzgtoJOIKnfwgvF',
    pro:             'price_1TDbvjPH0FzgtoJOD2Oq2pz6',
    parceiro:        'price_1TDby8PH0FzgtoJORwDvlno2',
    starter_anual:   'price_1TDc39PH0FzgtoJOvewWGFPU',
    pro_anual:       'price_1TDc4VPH0FzgtoJOdtIuqqle',
    parceiro_anual:  'price_1TDc6MPH0FzgtoJOTnivqxfJ',
  };
  const PRICE_MAP_USD = {
    starter:         String(typeof STRIPE_PRICE_STARTER_USD       !== 'undefined' ? STRIPE_PRICE_STARTER_USD       : ''),
    pro:             String(typeof STRIPE_PRICE_PRO_USD            !== 'undefined' ? STRIPE_PRICE_PRO_USD            : ''),
    parceiro:        String(typeof STRIPE_PRICE_PARCEIRO_USD       !== 'undefined' ? STRIPE_PRICE_PARCEIRO_USD       : ''),
    starter_anual:   String(typeof STRIPE_PRICE_STARTER_ANUAL_USD  !== 'undefined' ? STRIPE_PRICE_STARTER_ANUAL_USD  : ''),
    pro_anual:       String(typeof STRIPE_PRICE_PRO_ANUAL_USD      !== 'undefined' ? STRIPE_PRICE_PRO_ANUAL_USD      : ''),
    parceiro_anual:  String(typeof STRIPE_PRICE_PARCEIRO_ANUAL_USD !== 'undefined' ? STRIPE_PRICE_PARCEIRO_ANUAL_USD : ''),
  };
  const isSpanishCheckout = lang === 'es';
  const priceMap = isSpanishCheckout ? PRICE_MAP_USD : PRICE_MAP_BRL;
  const priceId = priceMap[plano];

  if (!email || !priceId) {
    // Se for ES/EN e price USD não configurado → mensagem específica.
    // Se for PT e price BRL não bate o plano → erro genérico de plano/email.
    const code = isSpanishCheckout || lang === 'en' ? 'USD_NOT_READY' : 'PLAN_OR_EMAIL';
    return json({ error: _errMsg(code, lang) }, 400, origin);
  }

  const cancelBase = isSpanishCheckout ? 'https://mercabot.com.br/cadastro/?lang=es' : 'https://mercabot.com.br/cadastro/';
  const successBase = 'https://mercabot.com.br/ativacao/';
  const stripeLocale = isSpanishCheckout ? 'es-419' : 'pt-BR';

  // ── Anti-duplicate: reuse existing Stripe Customer if this email already has one
  // Without this, every retry on /cadastro creates a NEW Stripe customer record
  // for the same email (visible on Stripe Dashboard → Customers as duplicates).
  const existingForEmail = await getCustomerByEmail(email, 'id,stripe_customer_id').catch(() => null);
  const existingStripeCustomerId = (existingForEmail && existingForEmail.stripe_customer_id) || '';

  // Build Stripe Checkout Session
  const params = new URLSearchParams({
    'mode':                              'subscription',
    'line_items[0][price]':              priceId,
    'line_items[0][quantity]':           '1',
    'subscription_data[trial_period_days]': '7',
    'subscription_data[metadata][email]':    email,
    'subscription_data[metadata][nome]':     nome || '',
    'subscription_data[metadata][empresa]':  empresa || '',
    'subscription_data[metadata][whats]':    whats || '',
    'subscription_data[metadata][plano]':    plano || '',
    'subscription_data[metadata][planName]': planName || '',
    'subscription_data[metadata][lang]':     lang,
      'success_url':                       `${successBase}?session_id={CHECKOUT_SESSION_ID}&plano=${plano}&email=${encodeURIComponent(email)}&nome=${encodeURIComponent(nome)}&lang=${lang}`,
      'cancel_url':                        `${cancelBase}${isSpanishCheckout ? `&plano=${plano}&cancelado=1` : `?plano=${plano}&cancelado=1`}`,
    'allow_promotion_codes':             'true',
    'billing_address_collection':        'auto',
    'metadata[email]':                   email,
    'metadata[nome]':                    nome   || '',
    'metadata[empresa]':                 empresa || '',
    'metadata[whats]':                   whats  || '',
    'metadata[plano]':                   plano  || '',
    'metadata[planName]':                planName || '',
    'metadata[lang]':                    lang,
    'locale':                            stripeLocale,
    'payment_method_types[0]':           'card',
  });
  if (!isSpanishCheckout) {
    params.set('payment_method_types[1]', 'boleto');
  }

  // Attach the existing Stripe customer (prevents duplicates on retry) OR
  // pass customer_email so Stripe creates a new Customer for first-time leads.
  if (existingStripeCustomerId) {
    params.set('customer', existingStripeCustomerId);
    // Required when passing `customer` — keeps address/name in sync from checkout
    params.set('customer_update[address]', 'auto');
    params.set('customer_update[name]',    'auto');
  } else {
    params.set('customer_email', email);
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await stripeRes.json();
  if (!stripeRes.ok) {
    console.error(`Stripe error: checkout session failed with status ${stripeRes.status}`);
    return json({ error: 'Não foi possível iniciar o pagamento agora.' }, 400, origin);
  }

  return json({ url: session.url, sessionId: session.id }, 200, origin);
}

// ── 2. WEBHOOK STRIPE ─────────────────────────────────────────────
// Mapa reverso: Price ID → plan_code (inclui BRL e USD)
const PRICE_ID_TO_PLAN = {
  'price_1TDbtoPH0FzgtoJOIKnfwgvF': 'starter',
  'price_1TDbvjPH0FzgtoJOD2Oq2pz6': 'pro',
  'price_1TDby8PH0FzgtoJORwDvlno2': 'parceiro',
  'price_1TDc39PH0FzgtoJOvewWGFPU': 'starter',
  'price_1TDc4VPH0FzgtoJOdtIuqqle': 'pro',
  'price_1TDc6MPH0FzgtoJOTnivqxfJ': 'parceiro',
  // USD — carregados em runtime pois são env vars
};

function getPlanCodeFromPriceId(priceId) {
  if (!priceId) return null;
  // Mapa estático (BRL hardcoded + anual)
  if (PRICE_ID_TO_PLAN[priceId]) return PRICE_ID_TO_PLAN[priceId];
  // Env vars USD (disponíveis como globals no Worker)
  const USD = {
    [String(typeof STRIPE_PRICE_STARTER_USD !== 'undefined' ? STRIPE_PRICE_STARTER_USD : '')]: 'starter',
    [String(typeof STRIPE_PRICE_PRO_USD !== 'undefined' ? STRIPE_PRICE_PRO_USD : '')]: 'pro',
    [String(typeof STRIPE_PRICE_PARCEIRO_USD !== 'undefined' ? STRIPE_PRICE_PARCEIRO_USD : '')]: 'parceiro',
    [String(typeof STRIPE_PRICE_STARTER_ANUAL_USD !== 'undefined' ? STRIPE_PRICE_STARTER_ANUAL_USD : '')]: 'starter',
    [String(typeof STRIPE_PRICE_PRO_ANUAL_USD !== 'undefined' ? STRIPE_PRICE_PRO_ANUAL_USD : '')]: 'pro',
    [String(typeof STRIPE_PRICE_PARCEIRO_ANUAL_USD !== 'undefined' ? STRIPE_PRICE_PARCEIRO_ANUAL_USD : '')]: 'parceiro',
  };
  return USD[priceId] || null;
}

// Suspende acesso do cliente após inadimplência ou cancelamento:
// - bot desativado (bot_enabled = false)
// - quota zerada (ai_msgs_limit = 0) para garantir que IA não seja chamada
// - plan_code não é alterado, permitindo reativação automática via payment_succeeded
async function suspenderAcessoCliente(email, novoStatus) {
  if (!email) return;
  const customer = await getCustomerByEmail(email, 'id');
  if (!customer) return;

  await supabaseAdminRest(`customers?id=eq.${encodeURIComponent(customer.id)}`, 'PATCH', {
    status: novoStatus || 'past_due',
  });
  const settings = await getOrCreateClientSettings(customer.id, 'id');
  if (settings?.id) {
    await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(settings.id)}`, 'PATCH', {
      bot_enabled:    false,
      ai_msgs_limit:  0,    // bloqueia IA independente da cota restante
    });
  }
}

// Reativa acesso após pagamento bem-sucedido (cobrança recorrente)
async function reativarAcessoCliente(email, planCode) {
  if (!email) return;
  const customer = await getCustomerByEmail(email, 'id,plan_code');
  if (!customer) return;

  const resolvedPlan = planCode || normalizePlanCode(customer.plan_code) || 'starter';
  await supabaseAdminRest(`customers?id=eq.${encodeURIComponent(customer.id)}`, 'PATCH', {
    status:    'active',
    plan_code: resolvedPlan,
  });
  const settings = await getOrCreateClientSettings(customer.id, 'id');
  if (settings?.id) {
    await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(settings.id)}`, 'PATCH', {
      bot_enabled:   true,
      ai_msgs_limit: getPlanAiLimit(resolvedPlan),
    });
  }
}

// ── CRM DE CONTATOS ────────────────────────────────────────────────────────────
// Upsert do contato: cria se não existe, atualiza updated_at (e last_user_msg_at para inbound).
// Chamado automaticamente sempre que uma conversa é registrada.
async function upsertContact(customerId, phone, isInbound) {
  if (!customerId || !phone) return;
  const now = new Date().toISOString();
  const body = {
    customer_id: customerId,
    phone:       String(phone).slice(0, 30),
    updated_at:  now,
  };
  // Registra o momento da última mensagem do usuário para lógica de follow-up
  if (isInbound !== false) body.last_user_msg_at = now;
  await supabaseAdminUpsert('contacts', 'customer_id,phone', body);
}

// GET /account/contacts — lista de contatos únicos com stats derivados de conversation_logs
async function carregarContatos(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer) return json({ error: 'Conta indisponível.' }, 404, origin);

  const customerId = runtime.customer.id;
  const reqUrl = new URL(request.url);
  const status = reqUrl.searchParams.get('status') || '';
  const search = reqUrl.searchParams.get('q') || '';
  const limit  = Math.min(parseInt(reqUrl.searchParams.get('limit') || '60', 10), 200);

  // Busca contatos da tabela contacts (já enriquecida com status/notas)
  let contactsPath = `contacts?customer_id=eq.${encodeURIComponent(customerId)}&order=updated_at.desc&limit=${limit}&select=id,phone,name,status,notes,updated_at`;
  if (status) contactsPath += `&status=eq.${encodeURIComponent(status)}`;
  const contactsRes = await supabaseAdminRest(contactsPath);
  const contacts = Array.isArray(contactsRes.data) ? contactsRes.data : [];

  if (!contacts.length) return json({ ok: true, contacts: [], stats: { total: 0, byStatus: {} } }, 200, origin);

  // Busca stats de mensagens dos últimos 30 dias em uma única query
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const statsRes = await supabaseAdminRest(
    `conversation_logs?customer_id=eq.${encodeURIComponent(customerId)}&created_at=gte.${monthAgo}&select=contact_phone,needs_human&limit=5000`
  );
  const logs = Array.isArray(statsRes.data) ? statsRes.data : [];

  // Agrega stats por telefone
  const statsMap = {};
  for (const l of logs) {
    const p = l.contact_phone || '';
    if (!statsMap[p]) statsMap[p] = { msgs: 0, needsHuman: false };
    statsMap[p].msgs++;
    if (l.needs_human) statsMap[p].needsHuman = true;
  }

  // Enriquece cada contato com os stats
  const enriched = contacts.map(c => ({
    ...c,
    msgs30d:    (statsMap[c.phone] || {}).msgs      || 0,
    needsHuman: (statsMap[c.phone] || {}).needsHuman || false,
  }));

  // Filter by search (client-side — contacts already limited)
  const filtered = search
    ? enriched.filter(c => (c.phone || '').includes(search) || (c.name || '').toLowerCase().includes(search.toLowerCase()))
    : enriched;

  // Summary stats
  const byStatus = {};
  for (const c of contacts) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  }

  return json({
    ok: true,
    contacts: filtered,
    stats: { total: contacts.length, byStatus },
  }, 200, origin);
}

// PATCH /account/contacts — atualiza status / nome / notas de um contato
async function atualizarContato(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer) return json({ error: 'Conta indisponível.' }, 404, origin);

  const body = await getJsonBody(request);
  if (!body || typeof body !== 'object') return json({ error: 'Dados inválidos.' }, 400, origin);

  const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 30);
  if (!phone) return json({ error: 'Telefone obrigatório.' }, 400, origin);

  const VALID_STATUSES = ['novo', 'em_andamento', 'qualificado', 'convertido', 'arquivado'];
  const patch = { updated_at: new Date().toISOString() };
  if (body.status && VALID_STATUSES.includes(body.status)) patch.status = body.status;
  if (typeof body.name  === 'string') patch.name  = sanitizeInput(body.name,  120);
  if (typeof body.notes === 'string') patch.notes = String(body.notes).slice(0, 2000);

  const customerId = runtime.customer.id;
  // Upsert: cria o contato se não existir, depois aplica o patch
  await supabaseAdminUpsert('contacts', 'customer_id,phone', {
    customer_id: customerId,
    phone,
    ...patch,
  });

  return json({ ok: true }, 200, origin);
}

// ── DASHBOARD DE CONVERSAS ─────────────────────────────────────────────────────
// Retorna as últimas N conversas do cliente + stats de 30 dias (hoje, semana, mês,
// contatos únicos e breakdown diário dos últimos 7 dias).
async function carregarConversas(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer) return json({ error: 'Conta indisponível.' }, 404, origin);

  const customerId = runtime.customer.id;
  const reqUrl = new URL(request.url);
  const limit   = Math.min(parseInt(reqUrl.searchParams.get('limit') || '30', 10), 100);
  const contact = reqUrl.searchParams.get('contact') || ''; // filter by specific phone

  const nowMs    = Date.now();
  const monthAgo = new Date(nowMs - 30 * 86400000).toISOString();
  const weekAgo  = new Date(nowMs - 7  * 86400000).toISOString();
  const today    = new Date(nowMs).toISOString().slice(0, 10);

  // Recent conversation list (for the UI timeline)
  let logsPath = `conversation_logs?customer_id=eq.${encodeURIComponent(customerId)}&order=created_at.desc&limit=${limit}&select=id,contact_phone,user_text,assistant_text,created_at,needs_human,direction`;
  if (contact) logsPath += `&contact_phone=eq.${encodeURIComponent(contact)}`;
  const logsRes = await supabaseAdminRest(logsPath);
  const logs = Array.isArray(logsRes.data) ? logsRes.data : [];

  // Stats window — last 30 days (capped at 5000 rows; enough for current scale)
  const statsRes = await supabaseAdminRest(
    `conversation_logs?customer_id=eq.${encodeURIComponent(customerId)}&created_at=gte.${monthAgo}&select=created_at,contact_phone&limit=5000`
  );
  const allLogs   = Array.isArray(statsRes.data) ? statsRes.data : [];
  const weekLogs  = allLogs.filter(l => l.created_at >= weekAgo);
  const todayLogs = allLogs.filter(l => (l.created_at || '').startsWith(today));

  const uniqueContacts     = new Set(allLogs.map(l => l.contact_phone)).size;
  const uniqueContactsWeek = new Set(weekLogs.map(l => l.contact_phone)).size;

  // Daily breakdown — last 7 days
  const daily = {};
  for (let i = 6; i >= 0; i--) {
    daily[new Date(nowMs - i * 86400000).toISOString().slice(0, 10)] = 0;
  }
  for (const l of weekLogs) {
    const d = (l.created_at || '').slice(0, 10);
    if (d in daily) daily[d]++;
  }

  return json({
    ok:   true,
    logs,
    stats: {
      totalMonth:          allLogs.length,
      totalWeek:           weekLogs.length,
      totalToday:          todayLogs.length,
      uniqueContacts,
      uniqueContactsWeek,
      daily: Object.entries(daily).map(([date, count]) => ({ date, count })),
    },
  }, 200, origin);
}

async function handleWebhook(request) {
  const payload   = await request.text();
  const sigHeader = request.headers.get('stripe-signature');

  // Verify signature
  let event;
  try {
    event = await verifyStripeSignature(payload, sigHeader, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature invalid');
    return textResponse('Unauthorized', 401, undefined);
  }

  // Logging removed in production for security

  switch (event.type) {

    // ── Checkout completed (trial started or immediate payment)
    case 'checkout.session.completed': {
      const session  = event.data.object;
      const email    = session.customer_email || session.metadata?.email;
      // 'paid' = card/PIX charged | 'no_payment_required' = trial started.
      // 'unpaid' (with status='complete') = boleto generated, NOT yet paid → don't activate.
      const isPaid   = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';

      // ── Pacote extra de mensagens IA (add-on avulso)
      if (session.metadata?.type === 'addon') {
        if (isPaid) await processarAddonPago(session);
        break;
      }

      // ── Assinatura de plano (fluxo normal)
      const nome     = session.metadata?.nome     || '';
      const empresa  = session.metadata?.empresa  || '';
      const planName = session.metadata?.planName || '';
      const plano    = session.metadata?.plano    || '';
      const lang     = (session.metadata?.lang || 'pt').toLowerCase();

      if (email) {
        await ensureCustomerSeedFromCheckout(session);

        if (isPaid) {
          const isParceiro = normalizePlanCode(plano) === 'parceiro';
          if (isParceiro) {
            // Parceiro: apenas o email específico — o genérico fala de WhatsApp/IA, irrelevante para eles
            await enviarEmailParceiro({ email, nome, empresa });
          } else {
            await enviarEmailBoasVindas({ email, nome, empresa, planName, plano, lang });
          }
        } else {
          await enviarEmailBoletoGerado({ email, nome, empresa, planName, plano });
        }
      }
      break;
    }

    // ── Payment succeeded (1ª cobrança, boleto pago ou renovação)
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const email   = invoice.customer_email;
      if (!email) break;

      const priceId  = invoice.lines?.data?.[0]?.price?.id || '';
      const planCode = getPlanCodeFromPriceId(priceId) || null;

      if (invoice.billing_reason === 'subscription_create') {
        // Primeira cobrança confirmada (boleto pago, PIX confirmado, etc.)
        // Só ativa se ainda não estava ativo (evita duplicar e-mail para cartão)
        // Busca via profiles → customers (customers não tem coluna email)
        const customer = await getCustomerByEmail(email, 'id,status,plan_code,company_name').catch(() => null);

        if (customer && customer.status !== 'active') {
          // Ativa acesso: bot_enabled=true + ai_msgs_limit correto
          await reativarAcessoCliente(email, planCode || normalizePlanCode(customer.plan_code));
          // Agora sim envia boas-vindas (boleto/pagamento atrasado confirmado)
          const nome    = customer.company_name || '';
          const empresa = customer.company_name || '';
          const resolvedPlan = planCode || normalizePlanCode(customer.plan_code) || 'starter';
          const planDef = getPlanDefinition(resolvedPlan);
          // lang da subscription (Stripe metadata) — fallback PT
          const subMeta  = invoice?.subscription_details?.metadata || {};
          const lang     = (subMeta.lang || 'pt').toLowerCase();
          if (resolvedPlan === 'parceiro') {
            await enviarEmailParceiro({ email, nome, empresa });
          } else {
            await enviarEmailBoasVindas({ email, nome, empresa, planName: planDef.label, plano: resolvedPlan, lang });
          }
        }

      } else if (invoice.billing_reason === 'subscription_cycle') {
        // Renovação mensal: reativa acesso caso estivesse suspenso por inadimplência
        await reativarAcessoCliente(email, planCode);
        await enviarEmailRenovacao({ email, amount: invoice.amount_paid / 100, currency: (invoice.currency || 'brl').toLowerCase() });
      }
      break;
    }

    // ── Payment failed — dunning em 3 níveis (grace period antes de suspender)
    case 'invoice.payment_failed': {
      const invoice      = event.data.object;
      const email        = invoice.customer_email;
      const attemptCount = Number(invoice.attempt_count || 1);
      if (email) {
        if (attemptCount <= 2) {
          // 1ª e 2ª falha: marca past_due mas mantém bot ativo (grace period)
          await marcarPagamentoPendente(email);
        } else {
          // 3ª+ falha: suspende acesso completo
          await suspenderAcessoCliente(email, 'past_due');
        }
        await enviarEmailDunning({ email, attemptCount });
      }
      break;
    }

    // ── Subscription created (cartão imediato ou trial iniciado)
    // Safety-net: se checkout.session.completed falhou ou ainda não chegou,
    // garante que o customer seed existe e o status está correto.
    // Não ativa ainda — invoice.payment_succeeded cuida da ativação real.
    case 'customer.subscription.created': {
      const sub   = event.data.object;
      const email = sub.metadata?.email || sub.customer_email || '';
      if (!email) break;
      // Só faz algo se status da subscription for 'active' (cartão confirmado)
      // Para boleto o status fica 'incomplete' até o pagamento
      if (sub.status === 'active') {
        const planCode = getPlanCodeFromPriceId(sub.items?.data?.[0]?.price?.id || '') || 'starter';
        const customer = await getCustomerByEmail(email, 'id,status').catch(() => null);
        // Ativa apenas se ainda estava pending_payment — evita sobrescrever at_risk/past_due
        if (customer && customer.status === 'pending_payment') {
          await reativarAcessoCliente(email, planCode);
        }
      }
      break;
    }

    // ── Subscription cancelled → desativa acesso
    case 'customer.subscription.deleted': {
      const sub   = event.data.object;
      const email = sub.metadata?.email || sub.customer_email || '';
      if (email) {
        await suspenderAcessoCliente(email, 'canceled');
        await enviarEmailCancelamento({ email });
      }
      break;
    }

    // ── Subscription updated (upgrade/downgrade) → atualiza plano e quota
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const email = sub.metadata?.email || sub.customer_email || '';
      if (!email) break;

      const newPriceId = sub.items?.data?.[0]?.price?.id || '';
      const newPlanCode = getPlanCodeFromPriceId(newPriceId);
      if (!newPlanCode) break;

      const customer = await getCustomerByEmail(email, 'id,plan_code');
      if (!customer) break;

      // Só atualiza se o plano realmente mudou
      if (normalizePlanCode(customer.plan_code) === normalizePlanCode(newPlanCode)) break;

      await supabaseAdminRest(`customers?id=eq.${encodeURIComponent(customer.id)}`, 'PATCH', {
        plan_code: normalizePlanCode(newPlanCode),
        status: 'active',
      });
      const settings = await getOrCreateClientSettings(customer.id, 'id');
      if (settings?.id) {
        await supabaseAdminRest(`client_settings?id=eq.${encodeURIComponent(settings.id)}`, 'PATCH', {
          ai_msgs_limit: getPlanAiLimit(newPlanCode),
        });
      }
      break;
    }

    default:
      // Unhandled event — no logging in production
  }

  return json({ received: true }, 200);
}

// ── 3. VERIFICAR PAGAMENTO ────────────────────────────────────────
async function verificarPagamento(request, origin) {
  const clientIP   = getClientIp(request);
  const url       = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');
  if (checkRateLimit(clientIP, 'checkout-status', 20, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }
  if (!sessionId) return json({ error: 'session_id obrigatório' }, 400, origin);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return json({ error: 'session_id inválido' }, 400, origin);
  }

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const session = await res.json();
  if (!res.ok) return json({ error: 'Não foi possível verificar o pagamento agora.' }, 400, origin);

  return json({
    status:        session.payment_status,
    plano:         session.metadata?.plano,
    planName:      session.metadata?.planName,
  }, 200, origin);
}

// ── EMAIL: BOAS-VINDAS ────────────────────────────────────────────
async function enviarEmailAddonConfirmado({ email, addonMsgs, novoLimite }) {
  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d120e;color:#e8f0e9;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1a2e1c,#0d120e);padding:32px 32px 24px;border-bottom:1px solid rgba(0,230,118,.15)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00e676;margin-bottom:8px">MercaBot</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3">+${addonMsgs.toLocaleString('pt-BR')} respostas de IA adicionadas!</h1>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;line-height:1.7">Seu pacote extra foi confirmado e já está disponível. Seu bot pode continuar atendendo normalmente.</p>
      <div style="background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.2);border-radius:12px;padding:16px 20px;margin:20px 0;text-align:center">
        <div style="font-size:.9rem;color:#9ab09c;margin-bottom:4px">Novo limite do mês</div>
        <div style="font-size:2rem;font-weight:800;color:#00e676">${novoLimite.toLocaleString('pt-BR')}</div>
        <div style="font-size:.85rem;color:#9ab09c;margin-top:4px">respostas de IA disponíveis</div>
      </div>
      <a href="https://mercabot.com.br/painel-cliente/app/" style="display:inline-block;background:#00e676;color:#0d120e;font-weight:700;padding:12px 24px;border-radius:10px;text-decoration:none;font-size:15px">Ver meu painel →</a>
    </div>
    <div style="padding:16px 32px;border-top:1px solid rgba(234,242,235,.07);font-size:12px;color:#5a7060">MercaBot — atendimento automático para o seu WhatsApp Business</div>
  </div>`;
  return enviarEmail({
    to: email,
    subject: `✅ +${addonMsgs.toLocaleString('pt-BR')} respostas de IA adicionadas — MercaBot`,
    html,
  });
}

async function enviarEmailBoletoGerado({ email, nome, empresa, planName, plano }) {
  const primeiroNome = (nome || empresa || 'Cliente').split(' ')[0];
  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
body{background:#080c09;color:#eaf2eb;font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:0}
.wrap{max-width:560px;margin:0 auto;padding:40px 24px}
.logo{font-size:1.4rem;font-weight:700;color:#eaf2eb;margin-bottom:32px}
.logo span{color:#00e676}
h1{font-size:1.5rem;font-weight:700;margin-bottom:12px;line-height:1.2}
p{color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7;margin-bottom:16px}
.steps{background:#0d120e;border:1px solid rgba(234,242,235,.07);border-radius:12px;padding:16px 20px;margin:20px 0}
.steps ol{margin:0;padding-left:1.2rem;color:rgba(234,242,235,.6);line-height:1.9;font-size:.93rem}
.steps ol strong{color:#eaf2eb}
.cta-box{background:rgba(0,230,118,.06);border:1px solid rgba(0,230,118,.22);border-radius:14px;padding:20px 24px;margin:24px 0;text-align:center}
.cta-box p{color:rgba(234,242,235,.7);margin:0 0 16px}
.cta-box strong{color:#eaf2eb}
.btn{display:inline-block;background:#00e676;color:#080c09;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.95rem}
.note{font-size:.82rem;color:rgba(234,242,235,.35);line-height:1.6;margin-top:8px}
.footer{margin-top:40px;padding-top:24px;border-top:1px solid rgba(234,242,235,.07);font-size:.75rem;color:rgba(234,242,235,.3);line-height:1.7}
</style></head><body><div class="wrap">
<div class="logo">Merca<span>Bot</span></div>
<h1>Boleto gerado ✓</h1>
<p>Olá, <strong style="color:#eaf2eb">${primeiroNome}</strong>! Recebemos seu pedido do plano <strong style="color:#00e676">${planName || plano}</strong>. O boleto bancário foi emitido com sucesso.</p>

<div class="steps">
  <p style="margin:0 0 10px;font-weight:700;color:#eaf2eb;font-size:.95rem">O que acontece agora:</p>
  <ol>
    <li>Pague o boleto em qualquer banco, lotérica ou app bancário</li>
    <li>A compensação ocorre em até <strong>1–3 dias úteis</strong></li>
    <li>Assim que confirmado, seu bot é ativado automaticamente</li>
    <li>Você receberá o e-mail de boas-vindas com as próximas instruções</li>
  </ol>
</div>

<div class="cta-box">
  <p>💡 <strong>Não precisa esperar para começar.</strong> Você já pode entrar no painel e configurar sua IA enquanto o boleto compensa.</p>
  <p style="font-size:.88rem;color:rgba(234,242,235,.55);margin:0 0 16px">Instrução de atendimento, respostas rápidas e número do WhatsApp — tudo pode ser preenchido agora, e quando o pagamento confirmar o bot já estará pronto.</p>
  <a href="https://mercabot.com.br/acesso" class="btn">Entrar no painel agora →</a>
  <p class="note">Use o e-mail <strong style="color:rgba(234,242,235,.5)">${email}</strong> para fazer login.</p>
</div>

<p>O link do boleto está disponível no e-mail de confirmação enviado pelo Stripe. Dúvidas? <a href="mailto:contato@mercabot.com.br" style="color:#00e676">contato@mercabot.com.br</a></p>

<div class="footer">MercaBot — atendimento automático para o seu WhatsApp Business<br>Você está recebendo este e-mail porque realizou uma compra em mercabot.com.br</div>
</div></body></html>`;
  return enviarEmail({
    to: email,
    subject: `Boleto gerado — plano ${planName || plano} MercaBot`,
    html,
  });
}

// Strings localizadas para o e-mail de boas-vindas (PT/ES/EN).
function _welcomeStrings(lang) {
  if (lang === 'es') return {
    title:    'cuenta',
    greeting: '¡Bienvenido, {name}! 🎉',
    intro:    'Tu cuenta MercaBot fue activada con éxito. Estás en el plan <strong style="color:#00e676">{plan}</strong> y ya puedes completar la activación guiada del atendimiento.',
    s1_num:   'Paso 1 — 5 min', s1_title: 'Entrar en tu panel', s1_desc: 'Abre el panel de tu cuenta para seguir la activación guiada del atendimiento.',
    s2_num:   'Paso 2 — 10-20 min', s2_title: 'Informa el número oficial de la empresa', s2_desc: 'Registra el número que tu empresa ya usa con los clientes. Los detalles técnicos se completan después con ayuda guiada.',
    s3_num:   'Paso 3 — 15 min', s3_title: 'Personaliza y haz la primera prueba', s3_desc: 'Revisa la información del negocio, haz una prueba real y solo entonces divulga el atendimento.',
    btn_open: 'Abrir panel →', btn_help: 'Ver paso a paso',
    closing:  '¿Dudas? Accede al <a href="https://mercabot.com.br/soporte/" style="color:#00e676">centro de ayuda</a> para el próximo paso.',
    footer:   'Recibes este correo porque creaste una cuenta en mercabot.com.br.',
    privacy:  'Política de Privacidad', privacy_url: 'https://mercabot.com.br/privacidad/',
    subject:  '✅ Cuenta activada — sigue la activación guiada | MercaBot',
    helpUrl:  'https://mercabot.com.br/soporte/'
  };
  if (lang === 'en') return {
    title:    'account',
    greeting: 'Welcome, {name}! 🎉',
    intro:    'Your MercaBot account has been activated. You are on the <strong style="color:#00e676">{plan}</strong> plan and can now complete the guided activation.',
    s1_num:   'Step 1 — 5 min', s1_title: 'Sign in to your dashboard', s1_desc: 'Open your account dashboard to follow the guided activation.',
    s2_num:   'Step 2 — 10-20 min', s2_title: 'Add your official business number', s2_desc: 'Register the number your business already uses with customers. Technical details are handled later in the guided flow.',
    s3_num:   'Step 3 — 15 min', s3_title: 'Customize and run the first test', s3_desc: 'Review your business info, run a real test, and only then share the service with customers.',
    btn_open: 'Open dashboard →', btn_help: 'See walkthrough',
    closing:  'Questions? Visit our <a href="https://mercabot.com.br/support/" style="color:#00e676">help center</a> for the next step.',
    footer:   'You are receiving this because you created an account at mercabot.com.br.',
    privacy:  'Privacy Policy', privacy_url: 'https://mercabot.com.br/privacidad/',
    subject:  '✅ Account activated — follow the guided setup | MercaBot',
    helpUrl:  'https://mercabot.com.br/support/'
  };
  // PT default
  return {
    title:    'conta',
    greeting: 'Bem-vindo, {name}! 🎉',
    intro:    'Sua conta MercaBot foi ativada com sucesso. Você está no plano <strong style="color:#00e676">{plan}</strong> e já pode concluir a ativação guiada do atendimento.',
    s1_num:   'Passo 1 — 5 min', s1_title: 'Entrar no seu painel', s1_desc: 'Abra o painel da sua conta para seguir a ativação guiada do atendimento.',
    s2_num:   'Passo 2 — 10-20 min', s2_title: 'Informar o número oficial da empresa', s2_desc: 'Cadastre o número que sua empresa já usa com os clientes. Os detalhes técnicos podem ser concluídos depois com ajuda guiada.',
    s3_num:   'Passo 3 — 15 min', s3_title: 'Personalizar e fazer o primeiro teste', s3_desc: 'Revise as informações do negócio, faça um teste real e só então divulgue o atendimento para clientes.',
    btn_open: 'Abrir painel →', btn_help: 'Ver passo a passo',
    closing:  'Dúvidas? Acesse a <a href="https://mercabot.com.br/suporte/" style="color:#00e676">central de ajuda</a> para o próximo passo.',
    footer:   'Você está recebendo este email porque criou uma conta em mercabot.com.br.',
    privacy:  'Política de Privacidade', privacy_url: 'https://mercabot.com.br/privacidade/',
    subject:  '✅ Conta ativada — siga pela ativação guiada | MercaBot',
    helpUrl:  'https://mercabot.com.br/suporte/'
  };
}

async function enviarEmailBoasVindas({ email, nome, empresa, planName, plano, lang }) {
  const primeiroNome = nome ? nome.split(' ')[0] : (lang === 'es' ? 'cliente' : (lang === 'en' ? 'there' : 'cliente'));
  const planoNorm = normalizePlanCode(plano) || 'starter';
  const links = {
    starter:  'https://mercabot.com.br/painel-cliente/app/',
    pro:      'https://mercabot.com.br/painel-cliente/app/',
    parceiro: 'https://mercabot.com.br/painel-parceiro',
  };
  const botLink = links[planoNorm] || links.starter;
  const T = _welcomeStrings(lang);

  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{background:#080c09;color:#eaf2eb;font-family:Arial,sans-serif;margin:0;padding:0}
.wrap{max-width:560px;margin:0 auto;padding:40px 24px}
.logo{font-size:1.4rem;font-weight:700;color:#eaf2eb;margin-bottom:32px}
.logo span{color:#00e676}
h1{font-size:1.5rem;font-weight:700;margin-bottom:12px;line-height:1.2}
p{color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7;margin-bottom:16px}
.btn{display:inline-block;background:#00e676;color:#080c09;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.95rem;margin:8px 4px}
.step-box{background:#0d120e;border:1px solid rgba(234,242,235,.07);border-radius:12px;padding:16px 20px;margin:8px 0}
.step-num{color:#00e676;font-weight:700;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.step-title{font-size:.9rem;font-weight:600;color:#eaf2eb;margin-bottom:4px}
.step-desc{font-size:.82rem;color:rgba(234,242,235,.5);margin:0}
.footer{margin-top:40px;padding-top:24px;border-top:1px solid rgba(234,242,235,.07);font-size:.75rem;color:rgba(234,242,235,.3);line-height:1.7}
</style></head><body><div class="wrap">
<div class="logo">Merca<span>Bot</span></div>
<h1>${T.greeting.replace('{name}', primeiroNome)}</h1>
<p>${T.intro.replace('{plan}', planName || '')}</p>

<div class="step-box"><div class="step-num">${T.s1_num}</div><div class="step-title">${T.s1_title}</div><div class="step-desc">${T.s1_desc}</div></div>
<div class="step-box"><div class="step-num">${T.s2_num}</div><div class="step-title">${T.s2_title}</div><div class="step-desc">${T.s2_desc}</div></div>
<div class="step-box"><div class="step-num">${T.s3_num}</div><div class="step-title">${T.s3_title}</div><div class="step-desc">${T.s3_desc}</div></div>

<div style="margin:24px 0">
  <a href="${botLink}" class="btn">${T.btn_open}</a>
  <a href="${T.helpUrl}" class="btn" style="background:transparent;border:1px solid rgba(0,230,118,.3);color:#00e676">${T.btn_help}</a>
</div>

<p>${T.closing}</p>

<div class="footer">
  MercaBot Tecnologia Ltda. · contato@mercabot.com.br<br>
  ${T.footer}<br>
  <a href="${T.privacy_url}" style="color:rgba(234,242,235,.3)">${T.privacy}</a>
</div>
</div></body></html>`;

  return await enviarEmail({
    to: email,
    subject: T.subject,
    html,
  });
}

// ── EMAIL: PARCEIRO ───────────────────────────────────────────────
async function enviarEmailParceiro({ email, nome, empresa }) {
  const primeiroNome = nome ? nome.split(' ')[0] : 'parceiro';
  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{background:#080c09;color:#eaf2eb;font-family:Arial,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:40px 24px}
.logo{font-size:1.4rem;font-weight:700;color:#eaf2eb;margin-bottom:32px}.logo span{color:#00e676}
h1{font-size:1.4rem;font-weight:700;margin-bottom:12px}
p{color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7;margin-bottom:16px}
.btn{display:inline-block;background:#00e676;color:#080c09;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.95rem;margin:8px 4px}
.footer{margin-top:40px;padding-top:24px;border-top:1px solid rgba(234,242,235,.07);font-size:.75rem;color:rgba(234,242,235,.3)}
</style></head><body><div class="wrap">
<div class="logo">Merca<span>Bot</span></div>
<h1>Bem-vindo ao programa de parceiros, ${primeiroNome}! 🤝</h1>
  <p>Sua conta MercaBot Parceiro foi criada. Nossa equipe irá liberar o acesso ao painel multi-cliente para o seu e-mail em até 1 dia útil e entrará em contato com as instruções de acesso.</p>
<p><strong style="color:#00e676">O que acontece agora:</strong></p>
<p>1. Nossa equipe habilita o seu acesso ao painel parceiro (até 1 dia útil)<br>
2. Você receberá um e-mail de confirmação quando o acesso estiver ativo<br>
3. Com acesso liberado: configure seu white-label e onboarde seus primeiros clientes</p>
<p style="color:rgba(234,242,235,.5);font-size:.82rem">Enquanto aguarda, leia o Guia do Parceiro para se preparar — tem tudo sobre captação, precificação e estrutura de operação.</p>
<div style="margin:24px 0">
          <a href="https://mercabot.com.br/guia-parceiro" class="btn">Ler o Guia do Parceiro →</a>
          <a href="mailto:contato@mercabot.com.br?subject=Acesso%20Parceiro%20MercaBot&body=Olá!%20Sou%20parceiro%20e%20gostaria%20de%20confirmar%20meu%20acesso.%20E-mail%3A%20${encodeURIComponent(email)}" class="btn" style="background:transparent;border:1px solid rgba(0,230,118,.3);color:#00e676">Falar com a equipe</a>
</div>
<p>Tem alguma dúvida? Responda este e-mail ou escreva para <a href="mailto:contato@mercabot.com.br" style="color:#00e676">contato@mercabot.com.br</a>.</p>
<div class="footer">MercaBot Tecnologia Ltda. · contato@mercabot.com.br</div>
</div></body></html>`;

  return await enviarEmail({ to: email, subject: '🤝 Conta Parceiro MercaBot criada — próximos passos', html });
}

// ── EMAIL: RENOVAÇÃO ─────────────────────────────────────────────
async function enviarEmailRenovacao({ email, amount, currency }) {
  const isUsd = (currency || 'brl').toLowerCase() === 'usd';
  const amountFormatted = isUsd
    ? `US$${Number(amount).toFixed(2)}`
    : `R$${Number(amount).toFixed(2).replace('.', ',')}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#080c09;color:#eaf2eb;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<div style="font-size:1.4rem;font-weight:700;margin-bottom:32px">Merca<span style="color:#00e676">Bot</span></div>
<h1 style="font-size:1.3rem;margin-bottom:12px">Renovação confirmada ✅</h1>
<p style="color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7">Seu plano MercaBot foi renovado com sucesso. Cobramos ${amountFormatted} no seu cartão.</p>
<p style="color:rgba(234,242,235,.65);font-size:.9rem">Obrigado por continuar com a gente!</p>
<div style="margin-top:32px;font-size:.75rem;color:rgba(234,242,235,.3)">MercaBot Tecnologia Ltda. · contato@mercabot.com.br</div>
</div></body></html>`;
  return await enviarEmail({ to: email, subject: '✅ Renovação MercaBot confirmada', html });
}

// ── EMAIL: PAGAMENTO FALHOU ───────────────────────────────────────
// Marca status past_due SEM desativar o bot (grace period nas primeiras falhas)
async function marcarPagamentoPendente(email) {
  if (!email) return;
  const customer = await getCustomerByEmail(email, 'id');
  if (!customer) return;
  // at_risk = grace period: bot permanece ativo, mas pagamento está pendente.
  // past_due só é usado após 3ª+ falha (suspenderAcessoCliente) — é bloqueado em BLOCKED_STATUSES.
  await supabaseAdminRest(`customers?id=eq.${encodeURIComponent(customer.id)}`, 'PATCH', {
    status: 'at_risk',
    // bot_enabled e ai_msgs_limit NÃO são alterados — bot continua rodando
  });
}

// ── ALERTA ADMIN — saldo Anthropic insuficiente ────────────────────────────
// Dedup in-memory: dispara no máximo 1 alerta a cada 60 minutos para evitar
// flood de e-mails se 100 leads escreverem enquanto o billing está quebrado.
let _lastAnthropicBillingAlertAt = 0;
async function alertarAdminSaldoAnthropic(context) {
  const now = Date.now();
  if (now - _lastAnthropicBillingAlertAt < 60 * 60 * 1000) return; // 1h dedup
  _lastAnthropicBillingAlertAt = now;

  const adminEmail = (typeof ADMIN_EMAIL !== 'undefined' && ADMIN_EMAIL)
    ? ADMIN_EMAIL : 'contato@mercabot.com.br';
  const status   = String(context?.status || '?');
  const snippet  = String(context?.snippet || '').slice(0, 400);
  const customer = String(context?.customer || '?');
  const plan     = String(context?.plan || '?');

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d120e;color:#e8f0e9;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#3a0a0a,#0d120e);padding:32px;border-bottom:1px solid rgba(239,68,68,.3)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#fca5a5;margin-bottom:8px">MercaBot · ALERTA OPERACIONAL</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3">🚨 Anthropic recusou request — possível saldo insuficiente</h1>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;line-height:1.7">A API da Anthropic retornou um erro de billing/saldo ao processar uma mensagem do bot. Os leads recebem fallback amigável, mas <strong style="color:#fca5a5">nenhuma resposta de IA será gerada até o saldo ser recarregado</strong>.</p>
      <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:14px 18px;margin:18px 0;font-size:13px;line-height:1.6">
        <div><strong style="color:#fca5a5">HTTP status:</strong> ${status}</div>
        <div><strong style="color:#fca5a5">Cliente afetado:</strong> ${customer} (plano ${plan})</div>
        <div style="margin-top:8px;font-family:ui-monospace,Menlo,monospace;color:#9ab09c;font-size:12px;word-break:break-all">${snippet.replace(/</g, '&lt;')}</div>
      </div>
      <p style="margin:0 0 18px;line-height:1.7"><strong>Ação imediata:</strong></p>
      <ol style="margin:0 0 18px;padding-left:1.2rem;line-height:1.9;color:#9ab09c">
        <li>Acesse <a href="https://console.anthropic.com/settings/billing" style="color:#00e676">console.anthropic.com → Billing</a></li>
        <li>Recarregue créditos ou ative <strong>Auto-Reload</strong></li>
        <li>O bot volta a responder automaticamente — sem redeploy</li>
      </ol>
      <p style="margin:0;font-size:.78rem;color:#5a7060;line-height:1.6">Próximo alerta deduplicado por 60 minutos para evitar flood. Se vir vários, é porque o problema persiste.</p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid rgba(234,242,235,.07);font-size:12px;color:#5a7060">MercaBot — alerta automático do worker</div>
  </div>`;

  try {
    await enviarEmail({
      to: adminEmail,
      subject: '🚨 [MercaBot] Saldo Anthropic insuficiente — bot pausou',
      html,
    });
  } catch (_) {}
}

// E-mail enviado no exato momento em que a cota de IA é esgotada (100%)
async function enviarEmailCotaEsgotada(email, companyName, limit, planLabel) {
  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d120e;color:#e8f0e9;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#2a1010,#0d120e);padding:32px 32px 24px;border-bottom:1px solid rgba(239,68,68,.2)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00e676;margin-bottom:8px">MercaBot</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3">🚫 Cota de IA esgotada — atendimento automático pausado</h1>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;color:#9ab09c;line-height:1.7">Olá, <strong style="color:#e8f0e9">${companyName}</strong>!</p>
      <p style="margin:0 0 16px;line-height:1.7">As <strong>${limit.toLocaleString('pt-BR')} respostas de IA</strong> do seu plano <strong>${planLabel}</strong> foram consumidas este mês. A partir de agora, os clientes que enviarem mensagens não receberão resposta automática até que a cota seja ampliada ou renovada.</p>
      <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:12px;padding:16px 20px;margin:20px 0">
        <div style="font-size:14px;font-weight:700;color:#fca5a5;margin-bottom:8px">Opções para retomar o atendimento agora:</div>
        <ul style="margin:0;padding-left:1.2rem;color:#9ab09c;line-height:2;font-size:.9rem">
          <li><strong style="color:#e8f0e9">+1.000 respostas — R$47</strong> — ideal para cobrir o restante do mês</li>
          <li><strong style="color:#e8f0e9">+5.000 respostas — R$235</strong> — mais economia, mais folga</li>
          <li><strong style="color:#e8f0e9">Fazer upgrade de plano</strong> — cota mensal maior + recursos extras</li>
        </ul>
      </div>
      <p style="margin:0 0 20px;color:#9ab09c;font-size:.88rem">A cota renova automaticamente no início do próximo mês. Comprar um pacote extra soma ao limite atual imediatamente.</p>
      <a href="https://mercabot.com.br/painel-cliente/app/?tab=plano" style="display:inline-block;background:#00e676;color:#0d120e;font-weight:700;padding:12px 24px;border-radius:10px;text-decoration:none;font-size:15px;margin-right:12px">Comprar pacote extra →</a>
      <a href="https://mercabot.com.br/painel-cliente/app/?tab=plano" style="display:inline-block;background:rgba(255,255,255,.07);color:#e8f0e9;font-weight:600;padding:12px 24px;border-radius:10px;text-decoration:none;font-size:15px;border:1px solid rgba(255,255,255,.12)">Ver planos de upgrade</a>
    </div>
    <div style="padding:16px 32px;border-top:1px solid rgba(234,242,235,.07);font-size:12px;color:#5a7060">MercaBot — atendimento automático para o seu WhatsApp Business</div>
  </div>`;

  return enviarEmail({
    to: email,
    subject: `🚫 Cota de IA esgotada — ${companyName} sem atendimento automático`,
    html,
  });
}

// ── DUNNING EMAILS — 3 níveis escalados ──────────────────────────
async function enviarEmailDunning({ email, attemptCount }) {
  const PANEL_BILLING = 'https://mercabot.com.br/painel-cliente/app/?tab=plano';
  const n = Number(attemptCount || 1);

  // ── Nível 1: aviso amigável, bot ainda ativo ────────────────────
  if (n === 1) {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#080c09;color:#eaf2eb;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<div style="font-size:1.4rem;font-weight:700;margin-bottom:32px">Merca<span style="color:#00e676">Bot</span></div>
<h1 style="font-size:1.3rem;margin-bottom:12px">Precisamos que você atualize seu cartão</h1>
<p style="color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7">Olá! Tentamos renovar seu plano MercaBot mas o cartão não foi aceito pelo banco. <strong style="color:#eaf2eb">Seu bot continua ativo por enquanto</strong> — mas precisamos regularizar o pagamento em breve para evitar a suspensão do atendimento.</p>
<div style="background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.2);border-radius:12px;padding:16px 20px;margin:20px 0;font-size:.9rem;color:rgba(234,242,235,.75)">
  <strong style="color:#00e676">O que pode ter acontecido:</strong><br>
  · Limite do cartão insuficiente<br>
  · Banco bloqueou débito automático (ligue para o banco e libere)<br>
  · Cartão expirado ou substituído
</div>
<a href="${PANEL_BILLING}" style="display:inline-block;background:#00e676;color:#080c09;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.9rem;margin-top:8px">Atualizar cartão agora →</a>
<p style="color:rgba(234,242,235,.4);font-size:.8rem;margin-top:24px">Dúvidas? <a href="https://mercabot.com.br/suporte/" style="color:rgba(0,230,118,.7)">Central de ajuda</a></p>
<div style="margin-top:32px;font-size:.75rem;color:rgba(234,242,235,.3)">MercaBot · contato@mercabot.com.br</div>
</div></body></html>`;
    return await enviarEmail({ to: email, subject: 'Atenção: não conseguimos renovar seu plano MercaBot', html });
  }

  // ── Nível 2: urgente, bot ainda ativo mas prestes a suspender ───
  if (n === 2) {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#080c09;color:#eaf2eb;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<div style="font-size:1.4rem;font-weight:700;margin-bottom:32px">Merca<span style="color:#00e676">Bot</span></div>
<h1 style="font-size:1.3rem;margin-bottom:12px">⚠️ Segunda tentativa falhou — aja agora</h1>
<p style="color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7">Já tentamos cobrar seu plano duas vezes e o cartão continua sendo recusado. <strong style="color:#fcd34d">Se não for regularizado, seu bot será suspenso automaticamente na próxima tentativa.</strong></p>
<p style="color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7">Enquanto o pagamento não é resolvido, seu atendimento automático está em risco. Atualize seu método de pagamento agora — leva menos de 1 minuto.</p>
<a href="${PANEL_BILLING}" style="display:inline-block;background:#f59e0b;color:#080c09;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.9rem;margin-top:8px">Resolver agora — antes que o bot pare →</a>
<p style="color:rgba(234,242,235,.4);font-size:.8rem;margin-top:24px">Se seu banco está bloqueando, ligue para ele e solicite a liberação de débitos recorrentes para MERCABOT. Depois volte aqui e tente novamente.</p>
<div style="margin-top:32px;font-size:.75rem;color:rgba(234,242,235,.3)">MercaBot · contato@mercabot.com.br · <a href="https://mercabot.com.br/suporte/" style="color:rgba(234,242,235,.3)">Suporte</a></div>
</div></body></html>`;
    return await enviarEmail({ to: email, subject: 'Ação necessária: seu bot MercaBot será suspenso em breve', html });
  }

  // ── Nível 3+: bot suspenso, reativação imediata ao pagar ────────
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#080c09;color:#eaf2eb;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<div style="font-size:1.4rem;font-weight:700;margin-bottom:32px">Merca<span style="color:#00e676">Bot</span></div>
<h1 style="font-size:1.3rem;margin-bottom:12px">Bot suspenso — seus clientes não estão recebendo resposta</h1>
<p style="color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7">Após múltiplas tentativas sem sucesso, seu atendimento automático foi <strong style="color:#fca5a5">pausado temporariamente</strong>. Os clientes que mandarem mensagens no WhatsApp não receberão resposta até a regularização.</p>
<div style="background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.2);border-radius:12px;padding:16px 20px;margin:20px 0;font-size:.9rem">
  <strong style="color:#00e676">Reativação é automática e imediata:</strong>
  <ol style="margin:8px 0 0 1rem;padding:0;color:rgba(234,242,235,.7);line-height:2">
    <li>Atualize seu cartão no painel</li>
    <li>O pagamento é processado na hora</li>
    <li>Seu bot é reativado automaticamente — sem precisar fazer mais nada</li>
  </ol>
</div>
<a href="${PANEL_BILLING}" style="display:inline-block;background:#00e676;color:#080c09;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.9rem;margin-top:8px">Reativar meu bot agora →</a>
<p style="color:rgba(234,242,235,.4);font-size:.8rem;margin-top:24px">Se precisar de ajuda, acesse <a href="https://mercabot.com.br/suporte/" style="color:rgba(0,230,118,.7)">mercabot.com.br/suporte</a> ou responda este e-mail.</p>
<div style="margin-top:32px;font-size:.75rem;color:rgba(234,242,235,.3)">MercaBot · contato@mercabot.com.br</div>
</div></body></html>`;
  return await enviarEmail({ to: email, subject: 'Bot suspenso: atualize o pagamento para reativar o atendimento', html });
}

// ── EMAIL: CANCELAMENTO ───────────────────────────────────────────
async function enviarEmailCancelamento({ email }) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#080c09;color:#eaf2eb;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<div style="font-size:1.4rem;font-weight:700;margin-bottom:32px">Merca<span style="color:#00e676">Bot</span></div>
<h1 style="font-size:1.3rem;margin-bottom:12px">Até logo 👋</h1>
<p style="color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7">Sua assinatura MercaBot foi cancelada. Sentimos sua falta.</p>
<p style="color:rgba(234,242,235,.65);font-size:.9rem">Se mudar de ideia, é só voltar — sem taxa de reativação. Seus dados ficam salvos por 30 dias.</p>
    <a href="https://mercabot.com.br/cadastro/" style="display:inline-block;background:#00e676;color:#080c09;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:.9rem;margin-top:16px">Reativar minha conta →</a>
<div style="margin-top:32px;font-size:.75rem;color:rgba(234,242,235,.3)">MercaBot Tecnologia Ltda. · contato@mercabot.com.br</div>
</div></body></html>`;
  return await enviarEmail({ to: email, subject: 'Conta MercaBot cancelada — você pode voltar quando quiser', html });
}

// ── RESPOSTA HUMANA VIA PAINEL ────────────────────────────────────────────────
// Permite que o cliente responda manualmente a uma conversa diretamente do painel.
// Usa a mesma infra de channel (phone_number_id + access_token) já configurada.
async function enviarRespostaHumana(request, origin) {
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão inválida.' }, 401, origin);

  const runtime = await loadCustomerRuntimeByJwt(jwt);
  if (!runtime?.customer || !runtime?.settings) {
    return json({ error: 'Conta indisponível.' }, 404, origin);
  }
  if (!runtime.phoneNumberId || !runtime.accessToken) {
    return json({ error: 'Canal WhatsApp não configurado. Configure o número oficial primeiro.' }, 409, origin);
  }

  const body = await getJsonBody(request);
  const to      = String(body?.to      || '').replace(/\D/g, '').slice(0, 20);
  const message = String(body?.message || '').trim().slice(0, 4000);

  if (!to || !message) {
    return json({ error: 'Destinatário e mensagem são obrigatórios.' }, 400, origin);
  }

  try {
    await sendWhatsAppText(runtime.phoneNumberId, to, message, runtime.accessToken);

    // Registra como mensagem outbound no log.
    // IMPORTANTE: aguardamos a inserção. Em Cloudflare Workers, promessas
    // não-awaited são canceladas após `return`, então sem await a mensagem
    // chegava no WhatsApp mas sumia do histórico no próximo polling.
    const insertRes = await supabaseAdminRest('conversation_logs', 'POST', {
      customer_id:    runtime.customer.id,
      contact_phone:  to,
      user_text:      '',
      assistant_text: message,
      needs_human:    false,
      direction:      'outbound',
    }).catch(() => null);

    if (!insertRes || !insertRes.ok) {
      console.error('enviarRespostaHumana: conversation_logs INSERT failed', insertRes && insertRes.status);
    }
    // NÃO atualiza last_user_msg_at — mensagens enviadas pelo dono não reiniciam o timer de follow-up
    await upsertContact(runtime.customer.id, to, false).catch(() => {});

    return json({ ok: true }, 200, origin);
  } catch (err) {
    return json({ error: 'Não foi possível enviar a mensagem. Verifique a configuração do canal.' }, 502, origin);
  }
}

// ── RELATÓRIO SEMANAL DE DESEMPENHO ──────────────────────────────────────────
// Enviado toda segunda-feira para cada cliente ativo que teve ≥1 conversa na semana.
// Mostra: volume de mensagens, contatos únicos, horas economizadas, cota de IA.
async function enviarRelatoriosSemanais() {
  const nowMs   = Date.now();
  const weekAgo = new Date(nowMs - 7 * 86400000).toISOString();

  // 1. Clientes ativos com e-mail (máx 200 por cron)
  const custRes = await supabaseAdminRest(
    `customers?status=eq.active&select=id,email,company_name,plan_code&limit=200`
  ).catch(() => null);
  const customers = Array.isArray(custRes?.data) ? custRes.data : [];
  if (!customers.length) return 0;

  let sent = 0;

  for (const customer of customers) {
    if (!customer.email) continue;
    try {
      // 2. Conversas da última semana para esse cliente
      const logRes = await supabaseAdminRest(
        `conversation_logs?customer_id=eq.${encodeURIComponent(customer.id)}&created_at=gte.${weekAgo}&select=contact_phone,created_at&limit=5000`
      ).catch(() => null);
      const logs = Array.isArray(logRes?.data) ? logRes.data : [];

      // Só envia se teve ao menos 1 conversa na semana
      if (logs.length === 0) continue;

      // 3. Quota de IA
      const settingsRes = await supabaseAdminRest(
        `client_settings?customer_id=eq.${encodeURIComponent(customer.id)}&select=ai_msgs_used,ai_msgs_limit&limit=1`
      ).catch(() => null);
      const settings = Array.isArray(settingsRes?.data) && settingsRes.data[0] ? settingsRes.data[0] : {};
      const aiUsed  = Number(settings.ai_msgs_used  || 0);
      const aiLimit = Number(settings.ai_msgs_limit || getPlanAiLimit(customer.plan_code || 'starter'));

      // 4. Stats calculados do lado do worker
      const uniqueContacts = new Set(logs.map(l => l.contact_phone)).size;
      const hoursEstimated = Math.round(logs.length * 3 / 60 * 10) / 10; // 3 min por resposta
      const planDef = getPlanDefinition(customer.plan_code || 'starter');

      await enviarEmailRelatorioSemanal({
        email:          customer.email,
        nome:           customer.company_name || 'Cliente',
        totalMsgs:      logs.length,
        uniqueContacts,
        hoursEstimated,
        aiUsed,
        aiLimit,
        planLabel:      planDef.label,
        nextUpgrade:    planDef.nextUpgrade,
      });
      sent++;
    } catch (_) { /* continua para o próximo cliente */ }
  }
  return sent;
}

async function enviarEmailRelatorioSemanal({ email, nome, totalMsgs, uniqueContacts, hoursEstimated, aiUsed, aiLimit, planLabel, nextUpgrade }) {
  const primeiroNome = (nome || 'cliente').split(' ')[0];
  const aiPct        = aiLimit > 0 ? Math.round((aiUsed / aiLimit) * 100) : 0;
  const aiRemaining  = Math.max(aiLimit - aiUsed, 0);
  const aiAlerta     = aiPct >= 80;

  const alertaHtml = aiAlerta ? `
    <div style="background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.22);border-radius:12px;padding:14px 18px;margin:20px 0">
      <strong style="color:#f59e0b">⚠️ Cota de IA em ${aiPct}%</strong><br>
      <span style="color:#9ab09c;font-size:14px">Restam <strong style="color:#e8f0e9">${aiRemaining.toLocaleString('pt-BR')}</strong> respostas neste mês.
      ${nextUpgrade ? `Faça upgrade para o plano <strong>${nextUpgrade.charAt(0).toUpperCase() + nextUpgrade.slice(1)}</strong> ou contrate um pacote extra de mensagens.` : 'Contrate um pacote extra de mensagens no painel para não pausar o atendimento.'}</span>
    </div>` : '';

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d120e;color:#e8f0e9;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1a2e1c,#0d120e);padding:32px 32px 24px;border-bottom:1px solid rgba(0,230,118,.15)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00e676;margin-bottom:8px">MercaBot · Relatório Semanal</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3">Seu bot trabalhou por você esta semana 💚</h1>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 20px;color:#9ab09c;line-height:1.7">Olá, <strong style="color:#e8f0e9">${primeiroNome}</strong>! Aqui está o resumo da semana do seu atendimento automático.</p>

      <!-- Métricas principais -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        <div style="background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.15);border-radius:12px;padding:16px 18px;text-align:center">
          <div style="font-size:32px;font-weight:700;color:#00e676;line-height:1.1">${totalMsgs.toLocaleString('pt-BR')}</div>
          <div style="font-size:13px;color:#9ab09c;margin-top:4px">Conversas respondidas</div>
        </div>
        <div style="background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.15);border-radius:12px;padding:16px 18px;text-align:center">
          <div style="font-size:32px;font-weight:700;color:#00e676;line-height:1.1">${uniqueContacts.toLocaleString('pt-BR')}</div>
          <div style="font-size:13px;color:#9ab09c;margin-top:4px">Contatos únicos</div>
        </div>
        <div style="background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.15);border-radius:12px;padding:16px 18px;text-align:center">
          <div style="font-size:32px;font-weight:700;color:#00e676;line-height:1.1">~${hoursEstimated}h</div>
          <div style="font-size:13px;color:#9ab09c;margin-top:4px">Horas economizadas</div>
        </div>
        <div style="background:rgba(${aiAlerta ? '245,158,11' : '0,230,118'},.07);border:1px solid rgba(${aiAlerta ? '245,158,11' : '0,230,118'},.15);border-radius:12px;padding:16px 18px;text-align:center">
          <div style="font-size:32px;font-weight:700;color:${aiAlerta ? '#f59e0b' : '#00e676'};line-height:1.1">${aiPct}%</div>
          <div style="font-size:13px;color:#9ab09c;margin-top:4px">Cota de IA usada</div>
        </div>
      </div>

      ${alertaHtml}

      <p style="margin:0 0 12px;line-height:1.7;color:#9ab09c">Plano <strong style="color:#e8f0e9">${planLabel}</strong> · ${aiUsed.toLocaleString('pt-BR')} / ${aiLimit.toLocaleString('pt-BR')} respostas de IA este mês.</p>

      <div style="margin:24px 0;text-align:center">
        <a href="https://mercabot.com.br/painel-cliente/app/" style="display:inline-block;background:#00e676;color:#080c09;font-weight:700;font-size:15px;padding:14px 32px;border-radius:999px;text-decoration:none">Abrir painel →</a>
      </div>

      <div style="border-top:1px solid rgba(234,242,235,.08);padding-top:16px;font-size:13px;color:#5a6e5c;line-height:1.6">
        Você está recebendo este e-mail porque tem uma conta ativa no MercaBot. Acesse o painel para gerenciar seu atendimento.
      </div>
    </div>
  </div>`;

  return enviarEmail({
    to:      email,
    subject: `📊 Seu bot respondeu ${totalMsgs} vezes esta semana — MercaBot`,
    html,
  });
}

// ── ADMIN: DIAGNÓSTICO E TESTE ────────────────────────────────────
// GET /admin/diagnostics — visão geral de todas as integrações críticas.
// Não expõe valores das chaves, só confirma presença e faz chamadas read-only.
async function adminDiagnostics(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'admin-diag', 10, 60_000)) {
    return json({ error: 'Rate limit' }, 429, origin);
  }

  // Env vars — apenas presença
  const envChecks = {
    SUPABASE_URL:              !!SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!(typeof SUPABASE_SERVICE_ROLE_KEY !== 'undefined' && SUPABASE_SERVICE_ROLE_KEY),
    ANTHROPIC_API_KEY:         !!(typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY),
    STRIPE_SECRET_KEY:         !!(typeof STRIPE_SECRET_KEY !== 'undefined' && STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET:     !!(typeof STRIPE_WEBHOOK_SECRET !== 'undefined' && STRIPE_WEBHOOK_SECRET),
    RESEND_API_KEY:            !!(typeof RESEND_API_KEY !== 'undefined' && RESEND_API_KEY),
    FROM_EMAIL:                !!(typeof FROM_EMAIL !== 'undefined' && FROM_EMAIL),
  };

  // Resend — verifica se a chave é válida (chamada read-only à API)
  let resendStatus = { reachable: false, keyValid: null, error: null };
  if (envChecks.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` },
      });
      const d = await r.json().catch(() => ({}));
      resendStatus.reachable = true;
      resendStatus.keyValid = r.ok;
      if (!r.ok) resendStatus.error = d?.message || `HTTP ${r.status}`;
      else resendStatus.domains = Array.isArray(d?.data) ? d.data.map(x => x.name) : [];
    } catch (e) {
      resendStatus.reachable = false;
      resendStatus.error = e?.message || 'fetch failed';
    }
  }

  // Stripe — verifica se a chave é válida e detecta modo (live vs test)
  // Nota: o objeto Account do Stripe não tem campo "livemode" diretamente, então
  // detectamos o modo pelo prefixo da chave (sk_live_ / sk_test_ / rk_live_ / rk_test_).
  const stripeKey = typeof STRIPE_SECRET_KEY !== 'undefined' ? String(STRIPE_SECRET_KEY || '') : '';
  const stripeModeFromKey = stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_') ? 'live'
    : stripeKey.startsWith('sk_test_') || stripeKey.startsWith('rk_test_') ? 'test' : 'unknown';
  let stripeStatus = { reachable: false, keyValid: null, mode: stripeModeFromKey, error: null };
  if (envChecks.STRIPE_SECRET_KEY) {
    if (stripeModeFromKey === 'test') {
      stripeStatus.warning = '⚠️ STRIPE_SECRET_KEY está em modo TESTE (sk_test_...). Nenhum pagamento real será processado. Troque pela chave live (sk_live_...) no Cloudflare Dashboard → Workers → mercabot-api → Settings → Variables.';
    }
    try {
      const r = await fetch('https://api.stripe.com/v1/account', {
        headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
      });
      const d = await r.json().catch(() => ({}));
      stripeStatus.reachable = true;
      stripeStatus.keyValid = r.ok;
      if (r.ok) {
        stripeStatus.accountId = d.id || null;
        stripeStatus.email = d.email || null;
        stripeStatus.chargesEnabled = d.charges_enabled ?? null;
        stripeStatus.payoutsEnabled = d.payouts_enabled ?? null;
      } else {
        stripeStatus.error = d?.error?.message || `HTTP ${r.status}`;
      }
    } catch (e) {
      stripeStatus.reachable = false;
      stripeStatus.error = e?.message || 'fetch failed';
    }
  }

  // Checkout readiness
  const checkoutReadiness = buildCheckoutReadiness();

  return json({
    ok: true,
    ts: Date.now(),
    env: envChecks,
    resend: resendStatus,
    stripe: stripeStatus,
    checkout: checkoutReadiness,
  }, 200, origin);
}

// POST /admin/test-email — envia um e-mail de teste via Resend.
// Corpo: { "to": "email@destino.com" }
// Rate limit: 3 por hora por IP.
async function adminTestEmail(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'admin-test-email', 3, 3600_000)) {
    return json({ error: 'Rate limit — máximo 3 e-mails de teste por hora.' }, 429, origin);
  }
  const body = await getJsonBody(request);
  const to = (body?.to || '').trim().toLowerCase();
  if (!validateEmail(to)) {
    return json({ error: 'E-mail de destino inválido.' }, 400, origin);
  }

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;background:#0d120e;color:#e8f0e9;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1a2e1c,#0d120e);padding:28px 32px 20px;border-bottom:1px solid rgba(0,230,118,.15)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00e676;margin-bottom:8px">MercaBot · Diagnóstico</div>
      <h1 style="margin:0;font-size:20px;font-weight:700;line-height:1.3">✅ E-mail de teste</h1>
    </div>
    <div style="padding:24px 32px">
      <p style="margin:0 0 12px;line-height:1.7">Este e-mail foi enviado manualmente via <code>/admin/test-email</code> às <strong>${new Date().toISOString()}</strong>.</p>
      <p style="margin:0;font-size:.87rem;color:#5a7060">Se você recebeu esta mensagem, o RESEND_API_KEY está válido e a entrega de e-mails está funcionando corretamente.</p>
    </div>
  </div>`;

  const result = await enviarEmail({ to, subject: '✅ MercaBot — teste de entrega de e-mail', html });
  if (result?.id) {
    return json({ ok: true, id: result.id, to }, 200, origin);
  }
  return json({ ok: false, error: result?.message || 'Falha no envio — verifique os logs do Worker.' }, 500, origin);
}

// ── POST /admin/recovery-blast ───────────────────────────────────
// Dispara um e-mail de cobrança fresco para todos os clientes em estado
// de inadimplência (past_due, at_risk) ou boleto pendente (pending_payment).
// Útil para empurrar manualmente uma onda de recuperação além das tentativas
// automáticas do Stripe Smart Retries.
//
// Auth: JWT do admin (somente o e-mail listado em ADMIN_EMAIL pode chamar).
// Body opcional: { dry: true } → só lista quem receberia, não dispara nada.
async function adminRecoveryBlast(request, origin) {
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'admin-recovery', 5, 3600_000)) {
    return json({ error: 'Rate limit — máximo 5 disparos por hora.' }, 429, origin);
  }

  // 1. Auth: precisa ser o e-mail admin
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sessão necessária.' }, 401, origin);

  const user = await getSupabaseUser(jwt);
  const callerEmail = String(user?.email || '').toLowerCase().trim();
  const adminEmail = (typeof ADMIN_EMAIL !== 'undefined' && ADMIN_EMAIL)
    ? String(ADMIN_EMAIL).toLowerCase().trim()
    : 'thiago.oliveira.comp@gmail.com';
  if (!callerEmail || callerEmail !== adminEmail) {
    return json({ error: 'Acesso restrito ao admin.' }, 403, origin);
  }

  const body = await getJsonBody(request).catch(() => null);
  const dryRun = !!(body && body.dry);
  const includeCanceled = !!(body && body.includeCanceled !== false); // default true

  // 2. Busca clientes em estado recuperável.
  // ATENÇÃO: customers NÃO tem coluna email — vem de profiles via user_id.
  // Por isso fazemos 2 queries e juntamos em JS (PostgREST embedding também
  // funcionaria, mas preferimos a forma explícita para visibilidade).
  const statuses = includeCanceled
    ? 'in.(past_due,at_risk,pending_payment,canceled)'
    : 'in.(past_due,at_risk,pending_payment)';
  const custRes = await supabaseAdminRest(
    `customers?status=${encodeURIComponent(statuses)}&select=id,user_id,company_name,plan_code,status,stripe_customer_id&limit=500`
  ).catch(() => null);
  if (!custRes || !custRes.ok) {
    return json({
      ok: false,
      error: 'Falha ao consultar customers.',
      status: custRes?.status,
      detail: custRes?.data,
    }, 500, origin);
  }
  const customers = Array.isArray(custRes.data) ? custRes.data : [];

  if (!customers.length) {
    return json({ ok: true, sent: 0, totalEligible: 0, results: [], message: 'Nenhum cliente em estado de cobrança.' }, 200, origin);
  }

  // 2b. Busca os e-mails dos user_ids encontrados.
  const userIds = customers.map(c => c.user_id).filter(Boolean);
  const emailMap = {};
  if (userIds.length) {
    const idsParam = encodeURIComponent('in.(' + userIds.join(',') + ')');
    const profRes = await supabaseAdminRest(
      `profiles?id=${idsParam}&select=id,email&limit=500`
    ).catch(() => null);
    if (profRes && profRes.ok && Array.isArray(profRes.data)) {
      for (const p of profRes.data) emailMap[p.id] = p.email;
    }
  }

  // 3. Para cada um, envia o e-mail apropriado:
  //   past_due       → nível 3 (bot suspenso, urgente)
  //   at_risk        → nível 2 (urgente, bot ainda ativo)
  //   pending_payment→ nível 1 (boleto, lembrete amigável)
  //   canceled       → email de cancelamento (com link de reativação)
  const results = [];
  let sent = 0;
  for (const c of customers) {
    const email = emailMap[c.user_id] || null;
    if (!email) {
      results.push({ id: c.id, status: c.status, email: null, sent: false, reason: 'no_email' });
      continue;
    }
    let kind;
    if (c.status === 'canceled') kind = 'cancellation';
    else if (c.status === 'past_due') kind = 'dunning_3';
    else if (c.status === 'at_risk') kind = 'dunning_2';
    else kind = 'dunning_1';

    if (dryRun) {
      results.push({ id: c.id, status: c.status, email, kind, stripe: c.stripe_customer_id || null, sent: false, reason: 'dry_run' });
      continue;
    }
    try {
      if (kind === 'cancellation') {
        await enviarEmailCancelamento({ email });
      } else {
        const level = kind === 'dunning_3' ? 3 : kind === 'dunning_2' ? 2 : 1;
        await enviarEmailDunning({ email, attemptCount: level });
      }
      results.push({ id: c.id, status: c.status, email, kind, sent: true });
      sent++;
    } catch (err) {
      results.push({ id: c.id, status: c.status, email, kind, sent: false, reason: 'send_failed' });
    }
  }

  return json({ ok: true, dryRun, sent, totalEligible: customers.length, results }, 200, origin);
}

// ── SEND EMAIL VIA RESEND ─────────────────────────────────────────
async function enviarEmail({ to, subject, html }) {
  const key = typeof RESEND_API_KEY !== 'undefined' ? RESEND_API_KEY : '';
  if (!key) {
    console.error('[enviarEmail] RESEND_API_KEY not set — email not sent to', to);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: (typeof FROM_EMAIL !== 'undefined' && FROM_EMAIL) ? FROM_EMAIL : 'MercaBot <contato@mercabot.com.br>',
      to:   [to],
      subject,
      html,
    }),
  });
  let data;
  try { data = await res.json(); } catch (_) { data = {}; }
  if (!res.ok) {
    console.error('[enviarEmail] Resend delivery failed — status', res.status, '— name:', data?.name, '— message:', data?.message);
  } else {
    console.log('[enviarEmail] Sent OK — id:', data?.id, '— to:', to);
  }
  return data;
}

// ── STRIPE SIGNATURE VERIFICATION ────────────────────────────────
async function verifyWhatsAppSignature(rawBody, sigHeader, secret) {
  if (!secret || !sigHeader) return false;
  const expected = sigHeader.startsWith('sha256=') ? sigHeader.slice(7) : sigHeader;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === expected;
  } catch (_) {
    return false;
  }
}

async function verifyStripeSignature(payload, sigHeader, secret) {
  const encoder  = new TextEncoder();
  const parts    = sigHeader.split(',');
  const tPart    = parts.find(p => p.startsWith('t='));
  const v1Part   = parts.find(p => p.startsWith('v1='));
  if (!tPart || !v1Part) throw new Error('Missing signature components');
  const timestamp = tPart.slice(2);
  const sig       = v1Part.slice(3);

  const signedPayload = `${timestamp}.${payload}`;
  const keyData  = encoder.encode(secret);
  const msgData  = encoder.encode(signedPayload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const expectedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  if (expectedSig !== sig) throw new Error('Invalid signature');

  const tsAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (tsAge > 300) throw new Error('Timestamp too old');

  return JSON.parse(payload);
}
