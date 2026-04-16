const fs = require("fs");

// API endpoints called by the frontend — verified against the JS source files,
// not against index.html (which no longer embeds inline JS after content-hash refactor).
const frontendApis = [
  { file: "painel-cliente/app/app.js", path: "/account/summary", methods: ["GET"] },
  { file: "painel-cliente/app/app.js", path: "/account/settings", methods: ["GET", "POST"] },
  { file: "painel-cliente/app/app.js", path: "/account/workspace", methods: ["GET", "POST"] },
  { file: "painel-cliente/app/app.js", path: "/account/workspace/generate", methods: ["POST"] },
  { file: "painel-cliente/app/app.js", path: "/billing/portal", methods: ["GET", "POST"] },
  { file: "painel-cliente/app/app.js", path: "/criar-checkout-addon", methods: ["POST"] },
  { file: "painel-cliente/app/app.js", path: "/whatsapp/autoteste", methods: ["POST"] },
  { file: "painel-cliente/app/app.js", path: "/whatsapp/embedded-signup", methods: ["POST"] },
  { file: "painel-cliente/app/app.js", path: "/whatsapp/salvar-canal", methods: ["POST"] },
];

const workerRequiredRoutes = [
  { path: "/health" },
  { path: "/auth/magic-link", methods: ["POST"] },
  { path: "/auth/magic-link-preview", methods: ["POST"] },
  { path: "/account/summary", methods: ["GET"] },
  { path: "/account/settings", methods: ["GET", "POST"] },
  { path: "/account/workspace", methods: ["GET", "POST"] },
  { path: "/account/workspace/generate", methods: ["POST"] },
  { path: "/billing/portal", methods: ["GET", "POST"] },
  { path: "/whatsapp/salvar-canal", methods: ["POST"] },
  { path: "/whatsapp/embedded-signup", methods: ["POST"] },
  { path: "/whatsapp/autoteste", methods: ["POST"] },
];

// Routes expected in the future — frontend is ready, backend not yet implemented.
// Listed here so missing routes are visible but don't block CI.
const workerPendingRoutes = [];

function parseWorkerRoutes(content) {
  const routes = new Map();
  const regex = /url\.pathname\s*===\s*'([^']+)'\s*(?:&&\s*request\.method\s*===\s*'([^']+)')?/g;
  let match;

  while ((match = regex.exec(content))) {
    const routePath = match[1];
    const method = match[2] || "ANY";
    if (!routes.has(routePath)) {
      routes.set(routePath, new Set());
    }
    routes.get(routePath).add(method);
  }

  return routes;
}

function ensureFrontendReferences() {
  for (const api of frontendApis) {
    const content = fs.readFileSync(api.file, "utf8");
    const fullUrl = `https://api.mercabot.com.br${api.path}`;
    // Accept either the full hardcoded URL or just the path string
    // (some endpoints are built dynamically: API_BASE + '/path/...')
    if (!content.includes(fullUrl) && !content.includes(`'${api.path}'`) && !content.includes(`"${api.path}"`)) {
      throw new Error(`${api.file} nao referencia ${fullUrl}`);
    }
    console.log(["OK", "frontend-api", api.file, api.path].join("\t"));
  }
}

function ensureWorkerRoutes(routes) {
  for (const route of workerRequiredRoutes) {
    const methods = routes.get(route.path);
    if (!methods) {
      throw new Error(`worker sem rota obrigatoria: ${route.path}`);
    }
    if (route.methods) {
      for (const method of route.methods) {
        if (!methods.has(method)) {
          throw new Error(`worker sem metodo ${method} para ${route.path}`);
        }
      }
    }
    console.log(
      ["OK", "worker-route", route.path, `methods=${Array.from(methods).sort().join(",")}`].join("\t")
    );
  }
}

function ensureFrontendApisExistInWorker(routes) {
  for (const api of frontendApis) {
    if (api.pending) continue; // backend not yet implemented — skip cross-check
    const methods = routes.get(api.path);
    if (!methods) {
      throw new Error(`frontend usa endpoint sem rota no worker: ${api.path}`);
    }
    for (const method of api.methods) {
      if (!methods.has(method)) {
        throw new Error(`frontend exige ${method} em ${api.path}, mas worker nao expõe esse metodo`);
      }
    }
    console.log(
      ["OK", "api-contract", api.path, `methods=${api.methods.join(",")}`].join("\t")
    );
  }
}

try {
  ensureFrontendReferences();
  const workerContent = fs.readFileSync("cloudflare-worker.js", "utf8");
  const routes = parseWorkerRoutes(workerContent);
  ensureWorkerRoutes(routes);
  ensureFrontendApisExistInWorker(routes);
  // Warn about pending routes without failing
  for (const route of workerPendingRoutes) {
    const methods = routes.get(route.path);
    const status = methods ? "READY" : "PENDING";
    console.log(["WARN", "pending-route", route.path, status].join("\t"));
  }
} catch (error) {
  console.error("FAIL", error && error.message ? error.message : error);
  process.exit(1);
}
