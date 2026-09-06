import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function setTempo(page,value=160){
  await page.locator("#tempo").evaluate((element,bpm)=>{element.value=String(bpm);element.dispatchEvent(new Event("input",{bubbles:true}));},value);
}

async function open(page){
  await page.goto("/phrase.html");
  await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
  await page.locator("#follow-toggle").click();
  await setTempo(page);
}

async function attempts(page){
  return page.evaluate(async()=>{const {createPracticeStore}=await import("./core/practice-store.js");return createPracticeStore(indexedDB).all();});
}

async function finishReading(page){
  for(let guard=0;guard<64;guard++){
    await page.locator("#reading-reveal").click();
    const last=await page.locator("#reading-next").textContent();
    await page.locator("#reading-next").click();
    if(last?.includes("確認を完了")) return;
  }
  throw new Error("reading focus did not finish");
}

test("focus selector exposes four modes and reading saves reported success without transport completion",async({page})=>{
  await open(page);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator("#focus-mode option")).toHaveCount(4);
  expect(await page.locator("#focus-mode option").evaluateAll(options=>options.map(option=>option.value))).toEqual(["reading","rhythm","execution","integrated"]);
  await page.locator("#range-one").click();
  await page.locator("#focus-mode").selectOption("reading");
  await expect(page.locator("#reading-focus")).toBeVisible();
  await expect(page.locator("#tab-panel")).toBeHidden();
  await expect(page.locator(".note-trainer")).toBeHidden();
  await expect(page.locator("#record-play")).toBeDisabled();
  await expect(page.locator("#record-clean")).toBeDisabled();
  await expect(page.locator("#play")).toBeDisabled();
  await page.locator("#reading-reveal").click();
  await expect(page.locator("#reading-answer")).toBeVisible();
  await expect(page.locator("#reading-answer")).toContainText("度");
  await page.locator("#reading-next").click();
  await finishReading(page);
  await expect(page.locator("#record-clean")).toBeEnabled();
  await page.locator("#record-clean").click();
  await expect(page.locator("#record-status")).toContainText("保存しました");
  const [saved]=await attempts(page);
  expect(saved.conditions.focusMode).toBe("reading");
  expect(saved.observed.transportCompleted).toBe(false);
  expect(saved.reported.clean).toBe(true);
  await expect(page.locator("#reading-answer")).toBeHidden();
  await page.locator("summary").click();
  const downloadPromise=page.waitForEvent("download");
  await page.locator("#export-practice").click();
  const download=await downloadPromise;
  const json=(await readFile(await download.path())).toString();
  const backup=JSON.parse(json);
  expect(backup.version).toBe(1);
  expect(backup.attempts[0].conditions.focusMode).toBe("reading");
  expect(json).not.toContain("\"blob\"");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator("#focus-mode")).toHaveValue("reading");
  await page.locator("summary").click();
  await expect(page.locator("#attempt-list")).toContainText("譜読み");
});

test("rhythm focus schedules neutral guide tones instead of phrase pitches",async({page})=>{
  await page.addInitScript(()=>{
    window.__tones=[];
    const setValue=AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime=function(value,time){this.__scheduledValue=value;return setValue.call(this,value,time);};
    const start=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(time){window.__tones.push({type:this.type,frequency:this.frequency.__scheduledValue,time});return start.call(this,time);};
  });
  await open(page);
  await page.locator("#sound-mode-toggle").click();
  await page.locator("#range-one").click();
  await page.locator("#focus-mode").selectOption("rhythm");
  await page.locator("#loop").click();
  await expect(page.locator("#focus-description")).toContainText("中立音");
  await page.locator("#play").click();
  await expect.poll(()=>page.evaluate(()=>window.__tones.filter(tone=>tone.type==="square").length)).toBeGreaterThan(0);
  await expect(page.locator("#practice-status")).toContainText("2回目",{timeout:7000});
  await page.locator("#stop").click();
  const tones=await page.evaluate(()=>window.__tones);
  const guides=tones.filter(tone=>tone.type==="square");
  expect(guides.every(tone=>tone.frequency===880)).toBe(true);
  expect(tones.some(tone=>tone.type==="triangle")).toBe(false);
});

