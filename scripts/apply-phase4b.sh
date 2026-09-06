#!/usr/bin/env bash
set -euo pipefail

cat > core/calibration.js <<'EOF'
export const CALIBRATION_PATH_KINDS=Object.freeze(["roundTrip","input","output"]);
export const CALIBRATION_STATUSES=Object.freeze(["calibrated","uncalibrated"]);
export const CALIBRATION_TIMEBASES=Object.freeze([
  "audio-context",
  "performance",
  "media-capture",
  "output-timestamp-context",
  "output-timestamp-performance"
]);
export const CALIBRATION_SIGN_CONVENTION="observed-minus-reference";
export const CALIBRATION_PRECISION_METHOD="mad";
export const MIN_CALIBRATION_SAMPLES=5;
export const MAX_CALIBRATION_SPREAD_MS=15;

function requireValue(condition,message){
  if(!condition) throw new Error(message);
}

function finiteNumber(value,message){
  requireValue(Number.isFinite(value),message);
  return value;
}

function validDate(value,message){
  requireValue(typeof value==="string"&&Number.isFinite(Date.parse(value)),message);
  return value;
}

function normalizeTimebaseName(value){
  requireValue(CALIBRATION_TIMEBASES.includes(value),"校正の時間基準が不正です。");
  return value;
}

function normalizeTimebase(value){
  requireValue(value&&typeof value==="object","校正の時間基準が不正です。");
  return {reference:normalizeTimebaseName(value.reference),observed:normalizeTimebaseName(value.observed)};
}

function normalizeEnvironment(value){
  requireValue(value&&typeof value==="object","校正環境が不正です。");
  const result={};
  for(const key of ["userAgentFamily","inputRoute","outputRoute"]){
    requireValue(typeof value[key]==="string"&&value[key].trim().length>0&&value[key].length<=200,"校正環境が不正です。");
    result[key]=value[key];
  }
  return result;
}

function normalizeValidity(value,createdAt){
  requireValue(value&&typeof value==="object","校正の有効期間が不正です。");
  const validFrom=validDate(value.validFrom??createdAt,"校正の有効開始日時が不正です。");
  const invalidatedAt=value.invalidatedAt==null?null:validDate(value.invalidatedAt,"校正の失効日時が不正です。");
  if(invalidatedAt) requireValue(Date.parse(invalidatedAt)>=Date.parse(validFrom),"校正の失効日時が有効開始日時より前です。");
  const reason=value.reason==null?null:value.reason;
  requireValue(reason==null||typeof reason==="string"&&reason.trim().length>0&&reason.length<=500,"校正の失効理由が不正です。");
  if(invalidatedAt) requireValue(reason,"失効した校正には理由が必要です。");
  return {validFrom,invalidatedAt,reason};
}

export function calibrationAcceptance(value){
  const sampleCount=value?.sampleCount;
  const spreadMs=value?.precision?.spreadMs;
  const method=value?.precision?.method;
  const accepted=Number.isInteger(sampleCount)&&sampleCount>=MIN_CALIBRATION_SAMPLES
    &&Number.isFinite(spreadMs)&&spreadMs>=0&&spreadMs<=MAX_CALIBRATION_SPREAD_MS
    &&method===CALIBRATION_PRECISION_METHOD;
  return {accepted,minSamples:MIN_CALIBRATION_SAMPLES,maxSpreadMs:MAX_CALIBRATION_SPREAD_MS,method:CALIBRATION_PRECISION_METHOD};
}

export function validateCalibrationRecord(value){
  requireValue(value&&typeof value==="object","校正記録の形式が不正です。");
  requireValue(typeof value.id==="string"&&value.id.trim().length>0&&value.id.length<=100,"校正IDが不正です。");
  const createdAt=validDate(value.createdAt,"校正日時が不正です。");
  requireValue(CALIBRATION_PATH_KINDS.includes(value.pathKind),"校正経路が不正です。");
  const timebase=normalizeTimebase(value.timebase);
  const offsetMs=finiteNumber(value.offsetMs,"校正offsetが不正です。");
  requireValue(value.signConvention===CALIBRATION_SIGN_CONVENTION,"校正offsetの符号規約が不正です。");
  requireValue(Number.isInteger(value.sampleCount)&&value.sampleCount>=1,"校正sampleCountが不正です。");
  requireValue(value.precision&&typeof value.precision==="object","校正precisionが不正です。");
  const spreadMs=finiteNumber(value.precision.spreadMs,"校正spreadが不正です。");
  requireValue(spreadMs>=0,"校正spreadが不正です。");
  requireValue(value.precision.method===CALIBRATION_PRECISION_METHOD,"校正precision methodが不正です。");
  const environment=normalizeEnvironment(value.environment);
  requireValue(CALIBRATION_STATUSES.includes(value.status),"校正状態が不正です。");
  const validity=normalizeValidity(value.validity,createdAt);
  const record={
    id:value.id,createdAt,pathKind:value.pathKind,timebase,offsetMs,
    signConvention:CALIBRATION_SIGN_CONVENTION,
    sampleCount:value.sampleCount,
    precision:{spreadMs,method:CALIBRATION_PRECISION_METHOD},
    environment,status:value.status,validity
  };
  if(record.status==="calibrated") requireValue(calibrationAcceptance(record).accepted,"校正品質が受け入れ条件を満たしていません。");
  return record;
}

function median(values){
  requireValue(Array.isArray(values)&&values.length>0,"校正sampleがありません。");
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}

