import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPhraseModel } from "../../core/music.js";
import { buildPracticeTimeline, practiceRange, validateAttempt, parsePracticeBackup, practiceAdvice } from "../../core/practice.js";

const phrases=JSON.parse(readFileSync(new URL("../../data/phrases.json",import.meta.url))).phrases;
const record=()=>({
  id:"one",phraseId:phrases[0].id,date:"2026-09-05T13:00:00Z",
  conditions:{tempo:80,start:2,end:3,assist:"memory",melody:false,countIn:1,backing:["bass"]},
  observed:{transportCompleted:true,completedLoops:2,elapsedSec:12},reported:{clean:true}
});

test("selected measures retain absolute notes and chords but start on beat zero",()=>{
  for(const phrase of phrases){
    const model=buildPhraseModel(phrase);
    const timeline=buildPracticeTimeline(model,{start:2,end:3});
    assert.equal(timeline.lengthBeats,8);
    assert.equal(timeline.events[0].beat,0);
    assert.deepEqual(timeline.events.flatMap(event=>event.notes.map(entry=>entry.index)),model.notes.filter(note=>[1,2].includes(note.measureIndex)).map(note=>note.globalIndex));
    assert.equal(timeline.events[0].backing.measure,1);
    assert.ok(timeline.events.every(event=>event.beat<8));
  }
});

test("32nd notes and quintuplets survive the playback timeline without tick rounding",()=>{
  for(const durations of [Array(32).fill(.125),[...Array(5).fill(.2),1,1,1]]){
    const model=buildPhraseModel({timeSignature:"4/4",key:"C",notes:durations.map(beats=>({name:"E4",beats}))});
    const timeline=buildPracticeTimeline(model,{start:1,end:1});
    const noteEvents=timeline.events.filter(event=>event.notes.length);
    assert.equal(noteEvents.length,durations.length);
    assert.equal(noteEvents[1].beat,durations[0]);
  }
});

test("a range reattacks an incoming tie and clips outgoing tied sustain",()=>{
  const model=buildPhraseModel({timeSignature:"4/4",key:"C",notes:[
    {id:"a",name:"E4",beats:4},{id:"b",name:"E4",beats:4}
  ],notations:[{type:"tie",from:"a",to:"b"}]});
  const first=buildPracticeTimeline(model,{start:1,end:1}).events[0].notes[0];
  const second=buildPracticeTimeline(model,{start:2,end:2}).events[0].notes[0];
  const whole=buildPracticeTimeline(model,{start:1,end:2}).events.flatMap(event=>event.notes);
  assert.equal(first.durationBeats,4);
  assert.equal(second.attack,true);
  assert.equal(whole[0].durationBeats,8);
  assert.equal(whole[1].attack,false);
});

test("range controls cannot produce an empty or out-of-bounds interval",()=>{
  assert.deepEqual(practiceRange(8,7,3),{start:7,end:7});
  assert.deepEqual(practiceRange(8,-1,100),{start:1,end:8});
});

test("reported results cannot masquerade as measured assessments",()=>{
  const result=validateAttempt({...record(),measured:{score:100},assessment:{status:"pass",basis:"measured"}});
  assert.deepEqual(result.assessment,{status:"provisional",basis:"reported"});
  assert.equal(result.measured,undefined);
  const incomplete=record();
  incomplete.observed={transportCompleted:false,completedLoops:0,elapsedSec:1};
  assert.throws(()=>validateAttempt(incomplete),/再生完了前/);
});

test("invalid backup records fail before any history can be merged",()=>{
  const backup=attempts=>JSON.stringify({format:"guitar-phrase-practice",version:1,attempts});
  assert.equal(parsePracticeBackup(backup([record()])).length,1);
  assert.throws(()=>parsePracticeBackup(backup([record(),record()])),/重複/);
  for(const edit of [item=>item.conditions.tempo=null,item=>item.conditions.assist="__proto__",item=>item.observed.elapsedSec=-1,item=>item.reported.clean="true"]){
    const item=record();edit(item);
    assert.throws(()=>parsePracticeBackup(backup([record(),{...item,id:"two"}])));
  }
});

test("progress advice compares matching assistance and never claims verified mastery",()=>{
  const first=validateAttempt(record());
  const second=validateAttempt({...record(),id:"two",date:"2026-09-05T13:10:00Z"});
  assert.match(practiceAdvice([first,second],first.conditions),/2回達成（自己評価）/);
  assert.match(practiceAdvice([first,second],{...first.conditions,melody:true}),/2回、止まらず/);
  const failed=validateAttempt({...record(),id:"three",date:"2026-09-05T13:20:00Z",reported:{clean:false}});
  assert.match(practiceAdvice([first,second,failed],first.conditions),/テンポを4下げ/);
});