test("execution focus lowers note-name load and saves a distinct Attempt condition",async({page})=>{
  await open(page);
  await page.locator("#range-one").click();
  await page.locator("#focus-mode").selectOption("execution");
  await expect(page.locator("#note-name")).toBeHidden();
  await page.locator("#play").click();
  await expect(page.locator("#record-repeat")).toBeEnabled({timeout:7000});
  await page.locator("#record-repeat").click();
  await expect(page.locator("#record-status")).toContainText("保存しました");
  const [saved]=await attempts(page);
  expect(saved.conditions.focusMode).toBe("execution");
  expect(saved.reported.clean).toBe(false);
});

test("same phrase range and tempo keeps four focus histories separate and diagnoses execution candidate",async({page})=>{
  await open(page);
  await page.locator("#range-one").click();
  await page.evaluate(async()=>{
    const [{createPracticeStore},{validateAttempt}]=await Promise.all([import("./core/practice-store.js"),import("./core/practice.js")]);
    const phraseId=(await (await fetch("./data/phrases.json")).json()).phrases[0].id;
    const store=createPracticeStore(indexedDB);
    const values=[
      ["reading",true,false],["rhythm",true,true],["execution",false,true],["integrated",false,true]
    ];
    for(let index=0;index<values.length;index++){
      const [focusMode,clean,transportCompleted]=values[index];
      await store.saveAttempt(validateAttempt({
        id:"focus-"+focusMode,phraseId,date:new Date(Date.now()+index*1000).toISOString(),
        conditions:{tempo:160,start:1,end:1,assist:"full",melody:true,countIn:0,backing:["chords","bass","drums"],focusMode},
        observed:{transportCompleted,completedLoops:transportCompleted?1:0,elapsedSec:2},reported:{clean}
      }));
    }
  });
  await page.reload();
  await expect(page.locator("#focus-diagnosis-text")).toContainText("主ボトルネック候補: 演奏動作");
  await expect(page.locator('[data-focus-status="execution"]')).toContainText("要復習");
  await expect(page.locator('[data-focus-status="integrated"]')).toContainText("要復習");
  await page.locator("summary").click();
  await expect(page.locator("#attempt-list li")).toHaveCount(4);
  await expect(page.locator("#attempt-list")).toContainText("譜読み");
  await expect(page.locator("#attempt-list")).toContainText("リズム");
  await expect(page.locator("#attempt-list")).toContainText("演奏動作");
  await expect(page.locator("#attempt-list")).toContainText("統合演奏");
});

test("legacy version 1 backup imports as integrated",async({page})=>{
  await open(page);
  const legacy={format:"guitar-phrase-practice",version:1,attempts:[{
    id:"legacy-focus",phraseId:"legacy",date:"2026-09-05T00:00:00Z",
    conditions:{tempo:80,start:1,end:1,assist:"full",melody:true,countIn:0,backing:[]},
    observed:{transportCompleted:true,completedLoops:1,elapsedSec:4},reported:{clean:true}
  }]};
  await page.locator("#practice-file").setInputFiles({name:"legacy.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(legacy))});
  await expect(page.locator("#record-status")).toContainText("記録を読み込みました");
  const stored=await attempts(page);
  expect(stored.find(item=>item.id==="legacy-focus").conditions.focusMode).toBe("integrated");
});

test("changing focus stops active recording and releases the track once",async({page})=>{
  await page.addInitScript(()=>{
    window.__trackStops=0;
    const track={stop(){window.__trackStops++;},getSettings(){return {};}};
    const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>stream}});
    class FakeMediaRecorder extends EventTarget{
      static isTypeSupported(){return false;}
      constructor(){super();this.mimeType="audio/fake";this.state="inactive";}
      start(){this.state="recording";}
      stop(){this.state="inactive";this.dispatchEvent(new Event("stop"));}
    }
    Object.defineProperty(window,"MediaRecorder",{configurable:true,value:FakeMediaRecorder});
  });
  await open(page);
  await page.locator("#loop").click();
  await page.locator("#focus-mode").selectOption("execution");
  await page.locator("#record-play").click();
  await expect(page.locator("#recording-status")).toContainText("録音中");
  await page.locator("#focus-mode").selectOption("integrated");
  await expect.poll(()=>page.evaluate(()=>window.__trackStops)).toBe(1);
  await expect(page.locator("#play")).toBeEnabled();
});

