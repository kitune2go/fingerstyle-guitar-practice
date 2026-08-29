import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:4173";
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
  await expect(page.locator(".key-signature")).toHaveText("♯");
  await expect(page.locator(".staff-system")).toHaveCount(8);
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