export function calibrationFromSamples({id,createdAt,pathKind,timebase,samples,environment}){
  requireValue(Array.isArray(samples)&&samples.length>0,"校正sampleがありません。");
  const offsets=samples.map(sample=>{
    requireValue(sample&&typeof sample==="object","校正sampleが不正です。");
    const referenceMs=finiteNumber(sample.referenceMs,"校正sampleの基準時刻が不正です。");
    const observedMs=finiteNumber(sample.observedMs,"校正sampleの観測時刻が不正です。");
    return observedMs-referenceMs;
  });
  const offsetMs=median(offsets);
  const spreadMs=median(offsets.map(value=>Math.abs(value-offsetMs)));
  const draft={
    id,createdAt,pathKind,timebase,offsetMs,
    signConvention:CALIBRATION_SIGN_CONVENTION,
    sampleCount:samples.length,
    precision:{spreadMs,method:CALIBRATION_PRECISION_METHOD},
    environment,
    status:"uncalibrated",
    validity:{validFrom:createdAt,invalidatedAt:null,reason:null}
  };
  if(calibrationAcceptance(draft).accepted) draft.status="calibrated";
  return validateCalibrationRecord(draft);
}

export function validateCalibrationTarget(value){
  requireValue(value&&typeof value==="object","校正適用対象が不正です。");
  requireValue(CALIBRATION_PATH_KINDS.includes(value.pathKind),"校正適用経路が不正です。");
  return {
    pathKind:value.pathKind,
    timebase:normalizeTimebase(value.timebase),
    environment:normalizeEnvironment(value.environment),
    at:validDate(value.at,"校正適用日時が不正です。")
  };
}

export function calibrationApplies(record,target){
  const normalized=validateCalibrationRecord(record);
  const expected=validateCalibrationTarget(target);
  if(normalized.status!=="calibrated") return false;
  if(normalized.pathKind!==expected.pathKind) return false;
  if(normalized.timebase.reference!==expected.timebase.reference||normalized.timebase.observed!==expected.timebase.observed) return false;
  for(const key of ["userAgentFamily","inputRoute","outputRoute"]){
    if(normalized.environment[key]!==expected.environment[key]) return false;
  }
  const at=Date.parse(expected.at);
  if(at<Date.parse(normalized.validity.validFrom)) return false;
  if(normalized.validity.invalidatedAt&&at>=Date.parse(normalized.validity.invalidatedAt)) return false;
  return true;
}

export function correctedTime(observedTime,offsetMs){
  return finiteNumber(observedTime,"観測時刻が不正です。")-finiteNumber(offsetMs,"校正offsetが不正です。");
}

export function applyCalibrationOffset(record,target,observedTime){
  const normalized=validateCalibrationRecord(record);
  requireValue(calibrationApplies(normalized,target),"この校正記録は指定した測定経路へ適用できません。");
  return correctedTime(observedTime,normalized.offsetMs);
}

export function invalidateCalibrationRecord(record,{at,reason}){
  const normalized=validateCalibrationRecord(record);
  validDate(at,"校正の失効日時が不正です。");
  requireValue(typeof reason==="string"&&reason.trim().length>0&&reason.length<=500,"校正の失効理由が不正です。");
  return validateCalibrationRecord({
    ...normalized,
    status:"uncalibrated",
    validity:{...normalized.validity,invalidatedAt:at,reason}
  });
}
EOF

cat > core/measurement.js <<'EOF'
import { CALIBRATION_TIMEBASES } from "./calibration.js";

export const MEASUREMENT_STATES=Object.freeze(["measured","uncalibrated","unmeasurable"]);

function requireValue(condition,message){
  if(!condition) throw new Error(message);
}

function normalizeTimebase(value,{optional=false}={}){
  if(value==null&&optional) return null;
  requireValue(CALIBRATION_TIMEBASES.includes(value),"測定結果の時間基準が不正です。");
  return value;
}

export function validateMeasurementResult(value){
  requireValue(value&&typeof value==="object","測定結果の形式が不正です。");
  requireValue(typeof value.metric==="string"&&value.metric.trim().length>0&&value.metric.length<=100,"測定metricが不正です。");
  requireValue(MEASUREMENT_STATES.includes(value.state),"測定状態が不正です。");
  requireValue(typeof value.unit==="string"&&value.unit.trim().length>0&&value.unit.length<=40,"測定単位が不正です。");
  const unavailable=value.state==="unmeasurable";
  const resultValue=unavailable?null:value.value;
  if(unavailable){
    requireValue(value.value==null,"測定不能な結果を0や推定値で埋めてはいけません。");
  }else{
    requireValue(Number.isFinite(resultValue),"測定値が不正です。");
  }
  const timebase=normalizeTimebase(value.timebase,{optional:unavailable});
  const calibrationId=value.calibrationId==null?null:value.calibrationId;
  requireValue(calibrationId==null||typeof calibrationId==="string"&&calibrationId.trim().length>0&&calibrationId.length<=100,"測定結果の校正IDが不正です。");
  if(value.state==="uncalibrated") requireValue(calibrationId==null,"未校正結果へ校正IDを付けてはいけません。");
  const reason=value.reason==null?null:value.reason;
  if(value.state!=="measured") requireValue(typeof reason==="string"&&reason.trim().length>0&&reason.length<=500,"未校正・測定不能には理由が必要です。");
  if(value.state==="measured") requireValue(reason==null||typeof reason==="string"&&reason.length<=500,"測定理由が不正です。");
  return {metric:value.metric,state:value.state,value:resultValue,unit:value.unit,timebase,calibrationId,reason};
}

export function unmeasurableMeasurement({metric,unit,timebase=null,reason}){
  return validateMeasurementResult({metric,state:"unmeasurable",value:null,unit,timebase,calibrationId:null,reason});
}

export function uncalibratedMeasurement({metric,value,unit,timebase,reason}){
  return validateMeasurementResult({metric,state:"uncalibrated",value,unit,timebase,calibrationId:null,reason});
}

