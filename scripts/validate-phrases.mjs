import fs from "node:fs";

const file = new URL("../data/phrases.json", import.meta.url);
const data = JSON.parse(fs.readFileSync(file, "utf8"));

if (data.schemaVersion !== 2) throw new Error("phrases schemaVersion must be 2");
if (!Array.isArray(data.phrases) || data.phrases.length === 0) throw new Error("phrases must not be empty");

const seen = new Set();
const notePattern = /^([A-G])([#b]?)(-?\d+)$/;
const pitchClass = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 };
const openMidi = { 1:64,2:59,3:55,4:50,5:45,6:40 };
const supportedChords = /^(?:[A-G](?:#|b)?)(?:m)?(?:7)?$/;
const allowedDurations = new Set([0.5,1,2,4]);
const allowedRightHand = new Set(["p","i","m","a","D","U"]);
const allowedTechniques = new Set(["hammer","pull","slide","full-step-bend"]);
const techniquePitchOffsets = new Map([["full-step-bend",2]]);
// Must stay in step with keyFifths in phrase.js: anything outside this set
// would render with no key signature, which is a silently wrong score.
const supportedKeys = new Set([
  "C","Am","G","Em","D","Bm","A","F#m","E","C#m","B","G#m",
  "F","Dm","Bb","Gm","Eb","Cm","Ab","Fm","Db","Bbm"
]);

function noteToMidi(name){
  const match=notePattern.exec(name);
  if(!match) return null;
  const accidental=match[2]==="#"?1:match[2]==="b"?-1:0;
  return (Number(match[3])+1)*12+pitchClass[match[1]]+accidental;
}

for(const phrase of data.phrases){
  if(!phrase.id || seen.has(phrase.id)) throw new Error("phrase id must be unique");
  seen.add(phrase.id);

  if(!phrase.title || !phrase.objective) throw new Error(phrase.id+": title/objective required");
  if(!phrase.key || !phrase.keyLabel) throw new Error(phrase.id+": key/keyLabel required");
  if(!supportedKeys.has(phrase.key)) throw new Error(phrase.id+": key '"+phrase.key+"' has no key signature in the renderer");
  if(phrase.timeSignature!=="4/4") throw new Error(phrase.id+": only 4/4 is supported");
  if(!Number.isInteger(phrase.measures) || phrase.measures<4) throw new Error(phrase.id+": at least 4 measures required");
  if(!Number.isFinite(phrase.bpm) || phrase.bpm<40 || phrase.bpm>200) throw new Error(phrase.id+": bpm out of range");
  if(!Array.isArray(phrase.chords) || phrase.chords.length!==phrase.measures) throw new Error(phrase.id+": one chord per measure required");
  phrase.chords.forEach((chord,index)=>{
    if(!supportedChords.test(chord)) throw new Error(phrase.id+": unsupported chord at measure "+(index+1));
  });

  if(!Array.isArray(phrase.notes) || phrase.notes.length===0) throw new Error(phrase.id+": notes required");
  if(!phrase.rightHand) throw new Error(phrase.id+": rightHand required");
  const fingers=String(phrase.rightHandSequence??phrase.rightHand).trim().split(/\s+/).filter(Boolean);
  if(fingers.length!==phrase.notes.length) throw new Error(phrase.id+": rightHand count must match notes");

  let totalBeats=0;
  let barBeats=0;
  let bars=0;

  phrase.notes.forEach((note,index)=>{
    const midi=noteToMidi(note.name);
    if(midi===null) throw new Error(phrase.id+": invalid note at "+index);
    if(!Number.isInteger(note.string)||note.string<1||note.string>6) throw new Error(phrase.id+": invalid string at "+index);
    if(!Number.isInteger(note.fret)||note.fret<0||note.fret>24) throw new Error(phrase.id+": invalid fret at "+index);
    if(!allowedDurations.has(note.beats)) throw new Error(phrase.id+": unsupported duration at "+index);
    if(!allowedRightHand.has(note.finger)) throw new Error(phrase.id+": invalid right-hand finger at "+index);
    if(note.technique&&!allowedTechniques.has(note.technique)) throw new Error(phrase.id+": invalid technique at "+index);

    const tabMidi=openMidi[note.string]+note.fret;
    const expectedMidi=tabMidi+(techniquePitchOffsets.get(note.technique)??0);
    if(midi!==expectedMidi) throw new Error(phrase.id+": pitch/TAB mismatch at note "+index+" ("+note.name+")");
    if(fingers[index]!==note.finger) throw new Error(phrase.id+": rightHand sequence mismatch at note "+index);

    totalBeats+=note.beats;
    barBeats+=note.beats;
    if(barBeats>4+1e-9) throw new Error(phrase.id+": note crosses measure boundary near note "+index);
    if(Math.abs(barBeats-4)<1e-9){ bars+=1; barBeats=0; }
  });

  if(Math.abs(totalBeats-phrase.measures*4)>1e-9) throw new Error(phrase.id+": total beats do not match measure count");
  if(bars!==phrase.measures || Math.abs(barBeats)>1e-9) throw new Error(phrase.id+": incomplete measure");
}

console.log("Validated "+data.phrases.length+" musical phrases with key, bars, harmony and pitch/TAB consistency.");
