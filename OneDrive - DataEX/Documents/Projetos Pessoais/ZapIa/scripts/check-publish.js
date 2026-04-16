const fs = require("fs");
const path = require("path");

const requiredFiles = [
  "index.html",
  "login/index.html",
  "acesso/index.html",
  "cadastro/index.html",
  "demo/index.html",
  "painel-cliente/app/index.html",
  "painel-parceiro/index.html",
  "guia-parceiro/index.html",
  "_redirects",
  "_headers",
];

function readRedirectTargets() {
  const content = fs.readFileSync("_redirects", "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({ source: parts[0], target: parts[1] }));
}

function localTargetExists(target) {
  const clean = String(target || "")
    .replace(/\?.*$/, "")
    .replace(/#.*$/, "");

  if (!clean || clean.startsWith("http") || clean.includes(":splat")) {
    return true;
  }

  if (clean === "/" || clean === "/index.html") {
    return fs.existsSync("index.html");
  }

  if (clean.endsWith("/")) {
    return fs.existsSync(path.join(clean.replace(/^\//, ""), "index.html"));
  }

  const rel = clean.replace(/^\//, "");
  return (
    fs.existsSync(rel) ||
    fs.existsSync(`${rel}.html`) ||
    fs.existsSync(path.join(rel, "index.html"))
  );
}

function ensureFileOk(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Arquivo obrigatório ausente: ${file}`);
  }
  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    throw new Error(`Caminho obrigatório não é arquivo: ${file}`);
  }
  if (stat.size <= 0) {
    throw new Error(`Arquivo obrigatório vazio: ${file}`);
  }
  console.log(["OK", "file", file, `size=${stat.size}`].join("\t"));
}

function main() {
  for (const file of requiredFiles) {
    ensureFileOk(file);
  }

  const redirects = readRedirectTargets();
  const seenSources = new Map();

  for (const rule of redirects) {
    if (!localTargetExists(rule.target)) {
      throw new Error(`Redirect sem destino local válido: ${rule.source} -> ${rule.target}`);
    }
    if (seenSources.has(rule.source)) {
      throw new Error(`Redirect duplicado para a mesma origem: ${rule.source}`);
    }
    seenSources.set(rule.source, rule.target);
    console.log(["OK", "redirect", `${rule.source} -> ${rule.target}`].join("\t"));
  }
}

try {
  main();
} catch (error) {
  console.error("FAIL", error && error.message ? error.message : error);
  process.exit(1);
}
