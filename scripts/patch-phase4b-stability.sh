#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path

path=Path("calibration-ui.js")
text=path.read_text()
old='''  async function unavailableObservation(){\n    const AudioContextCtor=window.AudioContext||window.webkitAudioContext;\n    if(!AudioContextCtor) return {state:"unmeasurable",reason:"Web Audio APIを利用できません。"};\n    let context;\n    try{\n      context=new AudioContextCtor();\n      const observations=observeWebAudioLatency(context);\n      const parts=[];\n      if(observations.baseLatencyMs!=null) parts.push("baseLatency="+observations.baseLatencyMs.toFixed(1)+"ms");\n      if(observations.outputLatencyMs!=null) parts.push("outputLatency="+observations.outputLatencyMs.toFixed(1)+"ms");\n      return {state:"unmeasurable",reason:"本番用onset collectorは未実装です。"+(parts.length?" API観測: "+parts.join(" / "):"")};\n    }finally{\n      if(context&&typeof context.close==="function") await context.close().catch(()=>{});\n    }\n  }\n'''
new='''  async function unavailableObservation(){\n    const AudioContextCtor=window.AudioContext||window.webkitAudioContext;\n    if(!AudioContextCtor) return {state:"unmeasurable",reason:"Web Audio APIを利用できません。"};\n    // A real collector is intentionally not synthesized here. Creating an\n    // AudioContext only to fabricate a calibration path would blur the\n    // distinction between API capability and a measured acoustic event.\n    return {state:"unmeasurable",reason:"本番用onset collectorは未実装です。Web Audio API自体は利用可能です。"};\n  }\n'''
if old not in text:
    raise SystemExit("unavailableObservation block not found")
text=text.replace(old,new,1)
text=text.replace('import { observeWebAudioLatency } from "./core/measurement.js";\n','',1)
old='''  $("calibration-path").addEventListener("change",()=>void refresh());\n  $("calibration-start").addEventListener("click",()=>void startCalibration());\n  void refresh().catch(error=>renderState("unmeasurable",error?.message||"校正記録を読み込めませんでした。"));\n})();\n'''
new='''  const details=$("calibration-details");\n  details.addEventListener("toggle",()=>{\n    if(details.open) void refresh().catch(error=>renderState("unmeasurable",error?.message||"校正記録を読み込めませんでした。"));\n  });\n  $("calibration-path").addEventListener("change",()=>{\n    if(details.open) void refresh().catch(error=>renderState("unmeasurable",error?.message||"校正記録を読み込めませんでした。"));\n  });\n  $("calibration-start").addEventListener("click",()=>void startCalibration());\n})();\n'''
if old not in text:
    raise SystemExit("calibration UI listeners not found")
path.write_text(text)

path=Path("tests/calibration.spec.mjs")
text=path.read_text()
append='''\n\ntest("v2 database upgrades to v3 without losing attempts or recordings",async({page})=>{\n  await page.goto("/index.html");\n  await page.evaluate(async()=>{\n    await new Promise((resolve,reject)=>{\n      const remove=indexedDB.deleteDatabase("guitar-phrase-practice");\n      remove.onsuccess=()=>resolve();\n      remove.onerror=()=>reject(remove.error);\n      remove.onblocked=()=>reject(new Error("database deletion blocked"));\n    });\n    await new Promise((resolve,reject)=>{\n      const request=indexedDB.open("guitar-phrase-practice",2);\n      request.onupgradeneeded=()=>{\n        const db=request.result;\n        db.createObjectStore("attempts",{keyPath:"id"});\n        db.createObjectStore("recordings",{keyPath:"attemptId"});\n      };\n      request.onerror=()=>reject(request.error);\n      request.onsuccess=()=>{\n        const db=request.result;\n        const tx=db.transaction(["attempts","recordings"],"readwrite");\n        tx.objectStore("attempts").add({\n          id:"v2-attempt",phraseId:"legacy",date:"2026-09-06T00:00:00Z",\n          conditions:{tempo:80,start:1,end:1,assist:"full",melody:true,countIn:0,backing:[],focusMode:"integrated"},\n          observed:{transportCompleted:true,completedLoops:1,elapsedSec:3},reported:{clean:true}\n        });\n        const blob=new Blob(["abc"],{type:"audio/webm"});\n        tx.objectStore("recordings").add({attemptId:"v2-attempt",createdAt:"2026-09-06T00:00:00Z",mimeType:"audio/webm",size:blob.size,blob,settings:{sampleRate:48000,channelCount:1}});\n        tx.oncomplete=()=>{db.close();resolve();};\n        tx.onerror=()=>reject(tx.error);\n        tx.onabort=()=>reject(tx.error);\n      };\n    });\n  });\n\n  await page.goto("/phrase.html");\n  await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");\n  const result=await page.evaluate(async()=>{\n    const {PRACTICE_DB_VERSION,createPracticeStore}=await import("./core/practice-store.js");\n    const store=createPracticeStore(indexedDB);\n    return {version:PRACTICE_DB_VERSION,attempts:await store.all(),recordings:await store.allRecordings(),calibrations:await store.allCalibrations()};\n  });\n  expect(result.version).toBe(3);\n  expect(result.attempts.find(item=>item.id==="v2-attempt")?.reported.clean).toBe(true);\n  expect(result.recordings.find(item=>item.attemptId==="v2-attempt")?.size).toBe(3);\n  expect(result.calibrations).toEqual([]);\n});\n'''
if 'test("v2 database upgrades to v3 without losing attempts or recordings"' not in text:
    text += append
path.write_text(text)
PY