export function measuredMeasurement({metric,value,unit,timebase,calibrationId=null,reason=null}){
  return validateMeasurementResult({metric,state:"measured",value,unit,timebase,calibrationId,reason});
}

// Browser-reported latency fields are observations with distinct semantics.
// Never collapse them into one "true output latency" value here.
export function observeWebAudioLatency(audioContext){
  const result={baseLatencyMs:null,outputLatencyMs:null,outputTimestamp:null};
  if(!audioContext||typeof audioContext!=="object") return result;
  if(Number.isFinite(audioContext.baseLatency)&&audioContext.baseLatency>=0) result.baseLatencyMs=audioContext.baseLatency*1000;
  if(Number.isFinite(audioContext.outputLatency)&&audioContext.outputLatency>=0) result.outputLatencyMs=audioContext.outputLatency*1000;
  if(typeof audioContext.getOutputTimestamp==="function"){
    try{
      const value=audioContext.getOutputTimestamp();
      if(value&&Number.isFinite(value.contextTime)&&Number.isFinite(value.performanceTime)){
        result.outputTimestamp={contextTime:value.contextTime,performanceTime:value.performanceTime};
      }
    }catch{}
  }
  return result;
}
EOF

cat > core/practice-store.js <<'EOF'
import { invalidateCalibrationRecord, validateCalibrationRecord } from "./calibration.js";
import { validateAttempt } from "./practice.js";

export const PRACTICE_DB_NAME="guitar-phrase-practice";
export const PRACTICE_DB_VERSION=3;

function hasStore(db,name){
  return typeof db.objectStoreNames?.contains==="function"
    ?db.objectStoreNames.contains(name)
    :Array.from(db.objectStoreNames??[]).includes(name);
}

export function upgradePracticeDatabase(db){
  if(!hasStore(db,"attempts")) db.createObjectStore("attempts",{keyPath:"id"});
  if(!hasStore(db,"recordings")) db.createObjectStore("recordings",{keyPath:"attemptId"});
  if(!hasStore(db,"calibrations")) db.createObjectStore("calibrations",{keyPath:"id"});
}

function normalizeRecording(value,attemptId=value?.attemptId){
  if(!value||typeof value!=="object") throw new Error("録音データの形式が不正です。");
  if(typeof attemptId!=="string"||!attemptId||value.attemptId!==attemptId) throw new Error("録音と練習記録のIDが一致しません。");
  if(typeof value.createdAt!=="string"||!Number.isFinite(Date.parse(value.createdAt))) throw new Error("録音日時が不正です。");
  if(typeof value.mimeType!=="string"||value.mimeType.length>200) throw new Error("録音形式が不正です。");
  if(!value.blob||typeof value.blob.size!=="number"||value.blob.size<0) throw new Error("録音本体が不正です。");
  if(!Number.isFinite(value.size)||value.size<0||value.size!==value.blob.size) throw new Error("録音サイズが不正です。");
  const settings={};
  for(const key of ["sampleRate","channelCount","echoCancellation","noiseSuppression","autoGainControl"]){
    if(value.settings?.[key]!==undefined) settings[key]=value.settings[key];
  }
  return {attemptId,createdAt:value.createdAt,mimeType:value.mimeType,size:value.size,blob:value.blob,settings};
}

