import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function tempo(page,value=160){
  await page.locator("#tempo").evaluate((element,bpm)=>{
    element.value=String(bpm);element.dispatchEvent(new Event("input",{bubbles:true}));
  },value);
}

async function openPractice(page){
  await page.goto("/phrase.html");
  await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
  await page.locator("#follow-toggle").click();
  await tempo(page);
}

async function storedAttempts(page){
  return page.evaluate(async()=>{
    const {createPracticeStore}=await import("./core/practice-store.js");
    return createPracticeStore(indexedDB).all();
  });
}

test("an audio action immediately after page load waits for lesson data exactly once",async({page})=>{
  await page.addInitScript(()=>{
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(...args)=>{
      if(String(args[0]).includes("data/phrases.json")) await new Promise(resolve=>setTimeout(resolve,300));
      return originalFetch(...args);
    };
    window.__starts=0;
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){window.__starts++;return start.apply(this,args);};
  });
  await page.goto("/phrase.html");
  const pending=await page.evaluate(()=>{
    const button=document.getElementById("play-note");button.click();button.click();
    return button.disabled&&document.getElementById("play").disabled;
  });
  expect(pending).toBe(true);
  await expect(page.locator("#play-note")).toBeEnabled();
  expect(await page.evaluate(()=>window.__starts)).toBe(1);
});

test("selected measure loops without visiting other measures and counts completed passes",async({page})=>{
  await openPractice(page);
  await page.locator("#range-start").selectOption("2");
  await page.locator("#range-one").click();
  await page.locator("#loop").click();
  await page.evaluate(()=>{
    window.__measures=[];
    new MutationObserver(()=>{
      const active=document.querySelector(".note-symbol.active");
      if(active) window.__measures.push(active.closest("svg").dataset.measure);
    }).observe(document.getElementById("staff"),{subtree:true,attributes:true,attributeFilter:["class"]});
  });
  await page.locator("#play").click();
  await expect(page.locator("#practice-status")).toContainText("3回目",{timeout:6000});
  await page.locator("#stop").click();
  expect(new Set(await page.evaluate(()=>window.__measures))).toEqual(new Set(["1"]));
  await expect(page.locator("#attempt-summary")).toContainText("2回再生完了");
  await page.locator("#record-clean").click();
  await expect(page.locator("#record-status")).toContainText("保存しました");
  const [attempt]=await storedAttempts(page);
  expect(attempt.conditions.start).toBe(2);
  expect(attempt.conditions.end).toBe(2);
  expect(attempt.observed.completedLoops).toBe(2);
  expect(attempt.assessment).toEqual({status:"provisional",basis:"reported"});
});

test("count-in uses four audio-clock beats before the first melody attack",async({page})=>{
  await page.addInitScript(()=>{
    window.__tones=[];
    const setValue=AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime=function(value,time){
      this.__scheduledValue=value;return setValue.call(this,value,time);
    };
    const original=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(time){
      window.__tones.push({type:this.type,time,frequency:this.frequency.__scheduledValue});
      return original.call(this,time);
    };
  });
  await openPractice(page);
  await page.locator("#sound-mode-toggle").click();
  for(const part of ["chords","bass","drums"]) await page.locator("#backing-"+part).click();
  await page.locator("#range-one").click();
  await page.locator("#count-in").selectOption("1");
  await page.locator("#play").click();
  await expect.poll(()=>page.evaluate(()=>window.__tones.some(tone=>tone.type==="triangle"))).toBe(true);
  await page.locator("#stop").click();
  const tones=await page.evaluate(()=>window.__tones);
  const melody=tones.find(tone=>tone.type==="triangle");
  const intro=tones.filter(tone=>tone.time<melody.time);
  expect(intro).toHaveLength(4);
  expect(intro.map(tone=>tone.frequency)).toEqual([1000,750,750,750]);
  for(let i=0;i<4;i++) expect(melody.time-intro[i].time).toBeCloseTo((4-i)*.375,6);
  await expect(page.locator("#record-clean")).toBeDisabled();
});

