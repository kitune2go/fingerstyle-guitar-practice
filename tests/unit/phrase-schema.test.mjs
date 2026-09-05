import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validatePhraseData } from "../../scripts/phrase-schema.mjs";

const shipped=JSON.parse(fs.readFileSync(
  new URL("../../data/phrases.json",import.meta.url),"utf8"
));

function clone(value){
  return structuredClone(value);
}

test("shipped phrases validate written durations, tuplets and guitar techniques",()=>{
  assert.doesNotThrow(()=>validatePhraseData(clone(shipped)));
  const phrase=shipped.phrases.find(item=>item.id==="a7-blues-rock-eight-bars");
  assert.equal(phrase.tuplets.length,2);
  assert.equal(phrase.notations.filter(item=>item.type==="bend").length,2);
  assert.equal(phrase.notations.filter(item=>item.type==="hammer-on").length,5);
  assert.equal(phrase.notations.filter(item=>item.type==="pull-off").length,1);
  assert.equal(phrase.notations.filter(item=>item.type==="slide").length,1);
});

test("legacy per-note technique fields are rejected",()=>{
  const data=clone(shipped);
  data.phrases[0].notes[0].technique="hammer";
  assert.throws(()=>validatePhraseData(data),/旧 technique は使えません/);
});

test("a time-modified note needs matching visible tuplet metadata",()=>{
  const data=clone(shipped);
  const phrase=data.phrases.find(item=>item.id==="a7-blues-rock-eight-bars");
  phrase.tuplets.pop();
  assert.throws(()=>validatePhraseData(data),/連符表示情報が必要/);
});

test("bend sounding pitch must match its interval",()=>{
  const data=clone(shipped);
  const phrase=data.phrases.find(item=>item.id==="a7-blues-rock-eight-bars");
  phrase.notations.find(item=>item.type==="bend").targetName="A4";
  assert.throws(()=>validatePhraseData(data),/targetName がbendAlterと一致しません/);
});

test("hammer-ons and pull-offs keep technical text separate from their slur",()=>{
  const data=clone(shipped);
  const phrase=data.phrases.find(item=>item.id==="a7-blues-rock-eight-bars");
  phrase.notations=phrase.notations.filter(item=>
    !(item.type==="slur"&&item.from==="a7-m2-c")
  );
  assert.throws(()=>validatePhraseData(data),/別の包括スラーが必要/);
});
