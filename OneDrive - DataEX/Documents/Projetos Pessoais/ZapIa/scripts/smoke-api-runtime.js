const targets = [
  {
    path: "/health",
    validate(body) {
      return body && body.ok === true && typeof body.ts === "number";
    },
    description: "health ok + timestamp",
  },
  {
    path: "/checkout/readiness",
    validate(body) {
      return (
        body &&
        body.ok === true &&
        body.readiness &&
        body.readiness.pt &&
        typeof body.readiness.pt.ready === "boolean" &&
        body.readiness.es &&
        typeof body.readiness.es.ready === "boolean"
      );
    },
    description: "checkout readiness schema",
  },
];

async function fetchJson(baseUrl, path) {
  const url = new URL(path, baseUrl).toString();
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent": "mercabot-runtime-smoke",
      accept: "application/json",
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = null;
  }
  return { url, status: response.status, body, text };
}

async function main() {
  const baseUrl = process.argv[2] || "https://api.mercabot.com.br";
  let failed = false;

  for (const target of targets) {
    const result = await fetchJson(baseUrl, target.path);
    const valid = result.status === 200 && target.validate(result.body);

    if (!valid) {
      failed = true;
      console.error(
        [
          "FAIL",
          target.path,
          `status=${result.status}`,
          target.description,
          result.text.slice(0, 240),
        ].join("\t")
      );
      continue;
    }

    console.log(["OK", target.path, `status=${result.status}`, target.description].join("\t"));
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FAIL", "runtime-smoke", error && error.message ? error.message : error);
  process.exit(1);
});
