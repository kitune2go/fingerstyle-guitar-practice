import test from "node:test";
import assert from "node:assert/strict";
import { PRACTICE_DB_VERSION, upgradePracticeDatabase } from "../../core/practice-store.js";

test("practice database upgrades to v2 without replacing the existing attempts store",()=>{
  const attempts={name:"attempts",records:new Map([["legacy",{id:"legacy"}]])};
  const stores=new Map([["attempts",attempts]]);
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

  assert.equal(PRACTICE_DB_VERSION,2);
  upgradePracticeDatabase(db);
  assert.equal(stores.get("attempts"),attempts);
  assert.deepEqual(stores.get("attempts").records.get("legacy"),{id:"legacy"});
  assert.equal(stores.get("recordings").options.keyPath,"attemptId");

  upgradePracticeDatabase(db);
  assert.equal(stores.size,2);
  assert.equal(stores.get("attempts"),attempts);
});