// The caller supplies IndexedDB so this adapter has no browser globals.
export function createPracticeStore(indexedDB){
  let opening;
  function open(){
    if(!indexedDB) return Promise.reject(new Error("この環境では練習記録を保存できません。"));
    if(!opening){
      opening=new Promise((resolve,reject)=>{
        const request=indexedDB.open(PRACTICE_DB_NAME,PRACTICE_DB_VERSION);
        request.onupgradeneeded=()=>upgradePracticeDatabase(request.result);
        request.onerror=()=>reject(request.error);
        request.onblocked=()=>reject(new Error("他のタブを閉じて記録を再読み込みしてください。"));
        request.onsuccess=()=>{
          const db=request.result;
          db.onversionchange=()=>{db.close();opening=null;};
          resolve(db);
        };
      }).catch(error=>{opening=null;throw error;});
    }
    return opening;
  }

  async function all(){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction("attempts","readonly");
      const request=transaction.objectStore("attempts").getAll();
      transaction.oncomplete=()=>{
        try{resolve(request.result.map(validateAttempt));}catch(error){reject(error);}
      };
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  async function addMany(values){
    const records=values.map(validateAttempt);
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction("attempts","readwrite");
      const store=transaction.objectStore("attempts");
      // Existing IDs win; importing the same backup never overwrites history.
      for(const record of records){
        const request=store.get(record.id);
        request.onsuccess=()=>{
          try{if(!request.result) store.add(record);}catch(error){transaction.abort();reject(error);}
        };
      }
      transaction.oncomplete=()=>resolve();
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  async function saveAttempt(value,recording=null){
    const attempt=validateAttempt(value);
    const audio=recording?normalizeRecording(recording,attempt.id):null;
    const db=await open();
    return new Promise((resolve,reject)=>{
      const names=audio?["attempts","recordings"]:["attempts"];
      const transaction=db.transaction(names,"readwrite");
      try{
        transaction.objectStore("attempts").add(attempt);
        if(audio) transaction.objectStore("recordings").add(audio);
      }catch(error){
        try{transaction.abort();}catch{}
        reject(error);
        return;
      }
      transaction.oncomplete=()=>resolve(attempt);
      transaction.onabort=()=>reject(transaction.error??new Error("練習記録の保存を中止しました。"));
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  async function recording(attemptId){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction("recordings","readonly");
      const request=transaction.objectStore("recordings").get(attemptId);
      transaction.oncomplete=()=>{
        try{resolve(request.result?normalizeRecording(request.result,attemptId):null);}catch(error){reject(error);}
      };
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  async function allRecordings(){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction("recordings","readonly");
      const request=transaction.objectStore("recordings").getAll();
      transaction.oncomplete=()=>{
        try{resolve(request.result.map(item=>normalizeRecording(item,item.attemptId)));}catch(error){reject(error);}
      };
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  async function deleteRecording(attemptId){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction("recordings","readwrite");
      transaction.objectStore("recordings").delete(attemptId);
      transaction.oncomplete=()=>resolve();
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  async function allCalibrations(){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction("calibrations","readonly");
      const request=transaction.objectStore("calibrations").getAll();
      transaction.oncomplete=()=>{
        try{resolve(request.result.map(validateCalibrationRecord));}catch(error){reject(error);}
      };
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  async function calibration(id){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction("calibrations","readonly");
      const request=transaction.objectStore("calibrations").get(id);
      transaction.oncomplete=()=>{
        try{resolve(request.result?validateCalibrationRecord(request.result):null);}catch(error){reject(error);}
      };
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  async function saveCalibration(value){
    const record=validateCalibrationRecord(value);
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction("calibrations","readwrite");
      transaction.objectStore("calibrations").put(record);
      transaction.oncomplete=()=>resolve(record);
      transaction.onabort=()=>reject(transaction.error);
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  async function invalidateCalibration(id,{at,reason}){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction("calibrations","readwrite");
      const store=transaction.objectStore("calibrations");
      const request=store.get(id);
      let updated=null;
      request.onsuccess=()=>{
        try{
          if(!request.result) throw new Error("失効対象の校正記録がありません。");
          updated=invalidateCalibrationRecord(request.result,{at,reason});
          store.put(updated);
        }catch(error){
          try{transaction.abort();}catch{}
          reject(error);
        }
      };
      transaction.oncomplete=()=>resolve(updated);
      transaction.onabort=()=>reject(transaction.error??new Error("校正記録の失効を中止しました。"));
      transaction.onerror=()=>reject(transaction.error);
    });
  }

  return {all,addMany,saveAttempt,recording,allRecordings,deleteRecording,allCalibrations,calibration,saveCalibration,invalidateCalibration};
}
EOF

cat > calibration-ui.js <<'EOF'
import { MIN_CALIBRATION_SAMPLES, calibrationApplies, calibrationFromSamples, validateCalibrationTarget } from "./core/calibration.js";
import { observeWebAudioLatency } from "./core/measurement.js";
import { createPracticeStore } from "./core/practice-store.js";

(() => {
  "use strict";

  const $=id=>document.getElementById(id);
  if(!$("calibration-details")) return;

  const TIMEBASES=Object.freeze({
    roundTrip:{reference:"audio-context",observed:"audio-context"},
    input:{reference:"performance",observed:"media-capture"},
    output:{reference:"audio-context",observed:"output-timestamp-performance"}
  });
  const store=createPracticeStore(indexedDB);
  let calibrations=[];

  function userAgentFamily(){
    const value=navigator.userAgent||"";
    if(/Firefox/i.test(value)) return "firefox";
    if(/Edg\//i.test(value)) return "edge";
    if(/Chrome|Chromium/i.test(value)) return "chromium";
    if(/Safari/i.test(value)) return "safari";
    return "unknown-browser";
  }

  function injectedCollector(){
    const value=window.__calibrationCollector;
    return value&&typeof value.collect==="function"?value:null;
  }

  function environment(){
    const base={userAgentFamily:userAgentFamily(),inputRoute:"default-input",outputRoute:"default-output"};
    const override=injectedCollector()?.environment;
    return override&&typeof override==="object"?{...base,...override}:base;
  }

  function target(){
    const pathKind=$("calibration-path").value;
    return validateCalibrationTarget({pathKind,timebase:TIMEBASES[pathKind],environment:environment(),at:new Date().toISOString()});
  }

  function renderState(state,detail){
    const host=$("calibration-state");
    host.dataset.state=state;
    const labels={calibrated:"校正済み",uncalibrated:"未校正",unmeasurable:"測定不能"};
    $("calibration-state-label").textContent=labels[state];
    $("calibration-state-detail").textContent=detail;
  }

  function sameTargetShape(record,expected){
    if(record.pathKind!==expected.pathKind) return false;
    if(record.timebase.reference!==expected.timebase.reference||record.timebase.observed!==expected.timebase.observed) return false;
    return ["userAgentFamily","inputRoute","outputRoute"].every(key=>record.environment[key]===expected.environment[key]);
  }

  async function refresh(){
    calibrations=await store.allCalibrations();
    const expected=target();
    const latest=[...calibrations].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).find(record=>sameTargetShape(record,expected));
    const applicable=calibrations.find(record=>calibrationApplies(record,expected));
    if(applicable){
      renderState("calibrated","offset "+applicable.offsetMs.toFixed(1)+" ms / MAD "+applicable.precision.spreadMs.toFixed(1)+" ms / "+applicable.sampleCount+" samples");
      return;
    }
    if(latest){
      renderState("uncalibrated","この経路の最新校正は適用できません。MAD "+latest.precision.spreadMs.toFixed(1)+" ms");
      return;
    }
    renderState("uncalibrated","この経路へ適用できる校正記録はありません。");
  }

  async function unavailableObservation(){
    const AudioContextCtor=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextCtor) return {state:"unmeasurable",reason:"Web Audio APIを利用できません。"};
    let context;
    try{
      context=new AudioContextCtor();
      const observations=observeWebAudioLatency(context);
      const parts=[];
      if(observations.baseLatencyMs!=null) parts.push("baseLatency="+observations.baseLatencyMs.toFixed(1)+"ms");
      if(observations.outputLatencyMs!=null) parts.push("outputLatency="+observations.outputLatencyMs.toFixed(1)+"ms");
      return {state:"unmeasurable",reason:"本番用onset collectorは未実装です。"+(parts.length?" API観測: "+parts.join(" / "):"")};
    }finally{
      if(context&&typeof context.close==="function") await context.close().catch(()=>{});
    }
  }

  async function startCalibration(){
    const button=$("calibration-start");
    button.disabled=true;
    $("calibration-status").textContent="校正を確認しています…";
    try{
      const expected=target();
      const collector=injectedCollector();
      const result=collector
        ?await collector.collect({pathKind:expected.pathKind,timebase:expected.timebase,environment:expected.environment,sampleCount:MIN_CALIBRATION_SAMPLES})
        :await unavailableObservation();
      if(!result||result.state==="unmeasurable"){
        renderState("unmeasurable",result?.reason||"校正に必要な観測値を取得できませんでした。");
        $("calibration-status").textContent="測定不能です。架空のoffsetは保存しません。";
        return;
      }
      const record=calibrationFromSamples({
        id:crypto.randomUUID(),createdAt:new Date().toISOString(),pathKind:expected.pathKind,
        timebase:result.timebase??expected.timebase,
        samples:result.samples,
        environment:result.environment??expected.environment
      });
      await store.saveCalibration(record);
      $("calibration-status").textContent=record.status==="calibrated"?"校正記録を保存しました。":"ばらつきが大きいため未校正として保存しました。";
      await refresh();
    }catch(error){
      renderState("unmeasurable",error?.message||"校正処理に失敗しました。");
      $("calibration-status").textContent="校正処理に失敗しました。";
    }finally{
      button.disabled=false;
    }
  }

  $("calibration-path").addEventListener("change",()=>void refresh());
  $("calibration-start").addEventListener("click",()=>void startCalibration());
  void refresh().catch(error=>renderState("unmeasurable",error?.message||"校正記録を読み込めませんでした。"));
})();
EOF

cat > tests/unit/calibration.test.mjs <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import {
  CALIBRATION_PATH_KINDS,
  CALIBRATION_SIGN_CONVENTION,
  MAX_CALIBRATION_SPREAD_MS,
  MIN_CALIBRATION_SAMPLES,
  applyCalibrationOffset,
  calibrationAcceptance,
  calibrationApplies,
  calibrationFromSamples,
  correctedTime,
  invalidateCalibrationRecord,
  validateCalibrationRecord
} from "../../core/calibration.js";

const createdAt="2026-09-06T00:00:00Z";
const environment={userAgentFamily:"chromium",inputRoute:"wired-input",outputRoute:"wired-output"};
const timebase={reference:"audio-context",observed:"audio-context"};

function record(overrides={}){
  return {
    id:"cal-1",createdAt,pathKind:"roundTrip",timebase,offsetMs:50,
    signConvention:CALIBRATION_SIGN_CONVENTION,sampleCount:MIN_CALIBRATION_SAMPLES,
    precision:{spreadMs:2,method:"mad"},environment,status:"calibrated",
    validity:{validFrom:createdAt,invalidatedAt:null,reason:null},...overrides
  };
}

function target(pathKind="roundTrip",overrides={}){
  return {pathKind,timebase,environment,at:"2026-09-06T00:10:00Z",...overrides};
}

test("pathKind accepts exactly roundTrip input and output",()=>{
  for(const pathKind of CALIBRATION_PATH_KINDS) assert.equal(validateCalibrationRecord(record({pathKind})).pathKind,pathKind);
  assert.throws(()=>validateCalibrationRecord(record({pathKind:"combined"})),/経路/);
});

test("roundTrip calibration cannot be used as input or output calibration",()=>{
  const value=validateCalibrationRecord(record());
  assert.equal(calibrationApplies(value,target("input")),false);
  assert.equal(calibrationApplies(value,target("output")),false);
  assert.throws(()=>applyCalibrationOffset(value,target("input"),1050),/適用できません/);
  assert.throws(()=>applyCalibrationOffset(value,target("output"),1050),/適用できません/);
});

test("input and output calibrations apply only to their own pathKind",()=>{
  const input=validateCalibrationRecord(record({id:"input",pathKind:"input"}));
  const output=validateCalibrationRecord(record({id:"output",pathKind:"output"}));
  assert.equal(calibrationApplies(input,target("input")),true);
  assert.equal(calibrationApplies(input,target("output")),false);
  assert.equal(calibrationApplies(output,target("output")),true);
  assert.equal(calibrationApplies(output,target("input")),false);
});

test("offset sign convention is observed minus reference",()=>{
  assert.equal(correctedTime(1050,50),1000);
  assert.equal(correctedTime(950,-50),1000);
  assert.equal(applyCalibrationOffset(validateCalibrationRecord(record()),target(),1050),1000);
});

test("non-finite numeric values and invalid sample or spread are rejected",()=>{
  for(const offsetMs of [NaN,Infinity,-Infinity]) assert.throws(()=>validateCalibrationRecord(record({offsetMs})),/offset/);
  assert.throws(()=>validateCalibrationRecord(record({sampleCount:0,status:"uncalibrated"})),/sampleCount/);
  assert.throws(()=>validateCalibrationRecord(record({precision:{spreadMs:-1,method:"mad"},status:"uncalibrated"})),/spread/);
  assert.throws(()=>validateCalibrationRecord(record({precision:{spreadMs:Infinity,method:"mad"},status:"uncalibrated"})),/spread/);
});

test("unknown timebase and unknown status are rejected",()=>{
  assert.throws(()=>validateCalibrationRecord(record({timebase:{reference:"wall-clock",observed:"audio-context"}})),/時間基準/);
  assert.throws(()=>validateCalibrationRecord(record({status:"ready"})),/状態/);
});

test("applicability requires matching timebase environment status and validity",()=>{
  const value=validateCalibrationRecord(record());
  assert.equal(calibrationApplies(value,target()),true);
  assert.equal(calibrationApplies(value,target("roundTrip",{environment:{...environment,inputRoute:"bluetooth-input"}})),false);
  assert.equal(calibrationApplies(value,target("roundTrip",{environment:{...environment,outputRoute:"bluetooth-output"}})),false);
  assert.equal(calibrationApplies(value,target("roundTrip",{environment:{...environment,userAgentFamily:"firefox"}})),false);
  assert.equal(calibrationApplies(value,target("roundTrip",{timebase:{reference:"performance",observed:"audio-context"}})),false);
});

test("explicit invalidation makes a record non-applicable",()=>{
  const invalid=invalidateCalibrationRecord(validateCalibrationRecord(record()),{at:"2026-09-06T00:05:00Z",reason:"出力経路を変更"});
  assert.equal(invalid.status,"uncalibrated");
  assert.equal(calibrationApplies(invalid,target()),false);
  assert.equal(invalid.validity.reason,"出力経路を変更");
});

test("calibration acceptance uses explicit sample and MAD thresholds",()=>{
  assert.equal(calibrationAcceptance({sampleCount:MIN_CALIBRATION_SAMPLES,precision:{spreadMs:MAX_CALIBRATION_SPREAD_MS,method:"mad"}}).accepted,true);
  assert.equal(calibrationAcceptance({sampleCount:MIN_CALIBRATION_SAMPLES-1,precision:{spreadMs:1,method:"mad"}}).accepted,false);
  assert.equal(calibrationAcceptance({sampleCount:MIN_CALIBRATION_SAMPLES,precision:{spreadMs:MAX_CALIBRATION_SPREAD_MS+.1,method:"mad"}}).accepted,false);
});

test("samples use median offset and MAD without decomposing roundTrip",()=>{
  const value=calibrationFromSamples({
    id:"samples",createdAt,pathKind:"roundTrip",timebase,environment,
    samples:[48,50,51,49,50].map((offset,index)=>({referenceMs:1000+index*100,observedMs:1000+index*100+offset}))
  });
  assert.equal(value.offsetMs,50);
  assert.equal(value.precision.method,"mad");
  assert.equal(value.precision.spreadMs,1);
  assert.equal(value.status,"calibrated");
  assert.equal(value.pathKind,"roundTrip");
});

test("high spread remains uncalibrated instead of deleting inconvenient samples",()=>{
  const value=calibrationFromSamples({
    id:"spread",createdAt,pathKind:"roundTrip",timebase,environment,
    samples:[0,20,40,60,80].map((offset,index)=>({referenceMs:index*100,observedMs:index*100+offset}))
  });
  assert.equal(value.sampleCount,5);
  assert.equal(value.precision.spreadMs,20);
  assert.equal(value.status,"uncalibrated");
});
EOF

cat > tests/unit/measurement.test.mjs <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { observeWebAudioLatency, uncalibratedMeasurement, unmeasurableMeasurement, validateMeasurementResult } from "../../core/measurement.js";
import { validateAttempt } from "../../core/practice.js";

test("unmeasurable result stays null instead of becoming zero",()=>{
  const value=unmeasurableMeasurement({metric:"onset-offset",unit:"ms",reason:"基準clockがありません。"});
  assert.equal(value.state,"unmeasurable");
  assert.equal(value.value,null);
  assert.throws(()=>validateMeasurementResult({...value,value:0}),/0や推定値/);
});

test("uncalibrated result keeps raw observation but cannot claim a calibration",()=>{
  const value=uncalibratedMeasurement({metric:"onset-offset",value:37,unit:"ms",timebase:"audio-context",reason:"適用可能な校正がありません。"});
  assert.equal(value.state,"uncalibrated");
  assert.equal(value.value,37);
  assert.equal(value.calibrationId,null);
});

test("Web Audio latency fields are feature-detected and never blindly summed",()=>{
  const value=observeWebAudioLatency({baseLatency:.01,outputLatency:.02,getOutputTimestamp(){return {contextTime:1.5,performanceTime:2500};}});
  assert.equal(value.baseLatencyMs,10);
  assert.equal(value.outputLatencyMs,20);
  assert.deepEqual(value.outputTimestamp,{contextTime:1.5,performanceTime:2500});
  assert.equal("combinedLatencyMs" in value,false);
  assert.deepEqual(observeWebAudioLatency({}),{baseLatencyMs:null,outputLatencyMs:null,outputTimestamp:null});
});

test("reported and observed Attempt evidence are not promoted to measured",()=>{
  const source={
    id:"legacy",phraseId:"p",date:"2026-09-06T00:00:00Z",
    conditions:{tempo:80,start:1,end:1,assist:"full",melody:true,countIn:0,backing:[]},
    observed:{transportCompleted:true,completedLoops:1,elapsedSec:3},
    reported:{clean:true},
    measured:{timingMs:0}
  };
  const value=validateAttempt(source);
  assert.equal(value.observed.transportCompleted,true);
  assert.equal(value.reported.clean,true);
  assert.equal(value.assessment.basis,"reported");
  assert.equal("measured" in value,false);
});
EOF

cat > tests/unit/practice-store.test.mjs <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { PRACTICE_DB_VERSION, upgradePracticeDatabase } from "../../core/practice-store.js";

test("practice database upgrades v2 to v3 without replacing attempts or recordings",()=>{
  const attempts={name:"attempts",records:new Map([["legacy-attempt",{id:"legacy-attempt"}]])};
  const recordings={name:"recordings",records:new Map([["legacy-attempt",{attemptId:"legacy-attempt",size:3}]])};
  const stores=new Map([["attempts",attempts],["recordings",recordings]]);
  const db={
    objectStoreNames:{
      contains(name){return stores.has(name);},
      *[Symbol.iterator](){yield* stores.keys();}
    },
    createObjectStore(name,options){
      const store={name,options,records:new Map()};
      stores.set(name,store);
      return store;
    }
  };

  assert.equal(PRACTICE_DB_VERSION,3);
  upgradePracticeDatabase(db);
  assert.equal(stores.get("attempts"),attempts);
  assert.equal(stores.get("recordings"),recordings);
  assert.deepEqual(stores.get("attempts").records.get("legacy-attempt"),{id:"legacy-attempt"});
  assert.deepEqual(stores.get("recordings").records.get("legacy-attempt"),{attemptId:"legacy-attempt",size:3});
  assert.equal(stores.get("calibrations").options.keyPath,"id");

  upgradePracticeDatabase(db);
  assert.equal(stores.size,3);
  assert.equal(stores.get("attempts"),attempts);
  assert.equal(stores.get("recordings"),recordings);
});
EOF

cat > tests/calibration.spec.mjs <<'EOF'
import { test, expect } from "@playwright/test";

async function openCalibration(page){
  await page.goto("/phrase.html");
  await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
  await page.locator("#calibration-details > summary").click();
}

function installCollector(page,offsets){
  return page.addInitScript(values=>{
    window.__calibrationCollector={
      environment:{userAgentFamily:"chromium",inputRoute:"wired-input",outputRoute:"wired-output"},
      async collect({timebase,environment}){
        return {
          state:"observed",timebase,environment,
          samples:values.map((offset,index)=>({referenceMs:1000+index*100,observedMs:1000+index*100+offset}))
        };
      }
    };
  },offsets);
}

test("calibration UI starts uncalibrated and remains mobile-safe",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openCalibration(page);
  await expect(page.locator("#calibration-state")).toHaveAttribute("data-state","uncalibrated");
  await expect(page.locator("#calibration-state-label")).toHaveText("未校正");
  await expect(page.locator("#calibration-path option")).toHaveCount(3);
  await expect(page.locator("#focus-mode option")).toHaveCount(4);
  await expect(page.locator("#focus-diagnosis")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("deterministic collector can create and persist a calibrated roundTrip record",async({page})=>{
  await installCollector(page,[48,50,51,49,50]);
  await openCalibration(page);
  await page.locator("#calibration-start").click();
  await expect(page.locator("#calibration-state")).toHaveAttribute("data-state","calibrated");
  await expect(page.locator("#calibration-state-label")).toHaveText("校正済み");
  await expect(page.locator("#calibration-state-detail")).toContainText("offset 50.0 ms");
  const records=await page.evaluate(async()=>{
    const {createPracticeStore}=await import("./core/practice-store.js");
    return createPracticeStore(indexedDB).allCalibrations();
  });
  expect(records).toHaveLength(1);
  expect(records[0].pathKind).toBe("roundTrip");
  expect(records[0].status).toBe("calibrated");
  expect(records[0].precision).toEqual({spreadMs:1,method:"mad"});
  await page.reload();
  await page.locator("#calibration-details > summary").click();
  await expect(page.locator("#calibration-state-label")).toHaveText("校正済み");
});

test("high spread is stored as uncalibrated",async({page})=>{
  await installCollector(page,[0,20,40,60,80]);
  await openCalibration(page);
  await page.locator("#calibration-start").click();
  await expect(page.locator("#calibration-state")).toHaveAttribute("data-state","uncalibrated");
  await expect(page.locator("#calibration-state-label")).toHaveText("未校正");
  await expect(page.locator("#calibration-status")).toContainText("ばらつきが大きいため未校正");
  const [record]=await page.evaluate(async()=>{
    const {createPracticeStore}=await import("./core/practice-store.js");
    return createPracticeStore(indexedDB).allCalibrations();
  });
  expect(record.status).toBe("uncalibrated");
  expect(record.precision.spreadMs).toBe(20);
});

test("unavailable collector produces unmeasurable without saving a fake offset",async({page})=>{
  await openCalibration(page);
  await page.locator("#calibration-start").click();
  await expect(page.locator("#calibration-state")).toHaveAttribute("data-state","unmeasurable");
  await expect(page.locator("#calibration-state-label")).toHaveText("測定不能");
  await expect(page.locator("#calibration-status")).toContainText("架空のoffsetは保存しません");
  const records=await page.evaluate(async()=>{
    const {createPracticeStore}=await import("./core/practice-store.js");
    return createPracticeStore(indexedDB).allCalibrations();
  });
  expect(records).toHaveLength(0);
});
EOF

python3 - <<'PY'
from pathlib import Path

path=Path("phrase.html")
text=path.read_text()
needle='''      <div id="focus-diagnosis" class="focus-diagnosis">\n        <strong>同じ区間・テンポのfocus別結果</strong>\n        <ul id="focus-status-list" class="focus-status-list"></ul>\n        <p id="focus-diagnosis-text" class="hint"></p>\n      </div>\n      <details><summary>このフレーズの履歴・バックアップ</summary>'''
replacement='''      <div id="focus-diagnosis" class="focus-diagnosis">\n        <strong>同じ区間・テンポのfocus別結果</strong>\n        <ul id="focus-status-list" class="focus-status-list"></ul>\n        <p id="focus-diagnosis-text" class="hint"></p>\n      </div>\n      <details id="calibration-details" class="calibration-details">\n        <summary>測定・校正状態</summary>\n        <div class="calibration-grid">\n          <label>校正経路<select id="calibration-path"><option value="roundTrip">往復（round-trip）</option><option value="input">入力</option><option value="output">出力</option></select></label>\n          <div id="calibration-state" class="calibration-state" data-state="uncalibrated"><strong id="calibration-state-label">未校正</strong><span id="calibration-state-detail">校正記録を確認しています。</span></div>\n        </div>\n        <div class="practice-presets"><button id="calibration-start" type="button">校正開始</button></div>\n        <p class="hint">round-tripの観測値をinput / outputへ分解しません。校正できない場合は推定値を保存せず「測定不能」と表示します。</p>\n        <p id="calibration-status" role="status"></p>\n      </details>\n      <details><summary>このフレーズの履歴・バックアップ</summary>'''
if needle not in text:
    raise SystemExit("phrase.html calibration insertion point not found")
text=text.replace(needle,replacement,1)
needle='''  <script src="phrase.js" type="module"></script>\n  <script src="register-sw.js" defer></script>'''
replacement='''  <script src="phrase.js" type="module"></script>\n  <script src="calibration-ui.js" type="module"></script>\n  <script src="register-sw.js" defer></script>'''
if needle not in text:
    raise SystemExit("phrase.html script insertion point not found")
path.write_text(text.replace(needle,replacement,1))

path=Path("phrase.css")
text=path.read_text()
needle='.focus-diagnosis .hint{margin:8px 0 0}\n'
addition='''.focus-diagnosis .hint{margin:8px 0 0}\n.calibration-details{margin-top:14px}.calibration-grid{display:grid;grid-template-columns:minmax(150px,.7fr) minmax(0,1.3fr);gap:10px;align-items:end}.calibration-grid label{display:grid;gap:6px;min-width:0;font-size:13px;font-weight:800}.calibration-state{display:grid;gap:4px;min-width:0;padding:10px 12px;border:1px solid var(--line);background:#fff}.calibration-state strong{font-size:14px}.calibration-state span{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.calibration-state[data-state="calibrated"]{border-color:var(--green);background:var(--green-light)}.calibration-state[data-state="unmeasurable"]{border-color:var(--red);background:#fff5ed}\n'''
if needle not in text:
    raise SystemExit("phrase.css insertion point not found")
text=text.replace(needle,addition,1)
needle='  .focus-control{grid-template-columns:1fr}.focus-control .hint{grid-column:1}.focus-status-list{grid-template-columns:1fr}\n'
replacement='  .focus-control{grid-template-columns:1fr}.focus-control .hint{grid-column:1}.focus-status-list{grid-template-columns:1fr}.calibration-grid{grid-template-columns:1fr}\n'
if needle not in text:
    raise SystemExit("phrase.css mobile insertion point not found")
path.write_text(text.replace(needle,replacement,1))

path=Path("sw.js")
text=path.read_text()
if 'const CACHE_NAME = "fingerstyle-practice-v16";' not in text:
    raise SystemExit("sw cache version mismatch")
text=text.replace('const CACHE_NAME = "fingerstyle-practice-v16";','const CACHE_NAME = "fingerstyle-practice-v17";',1)
needle='''  "./phrase.js",\n  "./rhythm.html",'''
replacement='''  "./phrase.js",\n  "./calibration-ui.js",\n  "./rhythm.html",'''
if needle not in text:
    raise SystemExit("sw calibration-ui insertion point not found")
text=text.replace(needle,replacement,1)
needle='''  "./core/practice.js",\n  "./core/practice-store.js",'''
replacement='''  "./core/practice.js",\n  "./core/practice-store.js",\n  "./core/calibration.js",\n  "./core/measurement.js",'''
if needle not in text:
    raise SystemExit("sw core insertion point not found")
path.write_text(text.replace(needle,replacement,1))

path=Path("docs/TASK-NEXT-MEASUREMENT-CALIBRATION.md")
text=path.read_text()
needle='''単一のoffsetを全デバイス・全入出力経路へ適用してはいけません。\n\n---\n\n## 5. accuracy と precision'''
replacement='''単一のoffsetを全デバイス・全入出力経路へ適用してはいけません。\n\n### 4.4 round-tripの非分解原則\n\nround-trip calibrationで直接観測した値を、**独立した測定根拠なしに input latency と output latency へ分解してはいけません。**\n\nスピーカー→空気→マイクで得たround-trip値は概念上、次を含み得ます。\n\n```text\noutput path\n+ acoustic path\n+ input path\n+ detector delay\n```\n\nしたがって `roundTrip = 50 ms` という観測から `output = 30 ms / input = 20 ms` のような値を生成することは禁止します。各calibration recordは `pathKind` を1つだけ持ち、許可値は `roundTrip / input / output` です。`roundTrip` recordを `input` または `output` として適用してはいけません。\n\n### 4.5 Phase 4Bのoffset・precision規約\n\n符号規約は次で固定します。\n\n```text\noffsetMs = observedTime - referenceTime\ncorrectedTime = observedTime - offsetMs\n```\n\n- positive offset: 観測が基準より遅い\n- negative offset: 観測が基準より早い\n\n初期実装では外れ値除外を行いません。offsetはsample差のmedian、spreadはMAD（median absolute deviation）で保持します。calibration acceptanceの暫定品質gateは `sampleCount >= 5` かつ `MAD <= 15 ms` とします。これは演奏成績の閾値ではなく、**校正値を自動適用してよいか**だけを判定するためのgateです。\n\n---\n\n## 5. accuracy と precision'''
if needle not in text:
    raise SystemExit("TASK round-trip insertion point not found")
text=text.replace(needle,replacement,1)
text=text.replace('- [ ] calibration schemaを実装する','- [x] calibration schemaを実装する',1)
text=text.replace('- [ ] calibration acceptance testを追加する','- [x] calibration acceptance testを追加する',1)
text=text.replace('- [ ] ブラウザでの校正フローを実装する','- [x] ブラウザでの校正フローを実装する',1)
path.write_text(text)
PY
