import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function installFakeRecorder(page,{denied=false}={}){
  await page.addInitScript(({denied})=>{
    window.__gumCalls=0;
    window.__trackStops=0;
    window.__recorders=[];
    const track={
      stop(){window.__trackStops+=1;},
      getSettings(){return {sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false};}
    };
    const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{
      async getUserMedia(constraints){
        window.__gumCalls+=1;
        window.__gumConstraints=constraints;
        if(denied){
          const error=new DOMException("denied","NotAllowedError");
          throw error;
        }
        return stream;
      }
    }});
    class FakeMediaRecorder extends EventTarget{
      static isTypeSupported(type){return type==="audio/webm;codecs=opus";}
      constructor(input,options={}){
        super();
        this.stream=input;
        this.mimeType=options.mimeType||"audio/fake";
        this.state="inactive";
        window.__recorders.push(this);
      }
      start(){this.state="recording";}
      stop(){
        if(this.state!=="recording") throw new DOMException("inactive","InvalidStateError");
        this.state="inactive";
        const dataEvent=new Event("dataavailable");
        Object.defineProperty(dataEvent,"data",{value:new Blob(["guitar"],{type:this.mimeType})});
        this.dispatchEvent(dataEvent);
        this.dispatchEvent(new Event("stop"));
      }
    }
    Object.defineProperty(window,"MediaRecorder",{configurable:true,value:FakeMediaRecorder});
  },{denied});
}

async function openPractice(page,{denied=false}={}){
  await installFakeRecorder(page,{denied});
  await page.goto("/phrase.html");
  await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
  await page.locator("#follow-toggle").click();
  await page.locator("#tempo").evaluate(element=>{
    element.value="160";
    element.dispatchEvent(new Event("input",{bubbles:true}));
  });
}

async function fillReview(page){
  for(const id of ["review-noise","review-evenness","review-tone","review-flow"]){
    await page.locator("#"+id).selectOption("2");
  }
}

async function storedRecordingState(page){
  return page.evaluate(async()=>{
    const {createPracticeStore}=await import("./core/practice-store.js");
    const store=createPracticeStore(indexedDB);
    const attempts=await store.all();
    const recordings=await store.allRecordings();
    return {
      attempts,
      recordings:recordings.map(({attemptId,mimeType,size,settings})=>({attemptId,mimeType,size,settings}))
    };
  });
}