test("execution focus records, self-reviews, and persists recording with the same Attempt ID",async({page})=>{
  await page.addInitScript(()=>{
    window.__trackStops=0;
    const track={stop(){window.__trackStops++;},getSettings(){return {sampleRate:48000,channelCount:1};}};
    const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>stream}});
    class FakeMediaRecorder extends EventTarget{
      static isTypeSupported(type){return type==="audio/webm;codecs=opus";}
      constructor(input,options={}){super();this.stream=input;this.mimeType=options.mimeType||"audio/fake";this.state="inactive";}
      start(){this.state="recording";}
      stop(){
        if(this.state!=="recording") throw new DOMException("inactive","InvalidStateError");
        this.state="inactive";
        const event=new Event("dataavailable");
        Object.defineProperty(event,"data",{value:new Blob(["execution"],{type:this.mimeType})});
        this.dispatchEvent(event);
        this.dispatchEvent(new Event("stop"));
      }
    }
    Object.defineProperty(window,"MediaRecorder",{configurable:true,value:FakeMediaRecorder});
  });
  await open(page);
  await page.locator("#range-one").click();
  await page.locator("#focus-mode").selectOption("execution");
  await page.locator("#record-play").click();
  await expect(page.locator("#recording-monitor")).toBeVisible({timeout:7000});
  for(const id of ["review-noise","review-evenness","review-tone","review-flow"]){
    await page.locator("#"+id).selectOption("2");
  }
  await expect(page.locator("#record-clean")).toBeEnabled();
  await page.locator("#record-clean").click();
  await expect(page.locator("#record-status")).toContainText("記録と録音");
  const stored=await page.evaluate(async()=>{
    const {createPracticeStore}=await import("./core/practice-store.js");
    const store=createPracticeStore(indexedDB);
    return {attempts:await store.all(),recordings:await store.allRecordings()};
  });
  expect(stored.attempts).toHaveLength(1);
  expect(stored.recordings).toHaveLength(1);
  expect(stored.attempts[0].conditions.focusMode).toBe("execution");
  expect(stored.recordings[0].attemptId).toBe(stored.attempts[0].id);
  expect(stored.attempts[0].reported.review).toEqual({noise:2,evenness:2,tone:2,flow:2});
  expect(await page.evaluate(()=>window.__trackStops)).toBe(1);
});

test("integrated focus preserves the ordinary phrase-practice save path",async({page})=>{
  await open(page);
  await page.locator("#range-one").click();
  await page.locator("#focus-mode").selectOption("integrated");
  await page.locator("#play").click();
  await expect(page.locator("#record-repeat")).toBeEnabled({timeout:7000});
  await page.locator("#record-repeat").click();
  await expect(page.locator("#record-status")).toContainText("保存しました");
  const [saved]=await attempts(page);
  expect(saved.conditions.focusMode).toBe("integrated");
  expect(saved.observed.transportCompleted).toBe(true);
});

test("changing focus stops active transport and discards the previous pending Attempt",async({page})=>{
  await open(page);
  await page.locator("#range-one").click();
  await page.locator("#loop").click();
  await page.locator("#play").click();
  await expect(page.locator("#stop")).toBeEnabled();
  await page.locator("#focus-mode").selectOption("rhythm");
  await expect(page.locator("#stop")).toBeDisabled();
  await expect(page.locator("#record-clean")).toBeDisabled();
  await expect(page.locator("#record-repeat")).toBeDisabled();
  expect(await attempts(page)).toHaveLength(0);
});
