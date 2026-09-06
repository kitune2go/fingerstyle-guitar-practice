import test from "node:test";
import assert from "node:assert/strict";
import { FOCUS_MODE_KEYS, parsePracticeBackup, practiceAdvice, practiceFocusComparisonKey, practiceFocusDiagnosis, practiceFocusStatuses, validateAttempt } from "../../core/practice.js";

function attempt({id="a",focusMode="integrated",clean=false,tempo=80,start=1,end=2,phraseId="p",date="2026-09-06T00:00:00Z",legacy=false}={}){
  const conditions={tempo,start,end,assist:"full",melody:true,countIn:0,backing:[]};
  if(!legacy) conditions.focusMode=focusMode;
  return {id,phraseId,date,conditions,observed:{transportCompleted:focusMode!=="reading",completedLoops:focusMode!=="reading"?1:0,elapsedSec:4},reported:{clean}};
}

test("all four focus modes validate and persist",()=>{
  for(const focusMode of FOCUS_MODE_KEYS){
    const value=validateAttempt(attempt({id:focusMode,focusMode,clean:true}));
    assert.equal(value.conditions.focusMode,focusMode);
  }
});

test("unknown focus mode is rejected",()=>{
  assert.throws(()=>validateAttempt(attempt({focusMode:"pitch"})),/focus/);
});

test("legacy Attempt without focus normalizes to integrated without mutating input",()=>{
  const legacy=attempt({legacy:true,clean:true});
  const normalized=validateAttempt(legacy);
  assert.equal(normalized.conditions.focusMode,"integrated");
  assert.equal(Object.hasOwn(legacy.conditions,"focusMode"),false);
});

test("version 1 backup remains compatible and legacy focus becomes integrated",()=>{
  const backup={format:"guitar-phrase-practice",version:1,attempts:[attempt({id:"legacy",legacy:true,clean:true})]};
  const [value]=parsePracticeBackup(JSON.stringify(backup));
  assert.equal(value.conditions.focusMode,"integrated");
});

test("practiceAdvice never treats another focus as the same condition",()=>{
  const integrated=validateAttempt(attempt({id:"integrated",focusMode:"integrated",clean:true}));
  const advice=practiceAdvice([integrated],{...integrated.conditions,focusMode:"execution"});
  assert.match(advice,/同じ区間を2回/);
});

test("focus statuses keep integrated and execution separate",()=>{
  const attempts=[
    validateAttempt(attempt({id:"e",focusMode:"execution",clean:false})),
    validateAttempt(attempt({id:"i",focusMode:"integrated",clean:true,date:"2026-09-06T00:01:00Z"}))
  ];
  const statuses=practiceFocusStatuses(attempts,{phraseId:"p",start:1,end:2,tempo:80});
  assert.equal(statuses.execution.status,"fail");
  assert.equal(statuses.integrated.status,"success");
  assert.equal(statuses.reading.status,"unknown");
});

test("single failed foundation focus becomes a candidate, not a numeric score",()=>{
  const attempts=[
    validateAttempt(attempt({id:"r",focusMode:"reading",clean:true})),
    validateAttempt(attempt({id:"h",focusMode:"rhythm",clean:true})),
    validateAttempt(attempt({id:"e",focusMode:"execution",clean:false})),
    validateAttempt(attempt({id:"i",focusMode:"integrated",clean:false}))
  ];
  const diagnosis=practiceFocusDiagnosis(attempts,{phraseId:"p",start:1,end:2,tempo:80});
  assert.deepEqual(diagnosis.candidates,["execution"]);
  assert.equal(diagnosis.recommendation.action,"repeat-focus");
  assert.match(diagnosis.message,/演奏動作/);
  assert.equal("score" in diagnosis,false);
});

test("three foundation successes plus integrated failure prescribes slower integration",()=>{
  const attempts=FOCUS_MODE_KEYS.map((focusMode,index)=>validateAttempt(attempt({id:String(index),focusMode,clean:focusMode!=="integrated"})));
  const diagnosis=practiceFocusDiagnosis(attempts,{phraseId:"p",start:1,end:2,tempo:80});
  assert.equal(diagnosis.recommendation.action,"retry-integrated");
  assert.equal(diagnosis.recommendation.tempoDelta,-4);
});

test("integrated success recommends next range or a small tempo increase",()=>{
  const diagnosis=practiceFocusDiagnosis([validateAttempt(attempt({focusMode:"integrated",clean:true}))],{phraseId:"p",start:1,end:2,tempo:80});
  assert.equal(diagnosis.recommendation.action,"advance");
  assert.equal(diagnosis.recommendation.tempoDelta,2);
});

test("diagnostic comparison key is phrase + range + exact tempo only",()=>{
  const base={phraseId:"p",conditions:{start:2,end:3,tempo:80,assist:"full",melody:true,backing:["bass"],focusMode:"reading"}};
  assert.equal(practiceFocusComparisonKey(base),practiceFocusComparisonKey({phraseId:"p",conditions:{...base.conditions,assist:"memory",melody:false,backing:[],focusMode:"execution"}}));
  assert.notEqual(practiceFocusComparisonKey(base),practiceFocusComparisonKey({phraseId:"p",conditions:{...base.conditions,tempo:82}}));
  assert.notEqual(practiceFocusComparisonKey(base),practiceFocusComparisonKey({phraseId:"other",conditions:base.conditions}));
});

test("invalid focus inside a version 1 backup is rejected rather than rounded",()=>{
  const bad=attempt({id:"bad",focusMode:"unknown"});
  assert.throws(()=>parsePracticeBackup(JSON.stringify({format:"guitar-phrase-practice",version:1,attempts:[bad]})),/focus/);
});

for(const failedFocus of ["reading","rhythm","execution"]){
  test("integrated failure keeps "+failedFocus+" as its own bottleneck candidate",()=>{
    const attempts=[
      validateAttempt(attempt({id:"i",focusMode:"integrated",clean:false})),
      validateAttempt(attempt({id:"f",focusMode:failedFocus,clean:false,date:"2026-09-06T00:01:00Z"}))
    ];
    const diagnosis=practiceFocusDiagnosis(attempts,{phraseId:"p",start:1,end:2,tempo:80});
    assert.deepEqual(diagnosis.candidates,[failedFocus]);
  });
}

test("multiple failed foundation focuses remain multiple candidates",()=>{
  const attempts=[
    validateAttempt(attempt({id:"i",focusMode:"integrated",clean:false})),
    validateAttempt(attempt({id:"r",focusMode:"rhythm",clean:false})),
    validateAttempt(attempt({id:"e",focusMode:"execution",clean:false}))
  ];
  const diagnosis=practiceFocusDiagnosis(attempts,{phraseId:"p",start:1,end:2,tempo:80});
  assert.deepEqual(diagnosis.candidates,["rhythm","execution"]);
  assert.equal(diagnosis.recommendation.action,"repeat-focuses");
});

test("a foundation failure without integrated evidence is not declared causal",()=>{
  const diagnosis=practiceFocusDiagnosis([validateAttempt(attempt({focusMode:"rhythm",clean:false}))],{phraseId:"p",start:1,end:2,tempo:80});
  assert.deepEqual(diagnosis.candidates,[]);
  assert.equal(diagnosis.recommendation.action,"check-integrated");
});
