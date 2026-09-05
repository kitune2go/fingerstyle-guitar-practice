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
  await expect(page.locator("#sound-mode-toggle")).toHaveText("音色：リアル");
  await expect(page.locator("#sound-mode-toggle")).toHaveAttribute("aria-pressed","true");

  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test("basic practice plays its TAB as sampled guitar instead of clicks", async ({ page }) => {
  await page.addInitScript(() => {
    window.__lessonSources=[];
    window.__lessonOscillators=0;
    const sourceStart=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(when){
      window.__lessonSources.push(when);
      return sourceStart.call(this,when);
    };
    const oscillatorStart=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(...args){
      window.__lessonOscillators++;
      return oscillatorStart.apply(this,args);
    };
  });

  await page.goto(base+"/index.html");
  await page.locator("#play-lesson").click();
  await page.waitForFunction(()=>window.__lessonSources.length>=8);

  const audit=await page.evaluate(()=>({
    sources:window.__lessonSources,
    oscillators:window.__lessonOscillators
  }));
  expect(audit.sources).toHaveLength(8);
  expect(audit.sources.every((time,index,array)=>index===0||time>array[index-1])).toBeTruthy();
  expect(audit.oscillators).toBe(0);
  await page.getByRole("button",{name:"■ お手本停止"}).click();
  await expect(page.locator("#play-lesson")).toHaveText("▶ お手本");
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

test("real backing creates sampled guitar bass and drum audio nodes", async ({ page }) => {
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
  await expect(page.locator("#preview-backing")).toBeEnabled();
  await page.waitForFunction(()=>window.__audioAudit.buffers>=20);

  const audit=await page.evaluate(()=>window.__audioAudit);
  expect(audit.compressors).toBeGreaterThanOrEqual(1);
  expect(audit.oscillators).toBe(0);
  expect(audit.buffers).toBeGreaterThanOrEqual(20);
  expect(audit.gains).toBeGreaterThanOrEqual(20);

  await page.locator("#backing-bass").click();
  await expect(page.locator("#backing-bass")).toHaveAttribute("aria-pressed","false");
});

test("the phrase player can switch back to its synthesis fallback", async ({ page }) => {
  await page.addInitScript(() => {
    window.__audioAudit={oscillators:0,buffers:0};
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx) return;
    const proto=Ctx.prototype;
    const originalOsc=proto.createOscillator;
    const originalBuffer=proto.createBufferSource;
    proto.createOscillator=function(...args){
      window.__audioAudit.oscillators++;
      return originalOsc.apply(this,args);
    };
    proto.createBufferSource=function(...args){
      window.__audioAudit.buffers++;
      return originalBuffer.apply(this,args);
    };
  });

  await page.goto(base+"/phrase.html");
  await page.locator("#sound-mode-toggle").click();
  await expect(page.locator("#sound-mode-toggle")).toHaveAttribute("aria-pressed","false");
  await expect(page.locator("#sound-mode-note")).toContainText("合成音");

  await page.getByRole("button",{name:"▶ 伴奏だけ1小節"}).click();
  await page.waitForTimeout(180);
  const audit=await page.evaluate(()=>window.__audioAudit);
  expect(audit.oscillators).toBeGreaterThanOrEqual(12);
  expect(audit.buffers).toBeGreaterThanOrEqual(8);
});

test("a phrase melody note uses the nylon guitar sample", async ({ page }) => {
  await page.addInitScript(() => {
    window.__sampleStarts=0;
    window.__oscillatorStarts=0;
    const sampleStart=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){
      window.__sampleStarts++;
      return sampleStart.apply(this,args);
    };
    const oscillatorStart=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(...args){
      window.__oscillatorStarts++;
      return oscillatorStart.apply(this,args);
    };
  });

  await page.goto(base+"/phrase.html");
  await page.locator("#play-note").click();
  await expect(page.locator("#play-note")).toBeEnabled();
  await page.waitForFunction(()=>window.__sampleStarts===1);
  const audit=await page.evaluate(()=>({
    samples:window.__sampleStarts,
    oscillators:window.__oscillatorStarts
  }));
  expect(audit.samples).toBe(1);
  expect(audit.oscillators).toBe(0);
});