test("assist modes hide TAB and answers while preserving keyboard score access",async({page})=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await openPractice(page);
  await page.setViewportSize({width:390,height:844});
  await page.locator("#assist-mode").selectOption("staff");
  await expect(page.locator("#tab-panel")).toBeHidden();
  await expect(page.locator(".note-trainer")).toBeHidden();
  await expect(page.locator(".vf-tabnote")).toHaveCount(0);
  await expect(page.locator(".note-name-text").first()).toBeHidden();
  const note=page.locator(".note-symbol").nth(1);
  await note.focus();await page.keyboard.press("Enter");
  await expect(note).toHaveClass(/active/);
  expect(await note.getAttribute("aria-label")).not.toMatch(/フレット|右手|[A-G][#b]?\d/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator("#assist-mode").selectOption("memory");
  await expect(page.locator("#staff")).toBeHidden();
  await expect(page.locator("#chord-progression")).toBeHidden();
  await expect(page.locator("#melody-toggle")).toHaveAttribute("aria-pressed","false");
  await page.locator("#reveal-score").click();
  await expect(page.locator("#staff")).toBeVisible();
  await expect(page.locator("#tab-panel")).toBeVisible();
  await expect(page.locator(".vf-tabnote").first()).toBeVisible();
  await page.locator("#phrase-select").selectOption("4");
  await page.locator("#assist-mode").selectOption("staff");
  await expect(page.locator(".vf-tabnote")).toHaveCount(0);
  await expect(page.locator(".notation-tuplet").first()).toBeAttached();
  expect(errors).toEqual([]);
});

test("memory practice persists exact conditions and backups merge without duplicates",async({page})=>{
  await openPractice(page);
  await page.locator("#range-one").click();
  await page.locator("#assist-mode").selectOption("memory");
  await page.locator("#play").click();
  await expect(page.locator("#record-clean")).toBeEnabled({timeout:6000});
  await tempo(page,80);
  await page.locator("#record-clean").click();
  await expect(page.locator("#record-status")).toContainText("保存しました");
  await page.reload();
  await expect(page.locator("#assist-mode")).toHaveValue("memory");
  await expect(page.locator("#tempo")).toHaveValue("80");
  await page.locator("summary").click();
  await expect(page.locator("#attempt-list li")).toContainText("160 BPM");
  const downloadPromise=page.waitForEvent("download");
  await page.locator("#export-practice").click();
  const download=await downloadPromise;
  const bytes=await readFile(await download.path());
  const backup=JSON.parse(bytes.toString());
  expect(backup.attempts[0].conditions).toMatchObject({tempo:160,assist:"memory",melody:false,start:1,end:1});
  await page.locator("#practice-file").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:bytes});
  await expect(page.locator("#record-status")).toContainText("全1件");
  await page.locator("#practice-file").setInputFiles({name:"bad.json",mimeType:"application/json",buffer:Buffer.from('{"format":"wrong"}')});
  await expect(page.locator("#record-status")).toContainText("既存の記録は保持");
  expect(await storedAttempts(page)).toHaveLength(1);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(async()=>Boolean(await caches.match(new URL("./core/practice-store.js",location.href))))).toBe(true);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator("#assist-mode")).toHaveValue("memory");
  await page.locator("summary").click();
  await expect(page.locator("#attempt-list li")).toContainText("160 BPM");
  await page.context().setOffline(false);
});

test("stopping or changing phrase during sample loading cannot trigger delayed playback",async({page})=>{
  await page.addInitScript(()=>{
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=async(...args)=>{
      if(String(args[0]).includes("/assets/audio/")) await new Promise(resolve=>setTimeout(resolve,350));
      return fetchOriginal(...args);
    };
    window.__starts=0;
    const original=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){window.__starts++;return original.apply(this,args);};
  });
  await openPractice(page);
  await page.locator("#play").click();
  await expect(page.locator("#stop")).toBeEnabled();
  await page.locator("#stop").click();
  await page.locator("#phrase-select").selectOption("1");
  await page.waitForTimeout(750);
  expect(await page.evaluate(()=>window.__starts)).toBe(0);
  await expect(page.locator("#play")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();
});

test("Stop cancels every queued source including backing preview sources",async({page})=>{
  await page.addInitScript(()=>{
    window.__sources=[];
    for(const Type of [AudioBufferSourceNode,OscillatorNode]){
      const start=Type.prototype.start,stop=Type.prototype.stop;
      Type.prototype.start=function(time){window.__sources.push(this);return start.call(this,time);};
      Type.prototype.stop=function(time){this.__stopTime=time;return stop.call(this,time);};
    }
  });
  await openPractice(page);
  for(const button of ["play","preview-backing"]){
    const before=await page.evaluate(()=>window.__sources.length);
    await page.locator("#"+button).click();
    await expect.poll(()=>page.evaluate(()=>window.__sources.length)).toBeGreaterThan(before);
    await expect(page.locator("#stop")).toBeEnabled();
    const cancelled=await page.evaluate(()=>{
      const sources=[...window.__sources];
      document.getElementById("stop").click();
      return sources.length>0&&sources.every(source=>source.__stopTime<=source.context.currentTime+.005);
    });
    expect(cancelled).toBe(true);
    await expect(page.locator("#stop")).toBeDisabled();
  }
});

test("a storage write failure keeps the unsaved attempt available for retry",async({page})=>{
  await openPractice(page);
  await page.locator("#range-one").click();
  await page.locator("#play").click();
  await expect(page.locator("#record-clean")).toBeEnabled({timeout:6000});
  await page.evaluate(()=>{
    window.__add=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(){throw new DOMException("full","QuotaExceededError");};
  });
  await page.locator("#record-clean").click();
  await expect(page.locator("#record-status")).toContainText("保存できませんでした");
  await expect(page.locator("#record-clean")).toBeEnabled();
  await page.evaluate(()=>{IDBObjectStore.prototype.add=window.__add;});
  await page.locator("#record-clean").click();
  await expect(page.locator("#record-status")).toContainText("保存しました");
  expect(await storedAttempts(page)).toHaveLength(1);
});
