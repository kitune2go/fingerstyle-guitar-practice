import test from "node:test";
import assert from "node:assert/strict";

import {
  actualBeatsFromNotation,
  bendLabel,
  buildPhraseModel,
  noteToMidi,
  splitMeasures,
  staffY,
  vexDuration,
  writtenVexKey,
} from "../../core/music.js";

test("guitar pitch keeps sounding and written octaves separate",()=>{
  assert.equal(noteToMidi("E2"),40);
  assert.equal(noteToMidi("E4"),64);
  assert.equal(staffY("E4"),72);
  assert.equal(writtenVexKey("F#4"),"f#/5");
});

test("time modification separates written eighths from triplet playback time",()=>{
  const note={
    beats:1/3,
    notated:{type:"eighth",dots:0},
    timeModification:{actualNotes:3,normalNotes:2,normalType:"eighth"}
  };
  assert.equal(vexDuration(note),"8");
  assert.ok(Math.abs(actualBeatsFromNotation(note)-1/3)<1e-9);
});

test("triplet notes retain exact fractional positions inside a measure",()=>{
  const triplet=()=>({
    name:"E4",string:1,fret:0,finger:"i",beats:1/3,
    notated:{type:"eighth"},
    timeModification:{actualNotes:3,normalNotes:2,normalType:"eighth"}
  });
  const phrase={
    timeSignature:"4/4",
    notes:[triplet(),triplet(),triplet(),
      {name:"E4",string:1,fret:0,finger:"i",beats:1},
      {name:"E4",string:1,fret:0,finger:"i",beats:2}]
  };
  const [measure]=splitMeasures(phrase);
  assert.deepEqual(measure.slice(0,3).map(note=>note.startBeat),[0,1/3,2/3]);
  assert.equal(measure.at(-1).startBeat,2);
});

test("phrase model applies key-signature-aware accidentals",()=>{
  const phrase={
    key:"G",timeSignature:"4/4",tuplets:[],notations:[],
    notes:[
      {id:"n1",name:"F#4",string:2,fret:7,finger:"i",beats:1},
      {id:"n2",name:"F4",string:2,fret:6,finger:"m",beats:1},
      {name:"F4",string:2,fret:6,finger:"i",beats:1},
      {name:"F#4",string:2,fret:7,finger:"m",beats:1}
    ]
  };
  const model=buildPhraseModel(phrase);
  assert.deepEqual(model.measures[0].map(note=>note.accidentalGlyph),[null,"♮",null,"♯"]);
  assert.equal(model.noteById.get("n2").globalIndex,1);
});

test("bend labels follow common guitar interval labels",()=>{
  assert.equal(bendLabel(1),"½");
  assert.equal(bendLabel(2),"Full");
  assert.equal(bendLabel(3),"1½");
});
