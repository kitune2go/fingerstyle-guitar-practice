import { test, expect } from "@playwright/test";

const base = "";
test.use({ viewport: { width: 390, height: 844 } });

test("basic practice loads on mobile", async ({ page }) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));

  await page.goto(base+"/index.html");
  await expect(page.getByRole("heading",{name:"指弾きギター練習帖"})).toBeVisible();
  await expect(page.locator("#lesson-title")).not.toHaveText("読み込み中です。");
  await expect(page.getByRole("link",{name:"フレーズ"})).toBeVisible();

  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test("score renders actual five-line systems and note heads", async ({ page }) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));

  await page.goto(base+"/phrase.html");
  await expect(page.locator("#phrase-title")).toHaveText("Cメジャー 8小節エチュード");
  await expect(page.locator("#key-label")).toHaveText("C Major");
  await expect(page.locator("#bar-label")).toHaveText("8 BARS");
  await expect(page.locator(".staff-system")).toHaveCount(8);

  const firstSystem=page.locator(".staff-system").first();
  await expect(firstSystem.locator("[data-staff-line]")).toHaveCount(5);
  await expect(firstSystem.locator(".bar-line")).toHaveCount(2);

  const noteCount=await page.locator(".note-head").count();
  expect(noteCount).toBeGreaterThan(20);
  await expect(page.locator(".note-name-text")).toHaveCount(noteCount);
  await expect(page.locator(".finger-text")).toHaveCount(noteCount);
  await expect(page.locator(".note-name-text").first()).toHaveText("E4");
  await expect(page.locator(".finger-text").first()).toHaveText("i");

  const firstHead=page.locator(".note-head").first();
  await expect(firstHead).toBeVisible();
  const box=await firstHead.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(8);
  expect(box.height).toBeGreaterThan(5);

  const systemBox=await firstSystem.boundingBox();
  expect(systemBox).not.toBeNull();
  expect(systemBox.height).toBeGreaterThan(120);

  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test("backing actually creates chord bass and drum audio nodes", async ({ page }) => {
  await page.addInitScript(() => {
    window.__audioAudit={oscillators:0,buffers:0,gains:0,compressors:0};
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx) return;

    const proto=Ctx.prototype;
    const originalOsc=proto.createOscillator;
    const originalBuffer=proto.createBufferSource;
    const originalGain=proto.createGain;
    const originalCompressor=proto.createDynamicsCompressor;

    proto.createOscillator=function(...args){
      window.__audioAudit.oscillators++;
      return originalOsc.apply(this,args);
    };
    proto.createBufferSource=function(...args){
      window.__audioAudit.buffers++;
      return originalBuffer.apply(this,args);
    };
    proto.createGain=function(...args){
      window.__audioAudit.gains++;
      return originalGain.apply(this,args);
    };
    proto.createDynamicsCompressor=function(...args){
      window.__audioAudit.compressors++;
      return originalCompressor.apply(this,args);
    };
  });

  await page.goto(base+"/phrase.html");

  await expect(page.locator("#backing-chords")).toHaveAttribute("aria-pressed","true");
  await expect(page.locator("#backing-bass")).toHaveAttribute("aria-pressed","true");
  await expect(page.locator("#backing-drums")).toHaveAttribute("aria-pressed","true");

  await page.getByRole("button",{name:"▶ 伴奏だけ1小節"}).click();
  await page.waitForTimeout(180);

  const audit=await page.evaluate(()=>window.__audioAudit);
  expect(audit.compressors).toBeGreaterThanOrEqual(1);
  expect(audit.oscillators).toBeGreaterThanOrEqual(6);
  expect(audit.buffers).toBeGreaterThanOrEqual(1);
  expect(audit.gains).toBeGreaterThanOrEqual(8);

  await page.locator("#backing-bass").click();
  await expect(page.locator("#backing-bass")).toHaveAttribute("aria-pressed","false");
});

test("full phrase transport schedules melody plus backing", async ({ page }) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));

  await page.goto(base+"/phrase.html");
  await page.getByRole("button",{name:"▶ 再生"}).click();
  await expect(page.getByRole("button",{name:"■ 停止"})).toBeEnabled();
  await page.waitForTimeout(240);

  await expect(page.locator(".note-symbol.active")).toHaveCount(1);
  await expect(page.locator(".chord-chip.active")).toHaveCount(1);

  await page.getByRole("button",{name:"■ 停止"}).click();
  expect(errors).toEqual([]);
});

test("playback auto-follows the current score measure", async ({ page }) => {
  await page.addInitScript(() => {
    window.__followCalls=[];
    Element.prototype.scrollIntoView=function(options){
      window.__followCalls.push({
        measure:this.getAttribute?.("data-measure"),
        block:options?.block,
        behavior:options?.behavior
      });
    };
  });

  await page.goto(base+"/phrase.html");
  await page.locator("#tempo").evaluate((el) => {
    el.value="160";
    el.dispatchEvent(new Event("input",{bubbles:true}));
  });

  await page.getByRole("button",{name:"▶ 再生"}).click();
  await page.waitForTimeout(1850);
  await page.getByRole("button",{name:"■ 停止"}).click();

  const calls=await page.evaluate(()=>window.__followCalls);
  expect(calls.some(call=>call.measure==="0")).toBeTruthy();
  expect(calls.some(call=>call.measure==="1")).toBeTruthy();
  expect(calls.every(call=>call.block==="center")).toBeTruthy();
  expect(calls.every(call=>call.behavior==="smooth")).toBeTruthy();
});

