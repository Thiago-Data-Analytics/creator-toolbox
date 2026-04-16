const targets = [
  {
    path: "/",
    checks: ["WhatsApp", "IA real", "claude-diff", "Ativar meu WhatsApp"],
  },
  {
    path: "/login/",
    checks: ["Codigo de acesso", "Enviar link de acesso"],
  },
  {
    path: "/acesso/",
    checks: ["Validando seu acesso", "Entrar com codigo"],
  },
  {
    path: "/cadastro/",
    checks: ["MercaBot", "Plano"],
  },
  {
    path: "/demo/",
    checks: ["Configuracao guiada do atendimento com IA", "Teste guiado"],
  },
  {
    path: "/painel-cliente/app/",
    checks: ["Seu proximo passo esta aqui", "Gerenciar pagamento"],
  },
  {
    path: "/painel-parceiro/",
    checks: ["Painel Parceiro", "Guia do Parceiro"],
  },
  {
    path: "/guia-parceiro/",
    checks: ["Guia do Parceiro", "O programa Parceiro"],
  },
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(baseUrl, path) {
  const url = new URL(path, baseUrl).toString();
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "mercabot-smoke-test",
    },
  });
  const text = await response.text();
  return { url, status: response.status, text };
}

async function main() {
  const baseUrl = process.argv[2] || "https://mercabot.com.br";
  let failed = false;

  for (const target of targets) {
    const result = await fetchText(baseUrl, target.path);
    const text = normalizeText(result.text);
    const missing = target.checks.filter((check) => !text.includes(normalizeText(check)));

    if (result.status !== 200 || missing.length) {
      failed = true;
      console.error(
        [
          "FAIL",
          target.path,
          `status=${result.status}`,
          missing.length ? `missing=${missing.join(" | ")}` : "",
        ]
          .filter(Boolean)
          .join("\t")
      );
      continue;
    }

    console.log(["OK", target.path, `status=${result.status}`].join("\t"));
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FAIL", "smoke-run", error && error.message ? error.message : error);
  process.exit(1);
});