test("a sample load failure falls back to synthesis instead of silence", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{
      const url=String(input instanceof Request?input.url:input);
      if(url.includes("/assets/audio/")) return Promise.resolve(new Response("",{status:503}));
      return originalFetch(input,init);
    };
    window.__oscillatorStarts=0;
    const start=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(...args){
      window.__oscillatorStarts++;
      return start.apply(this,args);
    };
  });

  await page.goto(base+"/phrase.html");
  await page.locator("#play-note").click();
  await expect(page.locator("#sound-mode-toggle")).toHaveText("音源失敗：合成");
  await expect(page.locator("#sound-mode-toggle")).toHaveAttribute("aria-pressed","false");
  await expect(page.locator("#sound-mode-toggle")).toHaveAttribute("aria-label",/合成音を使用中/);
  expect(await page.evaluate(()=>window.__oscillatorStarts)).toBeGreaterThanOrEqual(2);
});

test("phrase audio actions are serialized while their required sample loads", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch=window.fetch.bind(window);
    window.__audioFetches=[];
    window.fetch=async(input,init)=>{
      const url=String(input instanceof Request?input.url:input);
      if(url.includes("/assets/audio/")){
        window.__audioFetches.push(url);
        await new Promise(resolve=>setTimeout(resolve,120));
      }
      return originalFetch(input,init);
    };
    window.__sampleStarts=0;
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){
      window.__sampleStarts++;
      return start.apply(this,args);
    };
  });

  await page.goto(base+"/phrase.html");
  const pendingState=await page.evaluate(()=>{
    const button=document.getElementById("play-note");
    button.click();
    button.click();
    button.click();
    return {
      play:document.getElementById("play").disabled,
      note:button.disabled,
      backing:document.getElementById("preview-backing").disabled
    };
  });
  expect(pendingState).toEqual({play:true,note:true,backing:true});
  await expect(page.locator("#play-note")).toBeEnabled();
  expect(await page.evaluate(()=>window.__sampleStarts)).toBe(1);
  const fetched=await page.evaluate(()=>window.__audioFetches);
  expect(fetched).toHaveLength(29);
  expect(fetched.every(url=>url.includes("/assets/audio/guitar-nylon/"))).toBeTruthy();
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

test("A7 score engraves tuplets and guitar techniques", async ({ page }) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));

  await page.goto(base+"/phrase.html");
  await page.locator("#phrase-select").selectOption("4");
  await expect(page.locator("#phrase-title")).toHaveText("A7ブルース・ロック 8小節");
  await expect(page.locator(".staff-system")).toHaveCount(8);
  await expect(page.locator('[data-notation-type="tuplet"]')).toHaveCount(2);
  await expect(page.locator('[data-notation-type="bend"]')).toHaveCount(2);
  await expect(page.locator('[data-notation-type="hammer-on"]')).toHaveCount(5);
  await expect(page.locator('[data-notation-type="pull-off"]')).toHaveCount(1);
  await expect(page.locator('[data-notation-type="slide"]')).toHaveCount(1);
  await expect(page.locator('[data-note-index="50"]')).toHaveAttribute("aria-label",/8分音符 3連符/);

  await page.locator('[data-note-index="11"]').click();
  await expect(page.locator("#note-name")).toHaveText("F#4");
  await expect(page.locator("#note-finger")).toContainText("ベンド Full");
  await expect(page.locator(".staff-system").nth(6)).toContainText("3");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test("rhythm practice is integrated and interactive", async ({ page }) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));

  await page.goto(base+"/rhythm.html");
  await expect(page.getByRole("heading",{name:"Rhythm Practice"})).toBeVisible();
  await expect(page.locator("#patternSelect option")).not.toHaveCount(0);
  await expect(page.getByRole("link",{name:"基礎"})).toBeVisible();
  await expect(page.getByRole("link",{name:"フレーズ"})).toBeVisible();
  await expect(page.locator("#soundModeBtn")).toHaveText("音色：リアル");

  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test("rhythm pattern metadata, expression marks and visual offset survive integration", async ({ page }) => {
  await page.goto(base+"/rhythm.html");

  await page.locator("#patternSelect").selectOption("afro12");
  await expect(page.locator("#meterDisplay")).toHaveText("12/8 ・ 1小節");
  await expect(page.locator("#bpmLabel")).toHaveText("96");
  await expect(page.locator("#patternInfo")).toContainText("1拍 = 付点4分音符");

  await page.locator("#offsetRange").evaluate((input) => {
    input.value="25";
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await expect(page.locator("#offsetLabel")).toHaveText("+25 ms");
  await page.locator("#offsetResetBtn").click();
  await expect(page.locator("#offsetLabel")).toHaveText("0 ms");

  await page.locator("#patternSelect").selectOption("funk16");
  await expect(page.locator(".orbit-marker.accent")).not.toHaveCount(0);
  await expect(page.locator(".orbit-marker.note-ghost")).not.toHaveCount(0);

  await page.locator("#gridViewBtn").click();
  await expect(page.locator("#gridView")).toBeVisible();
  await expect(page.locator(".cell.event.accent")).not.toHaveCount(0);
  await expect(page.locator(".cell.event.note-ghost")).not.toHaveCount(0);
});

test("rhythm sample failure falls back to expressive synthesis", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{
      const url=String(input instanceof Request?input.url:input);
      if(url.includes("/assets/audio/")) return Promise.resolve(new Response("",{status:503}));
      return originalFetch(input,init);
    };
    window.__rhythmOscillators=0;
    const start=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(...args){
      window.__rhythmOscillators++;
      return start.apply(this,args);
    };
  });

  await page.goto(base+"/rhythm.html");
  await page.locator("#startBtn").click();
  await expect(page.locator("#stateText")).toHaveText("再生中");
  await expect(page.locator("#soundModeBtn")).toHaveText("音源失敗：合成");
  await expect(page.locator("#soundModeBtn")).toHaveAttribute("aria-pressed","false");
  await expect(page.locator("#soundModeBtn")).toHaveAttribute("aria-label",/合成音を使用中/);
  await page.waitForFunction(() => window.__rhythmOscillators > 0);
  await page.locator("#stopBtn").click();
});