test("G major score shows key signature marker", async ({ page }) => {
  await page.goto(base+"/phrase.html");
  await page.locator("#phrase-select").selectOption("1");
  await expect(page.locator("#key-label")).toHaveText("G Major");
  await expect(page.locator(".staff-system")).toHaveCount(8);
  // The signature is reprinted on every system, as engraved music does.
  await expect(page.locator(".key-signature")).toHaveCount(8);
  await expect(page.locator(".key-signature").first()).toHaveText("♯");
  await expect(page.locator(".staff-system").first().locator("[data-staff-line]")).toHaveCount(5);
});

test("rhythm practice is integrated and interactive", async ({ page }) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));

  await page.goto(base+"/rhythm.html");
  await expect(page.getByRole("heading",{name:"Rhythm Practice"})).toBeVisible();
  await expect(page.locator("#patternSelect option")).not.toHaveCount(0);
  await expect(page.getByRole("link",{name:"基礎"})).toBeVisible();
  await expect(page.getByRole("link",{name:"フレーズ"})).toBeVisible();

  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test("service worker registers and precaches lesson data", async ({ page }) => {
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || performance.now() > 0);

  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active || registration.installing || registration.waiting);
  });
  expect(registered).toBeTruthy();

  const cached = await page.evaluate(async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const names = await caches.keys();
      for (const name of names) {
        const cache = await caches.open(name);
        const paths = (await cache.keys()).map((request) => new URL(request.url).pathname);
        if (paths.some((path) => path.endsWith("/data/lessons/001.json"))) return paths;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return [];
  });

  expect(cached.some((path) => path.endsWith("/data/lessons-index.json"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/data/lessons/001.json"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/data/phrases.json"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/phrase.js"))).toBeTruthy();
});

test("key signature replaces per-note accidentals in G major", async ({ page }) => {
  await page.goto(base + "/phrase.html");
  await page.locator("#phrase-select").selectOption("1");

  // One sharp per system (each measure is its own system), and no F# note may
  // repeat that sharp as an accidental of its own.
  const systems = await page.locator(".staff-system").count();
  await expect(page.locator(".key-signature")).toHaveCount(systems);
  await expect(page.locator('.note-symbol[data-note-name="F#4"]')).not.toHaveCount(0);
  await expect(page.locator(".accidental")).toHaveCount(0);

  // C major carries no signature at all.
  await page.locator("#phrase-select").selectOption("0");
  await expect(page.locator(".key-signature")).toHaveCount(0);
  await expect(page.locator(".accidental")).toHaveCount(0);
});

test("TAB column widths follow note values", async ({ page }) => {
  await page.goto(base + "/phrase.html");
  await page.locator("#phrase-select").selectOption("2"); // mixes 8th, quarter and half notes

  const measure = (await page.locator("#tab").textContent()).split("\n\n")[0].split("\n");
  const lines = measure.filter((line) => /^[eBGDAE]\|/.test(line));
  expect(lines).toHaveLength(6);
  // All six strings must stay in step, and a 4/4 bar is 16 columns wide.
  const widths = new Set(lines.map((line) => line.length));
  expect(widths.size).toBe(1);
  expect(lines[0].length).toBe(1 + 1 + 16 + 1);
});

test("score notes are keyboard reachable", async ({ page }) => {
  await page.goto(base + "/phrase.html");
  const staff = page.locator("#staff");
  await expect(staff).toHaveAttribute("role", "group");

  const third = page.locator(".note-symbol").nth(2);
  await expect(third).toHaveAttribute("role", "button");
  await expect(third).toHaveAttribute("tabindex", "0");

  await third.focus();
  await page.keyboard.press("Enter");
  await expect(third).toHaveClass(/active/);
  await expect(page.locator("#note-name")).toHaveText(await third.getAttribute("data-note-name"));
});

test("stepping notes by hand follows the score, and the toggle stops it", async ({ page }) => {
  await page.addInitScript(() => {
    window.__followCalls = [];
    Element.prototype.scrollIntoView = function (options) {
      window.__followCalls.push(this.getAttribute?.("data-measure"));
    };
  });
  await page.goto(base + "/phrase.html");

  // 4 notes per measure in this phrase, so this crosses at least one bar line.
  for (let i = 0; i < 8; i += 1) await page.locator("#next-note").click();
  expect(await page.evaluate(() => window.__followCalls.length)).toBeGreaterThan(0);

  await page.locator("#follow-toggle").click();
  await expect(page.locator("#follow-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => { window.__followCalls.length = 0; });
  for (let i = 0; i < 8; i += 1) await page.locator("#next-note").click();
  expect(await page.evaluate(() => window.__followCalls.length)).toBe(0);
});

test("low bass notes do not collide with the pitch-name row", async ({ page }) => {
  await page.goto(base + "/phrase.html");
  const geometry = await page.evaluate(() => {
    const head = document.querySelector(".note-head");
    const svg = head.ownerSVGElement;
    const lowest = [...document.querySelectorAll(".staff-system")[0].querySelectorAll(".note-head")]
      .reduce((low, node) => Math.max(low, Number(node.getAttribute("cy"))), -Infinity);
    const nameY = Number(document.querySelector(".note-name-text").getAttribute("y"));
    const viewBox = svg.getAttribute("viewBox").split(" ").map(Number);
    return { lowest, nameY, viewBoxBottom: viewBox[1] + viewBox[3] };
  });
  // Note heads must clear the pitch-name row, which must itself sit inside the box.
  expect(geometry.nameY).toBeGreaterThan(geometry.lowest + 12);
  expect(geometry.viewBoxBottom).toBeGreaterThan(geometry.nameY);
});

// stop() ducks the master bus to swallow the tail of already-scheduled notes.
// Anything started inside that ~120ms window used to be swallowed with it: a
// note begun 60-103ms after a stop played through a master gain of 0.0001.
const instrumentMasterGain = () => {
  window.__auto = [];
  window.__starts = [];

  const descriptor = Object.getOwnPropertyDescriptor(AudioParam.prototype, "value");
  Object.defineProperty(AudioParam.prototype, "value", {
    get: descriptor.get,
    set(v) { this.__initial = v; return descriptor.set.call(this, v); },
    configurable: true
  });

  for (const method of ["setValueAtTime", "linearRampToValueAtTime",
                        "exponentialRampToValueAtTime", "cancelScheduledValues"]) {
    const original = AudioParam.prototype[method];
    AudioParam.prototype[method] = function (...args) {
      // The master bus is the only one initialised to MASTER_LEVEL (0.78).
      if (this.__initial === 0.78) {
        window.__auto.push({ method, value: args[0], time: args[args.length - 1] });
      }
      return original.apply(this, args);
    };
  }

  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    window.__starts.push(when);
    return start.call(this, when);
  };

  // Replays the recorded automation to get the gain actually in force at `t`.
  // cancelScheduledValues(x) has to drop everything already queued at or after
  // x, otherwise cancelled automation still shows up in the replay.
  window.__gainAt = (events, t) => {
    const live = [];
    for (const event of events) {
      if (event.method === "cancelScheduledValues") {
        for (let i = live.length - 1; i >= 0; i -= 1) {
          if (live[i].time >= event.time) live.splice(i, 1);
        }
        continue;
      }
      live.push(event);
    }

    let value = 0.78;
    let previous = 0;
    for (const event of live) {
      if (event.time > t) {
        if (event.method.endsWith("RampToValueAtTime") && event.time > previous) {
          return value + (event.value - value) * ((t - previous) / (event.time - previous));
        }
        return value;
      }
      value = event.value;
      previous = event.time;
    }
    return value;
  };
};

async function gainAtFirstNoteAfterStop(page, startPlayback) {
  await page.getByRole("button", { name: "▶ 再生" }).click();
  await page.waitForTimeout(400);
  // Discard what the lookahead queued before the stop; only the new sound matters.
  await page.evaluate(() => { window.__auto.length = 0; window.__starts.length = 0; });

  await page.getByRole("button", { name: "■ 停止" }).click();
  await startPlayback();                       // no wait: the worst case
  await page.waitForTimeout(300);

  return page.evaluate(() => {
    const stopAt = window.__auto.find((e) => e.method === "cancelScheduledValues").time;
    const started = window.__starts.filter((t) => t >= stopAt).sort((a, b) => a - b);
    return { offset: started[0] - stopAt, gain: window.__gainAt(window.__auto, started[0]) };
  });
}

test("playing straight after stop is not swallowed by the stop's fade", async ({ page }) => {
  await page.addInitScript(instrumentMasterGain);
  await page.goto(base + "/phrase.html");

  const { offset, gain } = await gainAtFirstNoteAfterStop(page, () =>
    page.getByRole("button", { name: "▶ 再生" }).click());

  // The note really does land inside the window the fade used to cover.
  expect(offset).toBeLessThan(0.12);
  expect(gain).toBeCloseTo(0.78, 3);
});

test("a single note straight after stop is not swallowed either", async ({ page }) => {
  await page.addInitScript(instrumentMasterGain);
  await page.goto(base + "/phrase.html");

  const { offset, gain } = await gainAtFirstNoteAfterStop(page, () =>
    page.getByRole("button", { name: "♪ この音" }).click());

  expect(offset).toBeLessThan(0.12);
  expect(gain).toBeCloseTo(0.78, 3);
});
