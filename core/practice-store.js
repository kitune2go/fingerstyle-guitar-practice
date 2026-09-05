import { validateAttempt } from "./practice.js";

// The caller supplies IndexedDB so this adapter has no browser globals.
export function createPracticeStore(indexedDB){
  let opening;
  function open(){
    if(!indexedDB) return Promise.reject(new Error("この環境では練習記録を保存できません。"));
    if(!opening){
      opening=new Promise((resolve,reject)=>{
        const request=indexedDB.open("guitar-phrase-practice",1);
        request.onupgradeneeded=()=>request.result.createObjectStore("attempts",{keyPath:"id"});
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

  return {all,addMany};
}