test("page load never requests microphone and explicit recording can be stopped and replayed",async({page})=>{
  await openPractice(page);
  expect(await page.evaluate(()=>window.__gumCalls)).toBe(0);
  await page.locator("#loop").click();
  await page.locator("#record-play").click();
  await expect(page.locator("#recording-status")).toContainText("録音中");
  expect(await page.evaluate(()=>window.__gumCalls)).toBe(1);
  expect(await page.evaluate(()=>window.__gumConstraints)).toEqual({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  await page.waitForTimeout(250);
  await page.locator("#stop").click();
  await expect(page.locator("#recording-monitor")).toBeVisible();
  await expect(page.locator("#recording-player")).toHaveAttribute("src",/^blob:/);
  expect(await page.evaluate(()=>window.__trackStops)).toBe(1);
  await expect(page.locator("#record-repeat")).toBeDisabled();
  await fillReview(page);
  await expect(page.locator("#record-repeat")).toBeEnabled();
});

test("recording, self review and Attempt share one ID and survive reload",async({page})=>{
  await openPractice(page);
  await page.locator("#range-one").click();
  await page.locator("#record-play").click();
  await expect(page.locator("#recording-monitor")).toBeVisible({timeout:7000});
  await fillReview(page);
  await expect(page.locator("#record-clean")).toBeEnabled();
  await page.locator("#record-clean").click();
  await expect(page.locator("#record-status")).toContainText("記録と録音");

  const stored=await storedRecordingState(page);
  expect(stored.attempts).toHaveLength(1);
  expect(stored.recordings).toHaveLength(1);
  expect(stored.recordings[0].attemptId).toBe(stored.attempts[0].id);
  expect(stored.recordings[0].mimeType).toBe("audio/webm;codecs=opus");
  expect(stored.attempts[0].reported.review).toEqual({noise:2,evenness:2,tone:2,flow:2});

  await page.reload();
  await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
  await page.locator("details").open?.catch?.(()=>{});
  await page.locator("summary").click();
  await expect(page.locator("#attempt-list audio")).toHaveCount(1);
  await expect(page.locator("#attempt-list audio")).toHaveAttribute("src",/^blob:/);

  const downloadPromise=page.waitForEvent("download");
  await page.locator("#export-practice").click();
  const download=await downloadPromise;
  const json=(await readFile(await download.path())).toString();
  const backup=JSON.parse(json);
  expect(backup.version).toBe(1);
  expect(backup.attempts).toHaveLength(1);
  expect(json).not.toContain('"blob"');
  expect(json).not.toContain("data:audio");
  expect(backup.attempts[0].reported.review.flow).toBe(2);
});

test("permission denial leaves normal practice available",async({page})=>{
  await openPractice(page,{denied:true});
  await page.locator("#record-play").click();
  await expect(page.locator("#recording-status")).toContainText("許可されませんでした");
  expect(await page.evaluate(()=>window.__gumCalls)).toBe(1);
  await expect(page.locator("#play")).toBeEnabled();
  await page.locator("#range-one").click();
  await page.locator("#play").click();
  await expect(page.locator("#record-repeat")).toBeEnabled({timeout:7000});
  expect(await page.evaluate(()=>window.__gumCalls)).toBe(1);
});

test("pagehide releases every microphone track and repeated stop remains safe",async({page})=>{
  await openPractice(page);
  await page.locator("#loop").click();
  await page.locator("#record-play").click();
  await expect(page.locator("#recording-status")).toContainText("録音中");
  await page.evaluate(()=>{
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
  });
  await expect.poll(()=>page.evaluate(()=>window.__trackStops)).toBe(1);
  await expect(page.locator("#stop")).toBeDisabled();
});

test("practice changes stop recording tracks without disabling later normal playback",async({page})=>{
  await openPractice(page);
  const changes=[
    async()=>page.locator("#range-one").click(),
    async()=>page.locator("#assist-mode").selectOption("no-names"),
    async()=>page.locator("#backing-bass").click(),
    async()=>page.locator("#tempo").evaluate(element=>{element.value="120";element.dispatchEvent(new Event("input",{bubbles:true}));})
  ];
  for(let index=0;index<changes.length;index++){
    await page.locator("#loop").evaluate(element=>{
      if(element.getAttribute("aria-pressed")!=="true") element.click();
    });
    await page.locator("#record-play").click();
    await expect(page.locator("#recording-status")).toContainText("録音中");
    await changes[index]();
    await expect.poll(()=>page.evaluate(()=>window.__trackStops)).toBe(index+1);
    await expect(page.locator("#play")).toBeEnabled();
  }
});

test("real IndexedDB v1 data migrates to v2 without losing an Attempt",async({page})=>{
  await page.goto("/index.html");
  await page.evaluate(async()=>{
    await new Promise((resolve,reject)=>{
      const request=indexedDB.deleteDatabase("guitar-phrase-practice");
      request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>resolve();
    });
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open("guitar-phrase-practice",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("attempts",{keyPath:"id"});
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result;
        const tx=db.transaction("attempts","readwrite");
        tx.objectStore("attempts").add({
          id:"legacy",phraseId:"legacy-phrase",date:"2026-09-05T00:00:00Z",
          conditions:{tempo:80,start:1,end:1,assist:"full",melody:true,countIn:0,backing:[]},
          observed:{transportCompleted:true,completedLoops:1,elapsedSec:4},
          reported:{clean:true},assessment:{status:"provisional",basis:"reported"}
        });
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
      };
    });
  });
  await page.goto("/phrase.html");
  await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
  const migrated=await page.evaluate(async()=>{
    const {createPracticeStore}=await import("./core/practice-store.js");
    const store=createPracticeStore(indexedDB);
    const attempts=await store.all();
    const info=await new Promise((resolve,reject)=>{
      const request=indexedDB.open("guitar-phrase-practice");
      request.onsuccess=()=>{
        const db=request.result;
        resolve({version:db.version,stores:Array.from(db.objectStoreNames)});
        db.close();
      };
      request.onerror=()=>reject(request.error);
    });
    return {attempts,info};
  });
  expect(migrated.attempts.map(item=>item.id)).toContain("legacy");
  expect(migrated.info.version).toBe(2);
  expect(migrated.info.stores.sort()).toEqual(["attempts","recordings"]);
});

test("recording store failure aborts the Attempt transaction and retry saves both",async({page})=>{
  await openPractice(page);
  await page.locator("#range-one").click();
  await page.locator("#record-play").click();
  await expect(page.locator("#recording-monitor")).toBeVisible({timeout:7000});
  await fillReview(page);
  await page.evaluate(()=>{
    window.__originalAdd=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(value){
      if(this.name==="recordings") throw new DOMException("full","QuotaExceededError");
      return window.__originalAdd.call(this,value);
    };
  });
  await page.locator("#record-clean").click();
  await expect(page.locator("#record-status")).toContainText("保存容量");
  let stored=await storedRecordingState(page);
  expect(stored.attempts).toHaveLength(0);
  expect(stored.recordings).toHaveLength(0);
  await page.evaluate(()=>{IDBObjectStore.prototype.add=window.__originalAdd;});
  await page.locator("#record-clean").click();
  await expect(page.locator("#record-status")).toContainText("記録と録音");
  stored=await storedRecordingState(page);
  expect(stored.attempts).toHaveLength(1);
  expect(stored.recordings).toHaveLength(1);
  expect(stored.attempts[0].id).toBe(stored.recordings[0].attemptId);
});
