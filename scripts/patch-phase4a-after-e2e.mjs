import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path,before,after){
  const source=await readFile(path,"utf8");
  if(!source.includes(before)) throw new Error(`${path}: expected source not found`);
  const updated=source.replace(before,after);
  if(updated===source) throw new Error(`${path}: replacement made no change`);
  await writeFile(path,updated);
}

// Do not release the pre-data audio-action gate from a focus-only render.
// During bootstrap, playOne()/play() may be awaiting the shared lesson fetch.
await replaceOnce(
  "phrase.js",
  '    renderReadingFocus();\n    setAudioEntriesPending(false);\n  }',
  '    renderReadingFocus();\n    const recordButton=$("record-play");\n    if(recordButton) recordButton.disabled=state.starting||state.running||state.focusMode==="reading";\n  }'
);

// Rhythm focus keeps the original AudioContext scheduling times but represents
// both onset and note duration using a fixed neutral pitch.
await replaceOnce(
  "phrase.js",
  '  function scheduleRhythmGuide(time,accent=false){\n    const osc=state.audio.createOscillator();\n    const gain=envelopeGain(time,accent?.12:.08,.055,state.mix.melody);\n    osc.type="square";\n    osc.frequency.setValueAtTime(880,time);\n    osc.connect(gain);\n    trackSource(osc);\n    osc.start(time);\n    osc.stop(time+.065);\n  }',
  '  function scheduleRhythmGuide(time,durationSec,accent=false){\n    const neutralDuration=Math.max(.055,Math.min(1.2,durationSec*.86));\n    const osc=state.audio.createOscillator();\n    const gain=envelopeGain(time,accent?.12:.08,neutralDuration,state.mix.melody);\n    osc.type="square";\n    osc.frequency.setValueAtTime(880,time);\n    osc.connect(gain);\n    trackSource(osc);\n    osc.start(time);\n    osc.stop(time+neutralDuration+.015);\n  }'
);

await replaceOnce(
  "phrase.js",
  '    if(rhythmFocus&&state.run.conditions.melody&&event.notes.some(item=>item.attack)){\n      scheduleRhythmGuide(time,Math.abs(event.beat%state.model.beatsPerBar)<1e-9);\n    }',
  '    if(rhythmFocus&&state.run.conditions.melody&&event.notes.some(item=>item.attack)){\n      const durationBeats=Math.max(...event.notes.filter(item=>item.attack).map(item=>item.durationBeats));\n      scheduleRhythmGuide(time,durationBeats*spb,Math.abs(event.beat%state.model.beatsPerBar)<1e-9);\n    }'
);

// Fix the reading test's terminal-state observation. textContent is a DOM
// property, not an HTML attribute; the old check retried a disabled reveal.
await replaceOnce(
  "tests/focus.spec.mjs",
  '    const last=await page.locator("#reading-next").getAttribute("textContent");',
  '    const last=await page.locator("#reading-next").textContent();'
);

await replaceOnce(
  "tests/focus.spec.mjs",
  'import { test, expect } from "@playwright/test";\n',
  'import { test, expect } from "@playwright/test";\nimport { readFile } from "node:fs/promises";\n'
);

// Verify version-1 backup remains the format, carries focusMode, and never
// serializes a recording Blob.
await replaceOnce(
  "tests/focus.spec.mjs",
  '  expect(saved.reported.clean).toBe(true);\n  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);',
  '  expect(saved.reported.clean).toBe(true);\n  const downloadPromise=page.waitForEvent("download");\n  await page.locator("#export-practice").click();\n  const download=await downloadPromise;\n  const json=(await readFile(await download.path())).toString();\n  const backup=JSON.parse(json);\n  expect(backup.version).toBe(1);\n  expect(backup.attempts[0].conditions.focusMode).toBe("reading");\n  expect(json).not.toContain("\\\"blob\\\"");\n  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);'
);

const extraTests=`\n\ntest("execution focus records, self-reviews, and persists recording with the same Attempt ID",async({page})=>{\n  await page.addInitScript(()=>{\n    window.__trackStops=0;\n    const track={stop(){window.__trackStops++;},getSettings(){return {sampleRate:48000,channelCount:1};}};\n    const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};\n    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>stream}});\n    class FakeMediaRecorder extends EventTarget{\n      static isTypeSupported(type){return type==="audio/webm;codecs=opus";}\n      constructor(input,options={}){super();this.stream=input;this.mimeType=options.mimeType||"audio/fake";this.state="inactive";}\n      start(){this.state="recording";}\n      stop(){\n        if(this.state!=="recording") throw new DOMException("inactive","InvalidStateError");\n        this.state="inactive";\n        const event=new Event("dataavailable");\n        Object.defineProperty(event,"data",{value:new Blob(["execution"],{type:this.mimeType})});\n        this.dispatchEvent(event);\n        this.dispatchEvent(new Event("stop"));\n      }\n    }\n    Object.defineProperty(window,"MediaRecorder",{configurable:true,value:FakeMediaRecorder});\n  });\n  await open(page);\n  await page.locator("#range-one").click();\n  await page.locator("#focus-mode").selectOption("execution");\n  await page.locator("#record-play").click();\n  await expect(page.locator("#recording-monitor")).toBeVisible({timeout:7000});\n  for(const id of ["review-noise","review-evenness","review-tone","review-flow"]){\n    await page.locator("#"+id).selectOption("2");\n  }\n  await expect(page.locator("#record-clean")).toBeEnabled();\n  await page.locator("#record-clean").click();\n  await expect(page.locator("#record-status")).toContainText("記録と録音");\n  const stored=await page.evaluate(async()=>{\n    const {createPracticeStore}=await import("./core/practice-store.js");\n    const store=createPracticeStore(indexedDB);\n    return {attempts:await store.all(),recordings:await store.allRecordings()};\n  });\n  expect(stored.attempts).toHaveLength(1);\n  expect(stored.recordings).toHaveLength(1);\n  expect(stored.attempts[0].conditions.focusMode).toBe("execution");\n  expect(stored.recordings[0].attemptId).toBe(stored.attempts[0].id);\n  expect(stored.attempts[0].reported.review).toEqual({noise:2,evenness:2,tone:2,flow:2});\n  expect(await page.evaluate(()=>window.__trackStops)).toBe(1);\n});\n\ntest("integrated focus preserves the ordinary phrase-practice save path",async({page})=>{\n  await open(page);\n  await page.locator("#range-one").click();\n  await page.locator("#focus-mode").selectOption("integrated");\n  await page.locator("#play").click();\n  await expect(page.locator("#record-repeat")).toBeEnabled({timeout:7000});\n  await page.locator("#record-repeat").click();\n  await expect(page.locator("#record-status")).toContainText("保存しました");\n  const [saved]=await attempts(page);\n  expect(saved.conditions.focusMode).toBe("integrated");\n  expect(saved.observed.transportCompleted).toBe(true);\n});\n`;

const focusPath="tests/focus.spec.mjs";
let focus=await readFile(focusPath,"utf8");
if(focus.includes('execution focus records, self-reviews')) throw new Error("extra focus E2E already added");
focus=focus.trimEnd()+extraTests+"\n";
await writeFile(focusPath,focus);

// Changed app-shell assets must invalidate the previous service-worker cache.
await replaceOnce(
  "sw.js",
  'const CACHE_NAME = "fingerstyle-practice-v15";',
  'const CACHE_NAME = "fingerstyle-practice-v16";'
);

for(const path of ["phrase.js","tests/focus.spec.mjs","sw.js"]){
  const text=await readFile(path,"utf8");
  await writeFile(path,text.trimEnd()+"\n");
}
