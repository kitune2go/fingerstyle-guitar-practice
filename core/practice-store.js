import { validateAttempt } from "./practice.js";

export const PRACTICE_DB_NAME="guitar-phrase-practice";
export const PRACTICE_DB_VERSION=2;

function hasStore(db,name){
  return typeof db.objectStoreNames?.contains==="function"
    ?db.objectStoreNames.contains(name)
    :Array.from(db.objectStoreNames??[]).includes(name);
}

export function upgradePracticeDatabase(db){
  if(!hasStore(db,"attempts")) db.createObjectStore("attempts",{keyPath:"id"});
  if(!hasStore(db,"recordings")) db.createObjectStore("recordings",{keyPath:"attemptId"});
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

  return {all,addMany,saveAttempt,recording,allRecordings,deleteRecording};
}