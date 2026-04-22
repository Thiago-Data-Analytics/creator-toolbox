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

async function supabaseAdminRest(path, method = 'GET', body) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, data: { error: 'Serviço temporariamente indisponível.' } };
  }
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
  // Cartão/PIX aprovado → payment_status='paid'   → ativa imediatamente
  // Boleto gerado       → payment_status='unpaid'  → registro pendente, sem acesso à IA
  const isPaid = session.payment_status === 'paid' || session.status === 'complete';

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
    horario: sanitizeInput(cfg.horario || cfg.hr || '', 120),
    descricao: String(cfg.descricao || cfg.desc || '').trim().slice(0, 1200),
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
    notes: sanitizeInput(raw.notes || '', 1200),
    specialHours: sanitizeInput(raw.specialHours || '', 200),
    quickReplies: Array.isArray(raw.quickReplies) ? raw.quickReplies.map((item) => sanitizeInput(item || '', 220)).slice(0, 3) : [],
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
        `client_settings?id=eq.${encodeURIComponent(row.id)}`, null, 'PATCH',
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
    notes: String(payload.notes || '').trim().slice(0, 1200),
    specialHours: sanitizeInput(payload.specialHours || '', 200),
    quickReplies: Array.isArray(payload.quickReplies)
      ? payload.quickReplies.map((item) => String(item || '').trim().slice(0, 220)).filter(Boolean).slice(0, 3)
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

async function callAnthropic(apiKey, config, messages) {
  const resolvedApiKey = String(apiKey || (typeof ANTHROPIC_API_KEY !== 'undefined' ? ANTHROPIC_API_KEY : '') || '').trim();
  if (!resolvedApiKey || !resolvedApiKey.startsWith('sk-ant')) {
    return {
      ok: false,
      status: 500,
      data: JSON.stringify({ error: { message: 'IA premium indisponível no backend.' } }),
    };
  }
  const systemPrompt = buildAssistantPrompt(config);
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
        body: JSON.stringify({ model, max_tokens: 600, system: systemPrompt, messages }),
        signal: controller.signal,
      });
      const rawText = await anthropicRes.text();
      // 404 = modelo depreciado ou inexistente → tenta próximo da lista
      if (anthropicRes.status === 404) continue;
      return { ok: anthropicRes.ok, status: anthropicRes.status, data: rawText };
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
  const settingsRes = await supabaseAdminRest('client_settings?select=id,customer_id,whatsapp_display_number,api_key_masked,ai_msgs_used,ai_msgs_limit,ai_msgs_reset_at');
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

    const config = {
      ...savedConfig,
      nome: savedConfig.nome || customer.company_name || 'empresa',
      human: savedConfig.human || savedChannel.display_phone_number || row.whatsapp_display_number || customer.whatsapp_number || '',
      whatsapp_number: savedConfig.whatsapp_number || savedChannel.display_phone_number || row.whatsapp_display_number || customer.whatsapp_number || '',
    };

    return {
      customer,
      settings: row,
      apiKey,
      config,
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

  const config = {
    ...savedConfig,
    nome: savedConfig.nome || customer.company_name || 'empresa',
    human: savedConfig.human || savedChannel.display_phone_number || settings.whatsapp_display_number || customer.whatsapp_number || '',
    whatsapp_number: savedConfig.whatsapp_number || savedChannel.display_phone_number || settings.whatsapp_display_number || customer.whatsapp_number || '',
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
  }
  // Nudge de onboarding diário (10:05 UTC = 7:05 BRT — clientes que pagaram mas não configuraram)
  if (cron === '5 10 * * *' || cron === '') {
    const count = await enviarNudgesOnboarding().catch(() => 0);
    console.log(`[cron] enviarNudgesOnboarding: ${count} nudges enviados`);
  }
}

