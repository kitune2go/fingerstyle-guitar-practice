// Every local asset a page pulls in must also be precached by the service
// worker. Forgetting one leaves the app broken offline with no visible error,
// so this is enforced rather than remembered.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PAGES = ["index.html", "phrase.html", "rhythm.html"];

// Local script/link targets, ignoring absolute URLs and bare fragments.
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

function filesBelow(root, directory, predicate) {
  const base = path.join(root, directory);
  if (!fs.existsSync(base)) return [];
  const found = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (predicate(entry.name)) found.push(path.relative(root, target).split(path.sep).join("/"));
    }
  };
  visit(base);
  return found;
}

export function checkShell(root) {
  const errors = [];
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

  const shell = new Set(
    [...read("sw.js").matchAll(/^\s*"(\.\/[^"]*)"/gm)].map((m) => m[1].replace(/^\.\//, ""))
  );

  for (const page of PAGES) {
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

  // Anything under core/ is loaded by an ES module import, which no HTML
  // attribute reveals, so check the directory directly.
  const coreDir = path.join(root, "core");
  if (fs.existsSync(coreDir)) {
    for (const file of fs.readdirSync(coreDir).filter((f) => f.endsWith(".js"))) {
      if (!shell.has(`core/${file}`)) errors.push(`sw.js: core/${file} がAPP_SHELLにありません`);
    }
  }

  // Sample playback also happens behind module imports. Every shipped audio
  // file must be available before the app goes offline after its first visit.
  for (const file of filesBelow(root, "assets/audio", (name) => /\.(?:ogg|mp3|wav)$/i.test(name))) {
    if (!shell.has(file)) errors.push(`sw.js: 音源 ${file} がAPP_SHELLにありません`);
  }

  // Everything APP_SHELL names explicitly must exist, data files included — a
  // typo there fails the install rather than being noticed. Lesson JSON is
  // discovered from the index at install time and never listed here, so nothing
  // legitimate is missing from this check. "./" is the page, not a file.
  for (const entry of shell) {
    if (entry === "") continue;
    if (!fs.existsSync(path.join(root, entry))) {
      errors.push(`sw.js: APP_SHELL の ${entry} が存在しません`);
    }
  }

  return { errors, shellSize: shell.size };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { errors, shellSize } = checkShell(root);
  if (errors.length) {
    console.error(`アプリシェル検証に失敗しました:\n\n${errors.map((e) => `- ${e}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`アプリシェル検証成功: ${shellSize}件のプリキャッシュ対象が全て解決しました。`);
}
