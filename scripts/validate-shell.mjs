// Every local asset a page pulls in must also be precached by the service
// worker. Forgetting one leaves the app broken offline with no visible error,
// so this is enforced rather than remembered.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["index.html", "phrase.html", "rhythm.html"];
const errors = [];

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const shell = new Set(
  [...read("sw.js").matchAll(/^\s*"(\.\/[^"]*)"/gm)].map((m) => m[1].replace(/^\.\//, ""))
);

// Local script/link/img targets, ignoring absolute URLs and bare fragments.
function referencesIn(html) {
  const found = new Set();
  for (const attr of [/<script[^>]+src="([^"]+)"/g, /<link[^>]+href="([^"]+)"/g]) {
    for (const match of html.matchAll(attr)) {
      const value = match[1];
      if (/^(https?:)?\/\/|^data:|^#|^mailto:/.test(value)) continue;
      found.add(value.replace(/^\.\//, ""));
    }
  }
  return found;
}

for (const page of pages) {
  if (!shell.has(page)) errors.push(`sw.js: ページ ${page} がAPP_SHELLにありません`);
  for (const ref of referencesIn(read(page))) {
    if (!shell.has(ref)) errors.push(`sw.js: ${page} が読み込む ${ref} がAPP_SHELLにありません`);
  }
}

// Icons declared in the manifest are fetched by the browser, not by a page.
for (const icon of JSON.parse(read("manifest.json")).icons ?? []) {
  const src = String(icon.src).replace(/^\.\//, "");
  if (!shell.has(src)) errors.push(`sw.js: manifest のアイコン ${src} がAPP_SHELLにありません`);
}

// Anything under core/ is loaded by an ES module import, which no HTML attribute
// reveals, so check the directory directly.
const coreDir = path.join(root, "core");
if (fs.existsSync(coreDir)) {
  for (const file of fs.readdirSync(coreDir).filter((f) => f.endsWith(".js"))) {
    if (!shell.has(`core/${file}`)) errors.push(`sw.js: core/${file} がAPP_SHELLにありません`);
  }
}

for (const entry of shell) {
  if (entry === "" || entry.startsWith("data/")) continue;
  if (!fs.existsSync(path.join(root, entry))) {
    errors.push(`sw.js: APP_SHELL の ${entry} が存在しません`);
  }
}

if (errors.length) {
  console.error(`アプリシェル検証に失敗しました:\n\n${errors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}
console.log(`アプリシェル検証成功: ${shell.size}件のプリキャッシュ対象が全て解決しました。`);