test("basic and rhythm practice schedule real percussion samples", async ({ page }) => {
  await page.addInitScript(() => {
    window.__sources=[];
    window.__oscillators=0;
    const sourceStart=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(when){
      window.__sources.push({when,duration:this.buffer?.duration});
      return sourceStart.call(this,when);
    };
    const oscillatorStart=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(when){
      window.__oscillators++;
      return oscillatorStart.call(this,when);
    };
  });

  await page.goto(base+"/index.html");
  await page.locator("#tempo-up").evaluate(button => {
    for(let i=0;i<50;i+=1) button.click();
  });
  await page.locator("#metronome-toggle").click();
  await expect(page.locator("#metronome-toggle")).toHaveText("STOP");
  await page.waitForFunction(() => window.__sources.length >= 2);
  let audit=await page.evaluate(()=>({sources:window.__sources,oscillators:window.__oscillators}));
  expect(audit.sources.length).toBeGreaterThanOrEqual(2);
  expect(new Set(audit.sources.map(source=>source.duration.toFixed(2))).size).toBeGreaterThanOrEqual(2);
  expect(audit.oscillators).toBe(0);
  await page.locator("#metronome-toggle").click();

  await page.goto(base+"/rhythm.html");
  await page.locator("#addLayerBtn").click();
  await page.locator("#addLayerBtn").click();
  await page.locator("#addLayerBtn").click();
  await page.evaluate(()=>{ window.__sources.length=0; window.__oscillators=0; });
  await page.locator("#startBtn").click();
  await expect(page.locator("#stateText")).toHaveText("再生中");
  await page.waitForFunction(() => window.__sources.length >= 4);
  audit=await page.evaluate(()=>({sources:window.__sources,oscillators:window.__oscillators}));
  expect(audit.sources.length).toBeGreaterThanOrEqual(4);
  expect(new Set(audit.sources.slice(0,4).map(source=>source.duration.toFixed(3))).size).toBe(4);
  expect(audit.oscillators).toBe(0);
  await page.locator("#stopBtn").click();
});