// ── ONBOARDING NUDGE — clientes ativos sem WhatsApp configurado ──────
// Busca clientes com status=active e sem whatsapp_display_number em client_settings,
// criados há 24h–72h, e envia um e-mail de incentivo para completar a configuração.
async function enviarNudgesOnboarding() {
  const now = Date.now();
  const since24h = new Date(now - 24 * 3600 * 1000).toISOString();
  const since72h = new Date(now - 72 * 3600 * 1000).toISOString();

  // Busca clientes ativos criados no intervalo 24h–72h atrás
  const res = await supabaseAdminRest(
    `customers?status=eq.active&created_at=gte.${encodeURIComponent(since72h)}&created_at=lte.${encodeURIComponent(since24h)}&select=id,email,company_name&limit=50`
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
    if (url.pathname === '/account/usage' && request.method === 'GET') {
      return await carregarUsoConta(request, origin);
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
  if (!body || typeof body !== 'object') {
    return json({ error: 'Não foi possível iniciar o acesso com os dados informados.' }, 400, origin);
  }
  const email = (body?.email || '').trim().toLowerCase().slice(0, 200);
  const redirectTo = String(body?.redirectTo || 'https://mercabot.com.br/acesso/').trim();
  const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

  if (checkRateLimit(clientIP, 'magic-link', 4, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde um instante e tente novamente.' }, 429, origin);
  }

  if (!validateEmail(email)) {
    return json({ error: 'Não foi possível iniciar o acesso com os dados informados.' }, 400, origin);
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
    return json({ error: 'Se o endereço informado puder receber acesso, enviaremos o link em instantes.' }, 200, origin);
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
    return json({ error: 'Não foi possível gerar o preview do link.', details: generateRes.data }, 500, origin);
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

function buildMercabotSalesPrompt(cfg) {
  const human = sanitizeInput(cfg.human || cfg.whatsapp || cfg.whatsapp_number || '', 120);
  const humanLine = human
    ? `se o lead quiser falar com um humano da equipe MercaBot, informe que pode encaminhar para ${human}`
    : 'se o lead quiser falar com um humano, informe que a equipe entrará em contato em breve';

  return `Voce e o assistente de vendas da MercaBot — a plataforma que transforma o WhatsApp em um canal de atendimento e vendas com IA. Esta conversa e, ela mesma, a demonstracao ao vivo da tecnologia MercaBot: seja a prova do que vende. Cada resposta sua mostra ao lead o que os clientes dele vao receber.

MISSAO: qualificar o lead, entender o contexto e recomendar o plano certo com clareza e objetividade. Nao empurrar — convencer com informacao relevante e exemplos concretos.

---PRODUTO---
A MercaBot conecta um chatbot de IA ao WhatsApp Business API oficial (Meta). O bot atende, qualifica leads, responde perguntas frequentes, faz follow-up automatico e entrega o contato certo para o humano na hora certa — sem precisar de equipe tecnica.
- Canal: WhatsApp Business API oficial (numero verificado pela Meta)
- Aparencia: o bot responde com o nome e foto da empresa — o cliente nao ve indicacao de "bot"
- Ativacao: guiada pelo painel, aproximadamente 30 minutos, sem TI
- Seguranca: dados criptografados, conformidade com LGPD/GDPR
- Site: mercabot.com.br | Cadastro: mercabot.com.br/cadastro

---PLANOS E PRECOS---
STARTER — R$ 197/mes | USD 49/mes
- 1.000 mensagens de IA por mes
- 1 numero WhatsApp
- Chatbot IA + qualificacao de leads + atendimento 24h + painel completo + horario comercial + handoff humano
- Ideal para: autonomos, profissionais liberais, pequenos negocios que querem comecar

PRO — R$ 497/mes | USD 119/mes
- 4.000 mensagens de IA por mes
- 1 numero WhatsApp
- Tudo do Starter + follow-up automatico + qualificacao avancada de leads
- Ideal para: PMEs com volume comercial ativo, equipes de vendas, clinicas, imobiliarias

PARCEIRO — R$ 1.297/mes | USD 279/mes
- 15.000 mensagens de IA por mes
- Multiplos numeros e clientes
- Tudo do Pro + white-label (marca propria) + gestao multi-cliente + acesso a rede de parceiros MercaBot
- Ideal para: agencias, consultores, implantadores, operacao multi-cliente

PLANOS ANUAIS: 10x o valor mensal (equivale a 2 meses gratis)

ADD-ON DE MENSAGENS (compra avulsa quando precisar de mais):
+1.000 msgs -> R$ 47 | +5.000 msgs -> R$ 235 | +10.000 msgs -> R$ 470

---PERGUNTAS FREQUENTES---
P: Preciso de um numero novo?
R: Nao obrigatoriamente. Voce pode migrar seu WhatsApp Business atual para a API oficial da Meta. Se preferir, pode ativar um numero novo. O processo e guiado no painel.

P: O cliente vai saber que e um bot?
R: Nao. O bot responde com o nome e a foto da sua empresa, como qualquer atendente. Nenhuma indicacao visual de "bot" aparece para o cliente.

P: Quanto tempo leva para ativar?
R: Cerca de 30 minutos. O painel guia passo a passo: conectar o numero via Meta, configurar o bot, testar. Sem precisar de equipe tecnica.

P: O que conta como mensagem de IA?
R: Cada resposta gerada pelo bot para um cliente conta como 1 mensagem. Mensagens enviadas manualmente por voce nao contam.

P: O que acontece quando as mensagens acabam?
R: O bot pausa automaticamente. Voce recebe alerta em 80% e 100% do limite. Pode comprar add-on (+1K msgs por R$ 47) diretamente no painel, sem mudar de plano.

P: Posso cancelar quando quiser?
R: Sim. Sem fidelidade obrigatoria nos planos mensais. Cancela pelo proprio painel.

P: Funciona com meu CRM ou sistema?
R: Sim, via webhook e API REST. A integracao requer configuracao tecnica pontual, mas funciona com qualquer sistema que aceite HTTP.

P: Posso usar com minha marca (white-label)?
R: Sim, no plano Parceiro. O bot responde com a marca do cliente, voce gerencia pelo painel centralizado.

P: Quais segmentos usam mais a MercaBot?
R: Clinicas, imobiliarias, lojas, academias, escritorios de contabilidade, agencias e consultores. Qualquer negocio que atende pelo WhatsApp se beneficia.

P: Como e o suporte da MercaBot?
R: Via WhatsApp (este canal) e central digital em mercabot.com.br/suporte.

P: Posso testar antes de assinar?
R: Voce pode criar conta em mercabot.com.br/cadastro e avaliar o painel. Fale com a equipe comercial para avaliar opcao de demonstracao guiada.

P: Tem aplicativo?
R: O painel e web (mercabot.com.br/painel-cliente), acessivel por qualquer dispositivo. Nao ha app separado, mas funciona perfeitamente pelo celular.

---QUALIFICACAO DO LEAD---
Antes de recomendar um plano, entenda rapidamente:
1. Segmento e tamanho do negocio (autonomo, PME, agencia?)
2. Volume estimado de conversas por mes no WhatsApp
3. Ja usa WhatsApp Business API ou ainda usa numero comum?
4. Quer para uso proprio ou para revender / operar com white-label?
5. Tem equipe de atendimento ou opera solo?

Com essas respostas, recomende o plano com justificativa clara e direta.

---COMPORTAMENTO---
SEMPRE:
- Responda no idioma do lead (portugues, espanhol ou ingles — detecte pela mensagem dele)
- Seja consultivo: entenda o problema antes de recomendar
- Use exemplos do segmento do lead quando possivel (ex: "Para uma clinica com 200 pacientes por mes...")
- Indique o proximo passo claro: mercabot.com.br/cadastro para comecar, ou responda mais duvidas
- ${humanLine}
- Mantenha respostas objetivas e bem estruturadas — sem blocos de texto longos e densos

NUNCA:
- Inventar funcionalidade, integracao ou prazo que nao existe
- Empurrar o plano mais caro sem justificativa baseada no perfil do lead
- Usar jargao tecnico desnecessario
- Continuar insistindo apos o lead demonstrar desinteresse claro
- Mencionar "Claude", "Anthropic" ou detalhes tecnicos do modelo — se perguntado, diga apenas "usamos IA de ultima geracao"
- Quebrar o personagem: voce e a MercaBot, nao um assistente generico

LEMBRE-SE: esta conversa e a vitrine da MercaBot. Cada resposta demonstra ao vivo o que a plataforma entrega. Seja preciso, humano e util.`;
}

function buildAssistantPrompt(config) {
  const cfg = config || {};
  const businessName = sanitizeInput(cfg.nome || cfg.company_name || 'empresa', 120);
  const segment = sanitizeInput(cfg.segmento || cfg.seg || 'atendimento comercial', 120);
  const city = sanitizeInput(cfg.cidade || '', 120);
  const businessHours = sanitizeInput(cfg.horario || cfg.hr || '', 120);
  const description = String(cfg.descricao || cfg.desc || '').slice(0, 1200);
  const whatsappNum = String(cfg.whatsapp_number || cfg.human || '').replace(/\D/g, '');
  const isMercabotSalesNumber = whatsappNum === '5531998219149' || whatsappNum === '31998219149';
  const useMercabotSalesFallback = !cfg.faq && !cfg.deve && !cfg.nunca &&
    (isMercabotSalesNumber || String(businessName || '').toLowerCase().includes('mercabot'));
  if (useMercabotSalesFallback) return buildMercabotSalesPrompt(cfg);
  const faq = String(cfg.faq || '').slice(0, 2400);
  const alwaysDo = String(cfg.deve || '').slice(0, 1800);
  const neverDo = String(cfg.nunca || '').slice(0, 1800);
  const human = sanitizeInput(cfg.human || cfg.whatsapp || cfg.whatsapp_number || '', 120);
  const tone = sanitizeInput(cfg.tom || 'amigavel', 80);

  return `Voce e um atendente virtual natural, claro e objetivo da empresa ${businessName}.

NEGOCIO:
- Nome: ${businessName}
- Segmento: ${segment}${city ? `\n- Cidade: ${city}` : ''}${businessHours ? `\n- Horario: ${businessHours}` : ''}
${description ? `- Sobre: ${description}` : ''}

ORIENTACOES:
${faq ? `- Perguntas frequentes e respostas corretas:\n${faq}\n` : ''}${alwaysDo ? `- Sempre faca:\n${alwaysDo}\n` : ''}${neverDo ? `- Nunca faca:\n${neverDo}\n` : ''}${human ? `- Se precisar devolver a conversa para a equipe da empresa, informe que pode encaminhar para: ${human}\n` : ''}
- Tom de voz: ${tone}
- Responda em portugues do Brasil
- Seja natural, claro e direto
- Nao invente informacao
- Se faltar informacao, diga que precisa confirmar
- Nao mencione modelo, IA, Anthropic ou detalhes tecnicos`;
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
  // Garante entrega de mensagens sem que o usuário (ou suporte) precise
  // fazer isso manualmente no Graph API Explorer.
  if (nextChannel.phone_number_id && nextChannel.access_token_cipher && nextChannel.waba_id) {
    try {
      const rawToken = await decryptSecret(nextChannel.access_token_cipher).catch(() => '');
      if (rawToken) {
        await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(nextChannel.waba_id)}/subscribed_apps`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${rawToken}` },
        });
      }
    } catch (_) {}
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
  }, 200, origin);
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

  // 5. Subscribe our app to WABA webhook (best-effort)
  try {
    await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (_) {}

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

  const readiness = {
    anthropic: !!(runtime.apiKey && runtime.apiKey.startsWith('sk-ant')),
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

  const company = runtime.customer.company_name || runtime.config.nome || 'empresa';
  const anthropicResult = await callAnthropic(runtime.apiKey, runtime.config, [
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
    'success_url':                   'https://mercabot.com.br/painel-cliente/app/?addon=success',
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

  // Build FAQ string from array [{q, a}] — exige pergunta E resposta não-vazias
  const faqArr = Array.isArray(body.faq) ? body.faq.slice(0, 5) : [];
  const faqText = faqArr
    .filter(item => item && String(item.q || '').trim() && String(item.a || '').trim())
    .map((item, i) => `P${i + 1}: ${String(item.q || '').trim()}\nR${i + 1}: ${String(item.a || '').trim()}`)
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
    const nextWorkspace = {
      ...existingWorkspace,
      responsavel: responsavel || existingWorkspace.responsavel || '',
      onboarded_at: new Date().toISOString(),
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
  const nomeDisplay = empresa || responsavel || 'usuário';
  const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#080c09;color:#eaf2eb;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<div style="font-size:1.4rem;font-weight:700;margin-bottom:32px">Merca<span style="color:#00e676">Bot</span></div>
<h1 style="font-size:1.3rem;margin-bottom:12px">Configuração salva com sucesso ✅</h1>
<p style="color:rgba(234,242,235,.75);font-size:.95rem;line-height:1.7">Olá${empresa ? ', ' + empresa : ''}! Recebemos todas as informações do seu negócio. A MercaBot já está configurando o atendimento no seu WhatsApp.</p>
<p style="color:rgba(234,242,235,.65);font-size:.9rem;line-height:1.7">Em breve você receberá o acesso ao painel para acompanhar as conversas e ajustar o bot quando quiser.</p>
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
        const runtimeApiKey = String(runtime.apiKey || (typeof ANTHROPIC_API_KEY !== 'undefined' ? ANTHROPIC_API_KEY : '') || '').trim();
        if (!runtimeApiKey || !runtimeApiKey.startsWith('sk-ant')) continue;

        // ── GUARDIÃO DE COTA ────────────────────────────────────────
        let quota = { allowed: true };
        try {
          quota = await checkAndIncrementAiQuota(
            runtime.settings?.id,
            runtime.customer?.plan_code || 'starter'
          );
        } catch (_) {}

        if (!quota.allowed) {
          // Cota esgotada — avisa o contato final de forma amigável e passa para humano
          try {
            const planLabel = getPlanDefinition(runtime.customer?.plan_code || 'starter').label;
            await sendWhatsAppText(
              runtime.phoneNumberId || phoneNumberId,
              from,
              'Olá! No momento o atendimento automático está temporariamente indisponível. Em breve um de nossos atendentes entrará em contato. Pedimos desculpas pelo inconveniente!',
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
            await sendWhatsAppText(
              runtime.phoneNumberId || phoneNumberId,
              from,
              'Recebi sua mensagem. Neste momento, o atendimento automático está pronto para responder melhor a mensagens de texto. Se preferir, envie sua dúvida em texto ou peça retorno da equipe da empresa.',
              runtime.accessToken
            );
          } catch (_) {}
          continue;
        }

        try {
          const anthropicResult = await callAnthropic(runtimeApiKey, runtime.config, [
            { role: 'user', content: inboundText.slice(0, 4000) },
          ]);

          if (!anthropicResult.ok) continue;

          let parsed = {};
          try { parsed = anthropicResult.data ? JSON.parse(anthropicResult.data) : {}; } catch (_) {}
          const reply = String(parsed?.content?.[0]?.text || '').trim();
          if (!reply) continue;

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
  // Rate limiting
  const clientIP = getClientIp(request);
  if (checkRateLimit(clientIP, 'checkout', 5, 60_000)) {
    return json({ error: 'Muitas tentativas. Aguarde 1 minuto e tente novamente.' }, 429, origin);
  }

  const body = await getJsonBody(request);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Plano inválido ou email ausente' }, 400, origin);
  }
  const raw = body || {};
  const nome     = sanitizeInput(raw.nome,     100);
  const empresa  = sanitizeInput(raw.empresa,  100);
  const email    = (raw.email || '').trim().toLowerCase().slice(0, 200);
  const whats    = sanitizeInput(raw.whats,     30);
  const plano    = sanitizeInput(raw.plano,     20);
  const planName = sanitizeInput(raw.planName,  50);
  const lang     = String(raw.lang || '').trim().toLowerCase() === 'es' ? 'es' : 'pt';

  // Validate email
  if (!validateEmail(email)) {
    return json({ error: 'Email inválido.' }, 400, origin);
  }
  if (!whats) {
    return json({ error: 'Informe o número oficial da empresa para continuar.' }, 400, origin);
  }
  if (!validatePhone(whats)) {
    return json({ error: 'Número de WhatsApp inválido.' }, 400, origin);
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
    starter:         String(STRIPE_PRICE_STARTER_USD || ''),
    pro:             String(STRIPE_PRICE_PRO_USD || ''),
    parceiro:        String(STRIPE_PRICE_PARCEIRO_USD || ''),
    starter_anual:   String(STRIPE_PRICE_STARTER_ANUAL_USD || ''),
    pro_anual:       String(STRIPE_PRICE_PRO_ANUAL_USD || ''),
    parceiro_anual:  String(STRIPE_PRICE_PARCEIRO_ANUAL_USD || ''),
  };
  const isSpanishCheckout = lang === 'es';
  const priceMap = isSpanishCheckout ? PRICE_MAP_USD : PRICE_MAP_BRL;
  const priceId = priceMap[plano];

  if (!email || !priceId) {
    const localizedError = isSpanishCheckout
      ? 'El checkout en español aún no está configurado completamente en Stripe. Configure los price IDs USD para continuar.'
      : 'Plano inválido ou email ausente';
    return json({ error: localizedError }, 400, origin);
  }

  const cancelBase = isSpanishCheckout ? 'https://mercabot.com.br/cadastro/?lang=es' : 'https://mercabot.com.br/cadastro/';
  const successBase = 'https://mercabot.com.br/ativacao/';
  const stripeLocale = isSpanishCheckout ? 'es-419' : 'pt-BR';

  // Build Stripe Checkout Session
  const params = new URLSearchParams({
    'mode':                              'subscription',
    'customer_email':                    email,
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
      const isPaid   = session.payment_status === 'paid' || session.status === 'complete';

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

      if (email) {
        await ensureCustomerSeedFromCheckout(session);

        if (isPaid) {
          await enviarEmailBoasVindas({ email, nome, empresa, planName, plano });
          if (normalizePlanCode(plano) === 'parceiro') {
            await enviarEmailParceiro({ email, nome, empresa });
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
          await enviarEmailBoasVindas({ email, nome, empresa, planName: planDef.label, plano: resolvedPlan });
          if (resolvedPlan === 'parceiro') {
            await enviarEmailParceiro({ email, nome, empresa });
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
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d120e;color:#e8f0e9;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1a2e1c,#0d120e);padding:32px 32px 24px;border-bottom:1px solid rgba(0,230,118,.15)">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#00e676;margin-bottom:8px">MercaBot</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3">Seu boleto foi gerado!</h1>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;color:#9ab09c;line-height:1.7">Olá, <strong style="color:#e8f0e9">${primeiroNome}</strong>!</p>
      <p style="margin:0 0 16px;line-height:1.7">Recebemos seu pedido do plano <strong>${planName || plano}</strong>. O boleto bancário foi gerado com sucesso.</p>
      <div style="background:rgba(0,230,118,.07);border:1px solid rgba(0,230,118,.2);border-radius:12px;padding:16px 20px;margin:20px 0">
        <p style="margin:0 0 8px;font-weight:700;color:#00e676">Próximos passos:</p>
        <ol style="margin:0;padding-left:1.2rem;color:#9ab09c;line-height:1.9;font-size:.95rem">
          <li>Pague o boleto em qualquer banco, lotérica ou app bancário</li>
          <li>O pagamento é confirmado em até <strong style="color:#e8f0e9">1–3 dias úteis</strong></li>
          <li>Assim que confirmado, seu acesso ao MercaBot será liberado automaticamente</li>
          <li>Você receberá um e-mail de boas-vindas com as instruções de acesso</li>
        </ol>
      </div>
      <p style="margin:0 0 16px;font-size:.92rem;color:#9ab09c;line-height:1.7">O link do boleto está disponível no e-mail de confirmação do Stripe. Caso precise de ajuda, entre em contato em <a href="mailto:contato@mercabot.com.br" style="color:#00e676">contato@mercabot.com.br</a>.</p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid rgba(234,242,235,.07);font-size:12px;color:#5a7060">MercaBot — atendimento automático para o seu WhatsApp Business</div>
  </div>`;
  return enviarEmail({
    to: email,
    subject: `Boleto gerado — plano ${planName || plano} MercaBot`,
    html,
  });
}

async function enviarEmailBoasVindas({ email, nome, empresa, planName, plano }) {
  const primeiroNome = nome ? nome.split(' ')[0] : 'cliente';
  const links = {
    starter:  'https://mercabot.com.br/painel-cliente/app/',
    pro:      'https://mercabot.com.br/painel-cliente/app/',
    parceiro: 'https://mercabot.com.br/painel-parceiro',
  };
  const botLink = links[plano] || links.pro;

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
<h1>Bem-vindo, ${primeiroNome}! 🎉</h1>
<p>Sua conta MercaBot foi ativada com sucesso. Você está no plano <strong style="color:#00e676">${planName}</strong> e já pode concluir a ativação guiada do atendimento.</p>

<div class="step-box"><div class="step-num">Passo 1 — 5 min</div><div class="step-title">Entrar no seu painel</div><div class="step-desc">Abra o painel da sua conta para seguir a ativação guiada do atendimento.</div></div>
<div class="step-box"><div class="step-num">Passo 2 — 10-20 min</div><div class="step-title">Informar o número oficial da empresa</div><div class="step-desc">Cadastre o número que sua empresa já usa com os clientes. Os detalhes técnicos podem ser concluídos depois com ajuda guiada.</div></div>
<div class="step-box"><div class="step-num">Passo 3 — 15 min</div><div class="step-title">Personalizar e fazer o primeiro teste</div><div class="step-desc">Revise as informações do negócio, faça um teste real e só então divulgue o atendimento para clientes.</div></div>

<div style="margin:24px 0">
  <a href="${botLink}" class="btn">Abrir painel →</a>
          <a href="https://mercabot.com.br/suporte/" class="btn" style="background:transparent;border:1px solid rgba(0,230,118,.3);color:#00e676">Ver passo a passo</a>
</div>

          <p>Dúvidas? Acesse a <a href="https://mercabot.com.br/suporte/" style="color:#00e676">central de ajuda</a> para o próximo passo.</p>

<div class="footer">
  MercaBot Tecnologia Ltda. · contato@mercabot.com.br<br>
  Você está recebendo este email porque criou uma conta em mercabot.com.br.<br>
              <a href="https://mercabot.com.br/privacidade/" style="color:rgba(234,242,235,.3)">Política de Privacidade</a>
</div>
</div></body></html>`;

  return await enviarEmail({
    to: email,
    subject: `✅ Conta ativada — siga pela ativação guiada | MercaBot`,
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
<h1>Painel do Parceiro liberado, ${primeiroNome}!</h1>
  <p>Seu acesso ao painel multi-cliente está pronto. Aqui você gerencia clientes, configura white-label e centraliza os recursos digitais da sua operação.</p>
<p><strong style="color:#00e676">Próximos passos:</strong></p>
<p>1. Acesse o painel com o e-mail e senha que você criou<br>
2. Configure seu white-label (nome + cor da sua marca)<br>
3. Leia o Guia do Parceiro — tem tudo sobre captação, precificação e onboarding</p>
<div style="margin:24px 0">
          <a href="https://mercabot.com.br/painel-parceiro" class="btn">Acessar painel →</a>
          <a href="https://mercabot.com.br/guia-parceiro" class="btn" style="background:transparent;border:1px solid rgba(0,230,118,.3);color:#00e676">Guia do Parceiro</a>
</div>
<p>Seu próximo passo agora é abrir o Guia do Parceiro e seguir o onboarding digital dentro da própria plataforma.</p>
<div class="footer">MercaBot Tecnologia Ltda. · contato@mercabot.com.br</div>
</div></body></html>`;

  return await enviarEmail({ to: email, subject: '🤝 Painel Parceiro MercaBot ativado — próximos passos', html });
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

// ── SEND EMAIL VIA RESEND ─────────────────────────────────────────
async function enviarEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('Email backend unavailable — message not sent');
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL || 'MercaBot <contato@mercabot.com.br>',
      to:   [to],
      subject,
      html,
    }),
  });
  const data = await res.json();
  if (!res.ok) console.error('Email delivery error — check Resend dashboard');
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
