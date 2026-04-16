const fs = require("fs");

function parseLocs(xml) {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1].trim());
}

function parseLastmods(xml) {
  return [...xml.matchAll(/<lastmod>(.*?)<\/lastmod>/g)].map((match) => match[1].trim());
}

async function verifyUrl(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent": "mercabot-sitemap-check",
    },
  });
  return response.status;
}

async function main() {
  const xml = fs.readFileSync("sitemap.xml", "utf8");

  if (!xml.includes("<urlset")) {
    throw new Error("sitemap.xml sem <urlset>");
  }

  const locs = parseLocs(xml);
  const lastmods = parseLastmods(xml);

  if (!locs.length) {
    throw new Error("sitemap.xml sem URLs");
  }

  if (new Set(locs).size !== locs.length) {
    throw new Error("sitemap.xml contem URLs duplicadas");
  }

  if (lastmods.length !== locs.length) {
    throw new Error("Quantidade de <lastmod> difere da quantidade de <loc>");
  }

  for (const value of lastmods) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`lastmod invalido: ${value}`);
    }
  }

  for (const loc of locs) {
    const status = await verifyUrl(loc);
    if (status !== 200) {
      throw new Error(`URL do sitemap nao responde 200: ${loc} (status ${status})`);
    }
    console.log(["OK", loc, `status=${status}`].join("\t"));
  }
}

main().catch((error) => {
  console.error("FAIL", error && error.message ? error.message : error);
  process.exit(1);
});