test("stopping the basic metronome cancels queued clicks and pulses", async ({ page }) => {
  await page.addInitScript(() => {
    window.__immediateOscillatorStops = 0;
    const originalStop = OscillatorNode.prototype.stop;
    OscillatorNode.prototype.stop = function (...args) {
      if (args.length === 0) window.__immediateOscillatorStops += 1;
      return originalStop.apply(this, args);
    };
  });

  await page.goto(base + "/index.html");
  await page.locator("#sound-mode-toggle").click();
  await expect(page.locator("#sound-mode-toggle")).toHaveAttribute("aria-pressed", "false");

  await page.evaluate(() => new Promise((resolve) => {
    const button = document.getElementById("metronome-toggle");
    const observer = new MutationObserver(() => {
      if (button.textContent !== "STOP") return;
      observer.disconnect();
      button.click();
      window.setTimeout(resolve, 180);
    });
    observer.observe(button, { attributes: true, childList: true, subtree: true });
    button.click();
  }));

  await expect(page.locator("#metronome-toggle")).toHaveText("START");
  await expect(page.locator("#metronome-toggle")).not.toHaveClass(/pulse/);
  expect(await page.evaluate(() => window.__immediateOscillatorStops)).toBeGreaterThan(0);
});

test("sound mode choice is shared by all three practice pages", async ({ page }) => {
  await page.goto(base+"/index.html");
  await page.locator("#sound-mode-toggle").click();
  await expect(page.locator("#sound-mode-toggle")).toHaveAttribute("aria-pressed","false");

  await page.getByRole("link",{name:"フレーズ"}).click();
  await expect(page.locator("#sound-mode-toggle")).toHaveAttribute("aria-pressed","false");
  await expect(page.locator("#sound-mode-toggle")).toHaveText("音色：合成");

  await page.getByRole("link",{name:"リズム"}).click();
  await expect(page.locator("#soundModeBtn")).toHaveAttribute("aria-pressed","false");
  await expect(page.locator("#soundModeBtn")).toHaveText("音色：合成");
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
  expect(cached.some((path) => path.endsWith("/musicxml/001-right-hand-alternation.musicxml"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/musicxml/002-thumb-independence.musicxml"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/data/phrases.json"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/phrase.js"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/rhythm.js"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/rhythm/core/audio-engine.js"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/rhythm/views/orbit-view.js"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/core/sample-player.js"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/assets/audio/guitar-nylon/e4.mp3"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/assets/audio/drums/kick.wav"))).toBeTruthy();
  expect(cached.some((path) => path.endsWith("/audio-credits.html"))).toBeTruthy();
});

test("audio credits are reachable from the practice UI", async ({ page }) => {
  await page.goto(base+"/phrase.html");
  await page.getByRole("link",{name:"音源クレジット"}).click();
  await expect(page.getByRole("heading",{name:"音源クレジット"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"ナイロンギター／エレキベース"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"アコースティックドラム"})).toBeVisible();
  await expect(page.getByRole("link",{name:"Creative Commons Attribution 3.0"})).toHaveCount(2);
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
  // The score is drawn after the phrase fetch resolves. page.evaluate does not
  // auto-wait the way a locator assertion does, so wait for it explicitly.
  await expect(page.locator(".note-head").first()).toBeAttached();

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

  for (const Source of [OscillatorNode, AudioBufferSourceNode]) {
    const start = Source.prototype.start;
    Source.prototype.start = function (when) {
      window.__starts.push(when);
      return start.call(this, when);
    };
  }

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

async function gainAtFirstNoteAfterStop(page, startButtonId) {
  await page.getByRole("button", { name: "▶ 再生" }).click();
  await page.waitForTimeout(400);
  // Discard what the lookahead queued before the stop; only the new sound matters.
  await page.evaluate(() => { window.__auto.length = 0; window.__starts.length = 0; });

  // Dispatch both actions in one browser task. This keeps the assertion about
  // the audio-clock fade window deterministic instead of including the
  // Playwright round-trip between two separate clicks.
  await page.evaluate((buttonId) => {
    document.getElementById("stop").click();
    document.getElementById(buttonId).click();
  }, startButtonId);
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

  const { offset, gain } = await gainAtFirstNoteAfterStop(page, "play");

  // The note really does land inside the window the fade used to cover.
  expect(offset).toBeLessThan(0.12);
  expect(gain).toBeCloseTo(0.78, 3);
});

test("a single note straight after stop is not swallowed either", async ({ page }) => {
  await page.addInitScript(instrumentMasterGain);
  await page.goto(base + "/phrase.html");

  const { offset, gain } = await gainAtFirstNoteAfterStop(page, "play-note");

  expect(offset).toBeLessThan(0.12);
  expect(gain).toBeCloseTo(0.78, 3);
});
