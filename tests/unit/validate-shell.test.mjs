import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkShell } from "../../scripts/validate-shell.mjs";

// Builds a minimal repo whose only interesting part is the shell wiring.
function fixture({ shell, files = [], core = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shell-"));
  fs.writeFileSync(
    path.join(root, "sw.js"),
    `const APP_SHELL = [\n${shell.map((e) => `  "${e}"`).join(",\n")}\n];\n`
  );
  // Touch the plain files first; the pages and manifest below then overwrite
  // their placeholders with real content.
  for (const file of files) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "");
  }
  const page = (extra) =>
    `<link rel="manifest" href="manifest.json">\n<link rel="stylesheet" href="app.css">\n${extra}`;
  fs.writeFileSync(path.join(root, "index.html"), page('<script src="app.js"></script>'));
  fs.writeFileSync(path.join(root, "phrase.html"), page(""));
  fs.writeFileSync(path.join(root, "rhythm.html"), page(""));
  fs.writeFileSync(
    path.join(root, "manifest.json"),
    JSON.stringify({ icons: [{ src: "icon.svg" }] })
  );
  if (core.length) {
    fs.mkdirSync(path.join(root, "core"), { recursive: true });
    for (const file of core) fs.writeFileSync(path.join(root, "core", file), "");
  }
  return root;
}

const COMPLETE = [
  "./index.html", "./phrase.html", "./rhythm.html",
  "./manifest.json", "./icon.svg", "./app.css", "./app.js", "./data/phrases.json"
];
const PRESENT = [
  "index.html", "phrase.html", "rhythm.html",
  "manifest.json", "icon.svg", "app.css", "app.js", "data/phrases.json"
];

test("a complete shell passes", () => {
  const { errors } = checkShell(fixture({ shell: COMPLETE, files: PRESENT }));
  assert.deepEqual(errors, []);
});

test("a script a page loads but the shell omits is reported", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE.filter((e) => e !== "./app.js"),
    files: PRESENT
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /app\.js/);
});

test("a manifest icon the shell omits is reported", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE.filter((e) => e !== "./icon.svg"),
    files: PRESENT
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /icon\.svg/);
});

// The reverse direction: the shell naming something that is not there. Data
// paths used to be skipped here, so a typo in one shipped silently.
test("a shell entry pointing at a missing file is reported, data paths included", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./data/typo.json"],
    files: PRESENT
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /data\/typo\.json/);
});

test("a core module missing from the shell is reported", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE, files: PRESENT, core: ["music.js", "clock.js"]
  }));
  assert.equal(errors.length, 2);
  assert.match(errors.join(" "), /core\/music\.js/);
  assert.match(errors.join(" "), /core\/clock\.js/);
});

test("core modules present in the shell pass", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./core/music.js"], files: PRESENT, core: ["music.js"]
  }));
  assert.deepEqual(errors, []);
});
