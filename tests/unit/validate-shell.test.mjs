import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkShell } from "../../scripts/validate-shell.mjs";

// Builds a minimal repo whose only interesting part is the shell wiring.
function fixture({ shell, files = [], core = [], rhythm = [], audio = [], html = "", css = "", appJs = "" }) {
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
  fs.writeFileSync(path.join(root, "index.html"), page(`<script src="app.js"></script>${html}`));
  fs.writeFileSync(path.join(root, "phrase.html"), page(""));
  fs.writeFileSync(path.join(root, "rhythm.html"), page(""));
  fs.writeFileSync(path.join(root, "app.css"), css);
  fs.writeFileSync(path.join(root, "app.js"), appJs);
  fs.writeFileSync(
    path.join(root, "manifest.json"),
    JSON.stringify({ icons: [{ src: "icon.svg" }] })
  );
  if (core.length) {
    fs.mkdirSync(path.join(root, "core"), { recursive: true });
    for (const entry of core) {
      const file = typeof entry === "string" ? entry : entry.path;
      const target = path.join(root, "core", file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof entry === "string" ? "" : entry.content ?? "");
    }
  }
  if (rhythm.length) {
    fs.mkdirSync(path.join(root, "rhythm"), { recursive: true });
    for (const entry of rhythm) {
      const file = typeof entry === "string" ? entry : entry.path;
      const target = path.join(root, "rhythm", file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof entry === "string" ? "" : entry.content ?? "");
    }
  }
  for (const file of audio) {
    const target = path.join(root, "assets/audio", file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "sample");
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

test("an image a page loads but the shell omits is reported", () => {
  const image = "images/example.png";
  const { errors } = checkShell(fixture({
    shell: COMPLETE,
    files: [...PRESENT, image],
    html: `<img src='./${image}' alt="">`
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /images\/example\.png/);
});

test("an asset a stylesheet loads but the shell omits is reported", () => {
  const font = "fonts/practice.woff2";
  const { errors } = checkShell(fixture({
    shell: COMPLETE,
    files: [...PRESENT, font],
    css: `@font-face { src: url("./${font}"); }`
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /fonts\/practice\.woff2/);
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

test("an unreferenced pure core module does not require a shell entry", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE, files: PRESENT, core: ["calibration.js"]
  }));
  assert.deepEqual(errors, []);
});

test("a runtime-imported core module missing from the shell is reported", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE,
    files: PRESENT,
    core: ["music.js"],
    appJs: 'import "./core/music.js";'
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /core\/music\.js/);
});

test("core modules present in the shell pass", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./core/music.js"],
    files: PRESENT,
    core: ["music.js"],
    appJs: 'import "./core/music.js";'
  }));
  assert.deepEqual(errors, []);
});

test("nested runtime imports missing from the shell are reported recursively", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./core/audio/player.js"],
    files: PRESENT,
    core: [{ path: "audio/player.js", content: 'import "../../rhythm/views/orbit-view.js";' }],
    rhythm: ["views/orbit-view.js"],
    appJs: 'import "./core/audio/player.js";'
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /rhythm\/views\/orbit-view\.js/);
});

test("nested core and rhythm modules present in the shell pass", () => {
  const modules = ["./core/audio/player.js", "./rhythm/views/orbit-view.js"];
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, ...modules],
    files: PRESENT,
    core: [{ path: "audio/player.js", content: 'import "../../rhythm/views/orbit-view.js";' }],
    rhythm: ["views/orbit-view.js"],
    appJs: 'import "./core/audio/player.js";'
  }));
  assert.deepEqual(errors, []);
});

test("a non-JavaScript asset referenced by a reachable module must be in the shell", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./core/view.js"],
    files: PRESENT,
    core: [
      { path: "view.js", content: 'const icon = new URL("./meter.png", import.meta.url);' },
      { path: "meter.png", content: "image" }
    ],
    appJs: 'import "./core/view.js";'
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /core\/meter\.png/);
});

test("a non-JavaScript module asset is validated but never parsed recursively", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./core/view.js", "./core/meter.png"],
    files: PRESENT,
    core: [
      { path: "view.js", content: 'const icon = new URL("./meter.png", import.meta.url);' },
      { path: "meter.png", content: 'import "./ghost.js";' }
    ],
    appJs: 'import "./core/view.js";'
  }));
  assert.deepEqual(errors, []);
});

test("an audio sample missing from the shell is reported", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE, files: PRESENT, audio: ["drums/kick.wav"]
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /assets\/audio\/drums\/kick\.wav/);
});

test("audio samples present in the shell pass", () => {
  const sample = "assets/audio/drums/kick.wav";
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, `./${sample}`],
    files: PRESENT,
    audio: ["drums/kick.wav"]
  }));
  assert.deepEqual(errors, []);
});

test("an audioWorklet addModule script missing from the shell is reported", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./core/collector.js"],
    files: PRESENT,
    core: [
      { path: "collector.js", content: 'await audioContext.audioWorklet.addModule("./processor.js");' },
      { path: "processor.js", content: '// worklet processor' }
    ],
    appJs: 'import "./core/collector.js";'
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /core\/processor\.js/);
});

test("an audioWorklet addModule script present in the shell passes", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./core/collector.js", "./core/processor.js"],
    files: PRESENT,
    core: [
      { path: "collector.js", content: 'await audioContext.audioWorklet.addModule("./processor.js");' },
      { path: "processor.js", content: '// worklet processor' }
    ],
    appJs: 'import "./core/collector.js";'
  }));
  assert.deepEqual(errors, []);
});
