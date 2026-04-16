const fs = require("fs");

// Each contract specifies a file and a list of strings that MUST be present.
// Keep these checks stable: prefer IDs, constant names and base filenames
// rather than full hashed paths (hashes rotate on every build).
const contracts = [
  {
    file: "login/index.html",
    checks: [
      'id="authEmail"',
      'id="authBtn"',
      'id="authOtp"',
      'id="otpBtn"',
      "login.",          // matches login.{hash}.min.js
      "/vendor/supabase.js",
      "/vendor/auth-utils.",
      "/vendor/sentry.",
    ],
  },
  {
    file: "acesso/index.html",
    checks: [
      'id="accessEmail"',
      'id="accessOtp"',
      'id="accessOtpBtn"',
      'id="primaryAction"',
      "access.",         // matches access.{hash}.min.js
      "/vendor/supabase.js",
      "/vendor/auth-utils.",
      "/vendor/sentry.",
    ],
  },
  {
    file: "painel-cliente/app/index.html",
    checks: [
      'id="authEmail"',
      'id="authBtn"',
      'id="quickstartCard"',
      'id="setupActionBtn"',
      'id="setupSecondaryBtn"',
      'id="billingBtn"',
      'id="cancelBtn"',
      'id="channelActionBtn"',
      'id="opNotes"',
      'id="quickReply1"',
      'id="businessProfileCard"',
      "/vendor/config.js",
      "/vendor/supabase.js",
      "/vendor/auth-utils.",
      "/vendor/sentry.",
      "painel-cliente/app/app.",
    ],
  },
  {
    file: "painel-parceiro/index.html",
    checks: [
      'id="app"',
      'id="clientsTable"',
      "/vendor/config.js",
      "/vendor/sentry.",
      "painel-parceiro/app.",
    ],
  },
  {
    file: "demo/index.html",
    checks: [
      'id="app"',
      "/vendor/config.js",
      "/vendor/sentry.",
      "/vendor/supabase.js",
      "/assets/demo.",
    ],
  },
  {
    file: "assets/login.js",
    checks: [
      "SUPABASE_URL",
      "__mbAuth",
      "signInWithOtp",
      "verifyOtpCode",
      "getSession",
      "getUser",
    ],
  },
  {
    file: "assets/access.js",
    checks: [
      "SUPABASE_URL",
      "__mbAuth",
      "verifyOtpCode",
      "exchangeCodeForSession",
      "getSession",
      "resolveDestination",
    ],
  },
  {
    file: "vendor/auth-utils.js",
    checks: [
      "window.__mbAuth",
      "__mbConfig",
      "validateEmail",
      "normalizeOtp",
      "verifyOtpCode",
      "resolveDestination",
      "/rest/v1/profiles",
      "/rest/v1/customers",
    ],
  },
  {
    file: "painel-cliente/app/app.js",
    checks: [
      "ACCOUNT_SUMMARY_URL",
      "ACCOUNT_SETTINGS_URL",
      "ACCOUNT_WORKSPACE_URL",
      "BILLING_PORTAL_URL",
      "WHATSAPP_CHANNEL_SAVE_URL",
      "WHATSAPP_CHANNEL_SELF_TEST_URL",
      "EMBEDDED_SIGNUP_URL",
      "META_APP_ID",
      "META_CONFIG_ID",
      "_apiCircuit",
      "bpHydrate",
      "bpBindEvents",
      "BP_SEGMENTS",
    ],
  },
];

function main() {
  for (const contract of contracts) {
    const content = fs.readFileSync(contract.file, "utf8");
    const missing = contract.checks.filter((check) => !content.includes(check));
    if (missing.length) {
      throw new Error(
        `${contract.file} sem contratos obrigatorios: ${missing.join(", ")}`
      );
    }
    console.log(
      ["OK", contract.file, `checks=${contract.checks.length}`].join("\t")
    );
  }
}

try {
  main();
} catch (error) {
  console.error("FAIL", error && error.message ? error.message : error);
  process.exit(1);
}
