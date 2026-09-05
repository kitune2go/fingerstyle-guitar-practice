import test from "node:test";
import assert from "node:assert/strict";
import { validateAttempt, parsePracticeBackup } from "../../core/practice.js";

function attempt(){
  return {
    id:"recorded-attempt",phraseId:"phrase-1",date:"2026-09-06T00:00:00Z",
    conditions:{tempo:80,start:1,end:1,assist:"full",melody:true,countIn:0,backing:[]},
    observed:{transportCompleted:true,completedLoops:1,elapsedSec:4},
    reported:{clean:true,review:{noise:2,evenness:3,tone:2,flow:3}}
  };
}

test("self review stays reported data and never becomes a measured score",()=>{
  const record=validateAttempt({...attempt(),measured:{score:99}});
  assert.deepEqual(record.reported.review,{noise:2,evenness:3,tone:2,flow:3});
  assert.equal(record.measured,undefined);
  assert.deepEqual(record.assessment,{status:"provisional",basis:"reported"});
});

test("legacy attempts without review remain valid",()=>{
  const value=attempt();
  value.id="legacy";
  value.reported={clean:false};
  const record=validateAttempt(value);
  assert.deepEqual(record.reported,{clean:false});
});

test("backup keeps portable review data but rejects invalid rubric values",()=>{
  const backup=JSON.stringify({format:"guitar-phrase-practice",version:1,attempts:[attempt()]});
  const [record]=parsePracticeBackup(backup);
  assert.equal(record.reported.review.flow,3);

  const invalid=attempt();
  invalid.reported.review.tone=4;
  assert.throws(()=>parsePracticeBackup(JSON.stringify({format:"guitar-phrase-practice",version:1,attempts:[invalid]})),/1〜3/);
});
