const PITCH_CLASS = Object.freeze({ C:0,D:2,E:4,F:5,G:7,A:9,B:11 });
const DIATONIC_LETTER = Object.freeze({ C:0,D:1,E:2,F:3,G:4,A:5,B:6 });

export const OPEN_MIDI = Object.freeze({ 1:64,2:59,3:55,4:50,5:45,6:40 });

export const NOTE_TYPE_BEATS = Object.freeze({
  whole:4,
  half:2,
  quarter:1,
  eighth:.5,
  "16th":.25,
  "32nd":.125
});

export const VEX_DURATION = Object.freeze({
  whole:"w",
  half:"h",
  quarter:"q",
  eighth:"8",
  "16th":"16",
  "32nd":"32"
});

const SHARP_ORDER=Object.freeze([["F",66],["C",84],["G",60],["D",78],["A",96],["E",72],["B",90]]);
const FLAT_ORDER=Object.freeze([["B",90],["E",72],["A",96],["D",78],["G",102],["C",84],["F",108]]);

export const KEY_FIFTHS=Object.freeze({
  C:0,Am:0,
  G:1,Em:1,D:2,Bm:2,A:3,"F#m":3,E:4,"C#m":4,B:5,"G#m":5,
  F:-1,Dm:-1,Bb:-2,Gm:-2,Eb:-3,Cm:-3,Ab:-4,Fm:-4,Db:-5,Bbm:-5
});

export const SUPPORTED_KEYS=Object.freeze(new Set(Object.keys(KEY_FIFTHS)));

export function noteParts(name){
  const match=/^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if(!match) throw new Error("Invalid note: "+name);
  return {letter:match[1],accidental:match[2],octave:Number(match[3])};
}

export function noteToMidi(name){
  const part=noteParts(name);
  const accidental=part.accidental==="#"?1:part.accidental==="b"?-1:0;
  return (part.octave+1)*12+PITCH_CLASS[part.letter]+accidental;
}

export function midiToFrequency(midi){
  return 440*Math.pow(2,(midi-69)/12);
}

export function noteToFrequency(name){
  return midiToFrequency(noteToMidi(name));
}

export function staffY(name){
  const part=noteParts(name);
  // Guitar sounds one octave below the written treble staff.
  const writtenOctave=part.octave+1;
  const index=writtenOctave*7+DIATONIC_LETTER[part.letter];
  const bottomE4=4*7+DIATONIC_LETTER.E;
  return 114-(index-bottomE4)*6;
}

export function writtenVexKey(name){
  const part=noteParts(name);
  return part.letter.toLowerCase()+part.accidental+"/"+(part.octave+1);
}

export function keySignature(key){
  const fifths=KEY_FIFTHS[key];
  if(fifths===undefined) return {glyphs:[],alterByLetter:{}};
  const glyph=fifths>0?"♯":"♭";
  const alter=fifths>0?1:-1;
  const source=fifths>0?SHARP_ORDER:FLAT_ORDER;
  const used=source.slice(0,Math.abs(fifths));
  const alterByLetter={};
  used.forEach(([letter])=>{ alterByLetter[letter]=alter; });
  return {glyphs:used.map(([letter,y])=>({letter,y,glyph})),alterByLetter};
}

function alterationOf(name){
  const accidental=noteParts(name).accidental;
  return accidental==="#"?1:accidental==="b"?-1:0;
}

export function annotateAccidentals(measures,key){
  const signature=keySignature(key);
  for(const measure of measures){
    const activeInBar=new Map();
    for(const note of measure){
      const parts=noteParts(note.name);
      const slot=parts.letter+parts.octave;
      const expected=activeInBar.has(slot)
        ? activeInBar.get(slot)
        : (signature.alterByLetter[parts.letter]??0);
      const actual=alterationOf(note.name);
      note.accidentalGlyph=actual===expected
        ? null
        : actual===1?"♯":actual===-1?"♭":"♮";
      if(actual!==expected) activeInBar.set(slot,actual);
    }
  }
  return signature;
}

export function beatsPerMeasure(timeSignature){
  const match=/^(\d+)\/(\d+)$/.exec(String(timeSignature));
  if(!match) throw new Error("Invalid time signature: "+timeSignature);
  return Number(match[1])*(4/Number(match[2]));
}

export function dotMultiplier(dots=0){
  let factor=1;
  let value=.5;
  for(let index=0;index<Number(dots||0);index+=1){
    factor+=value;
    value/=2;
  }
  return factor;
}

export function writtenBeats(note){
  if(note.notated){
    const base=NOTE_TYPE_BEATS[note.notated.type];
    if(base===undefined) throw new Error("Unsupported note type: "+note.notated.type);
    return base*dotMultiplier(note.notated.dots);
  }

  const beats=Number(note.beats);
  const inferred=Object.entries(NOTE_TYPE_BEATS).find(([,value])=>Math.abs(value-beats)<1e-9);
  if(!inferred) throw new Error("A non-standard duration needs notated.type");
  return inferred[1];
}

export function actualBeatsFromNotation(note){
  const written=writtenBeats(note);
  const modification=note.timeModification;
  if(!modification) return written;
  return written*(Number(modification.normalNotes)/Number(modification.actualNotes));
}

export function vexDuration(note){
  if(note.notated) return VEX_DURATION[note.notated.type];
  const beats=Number(note.beats);
  const inferred=Object.entries(NOTE_TYPE_BEATS).find(([,value])=>Math.abs(value-beats)<1e-9);
  if(!inferred) throw new Error("A non-standard duration needs notated.type");
  return VEX_DURATION[inferred[0]];
}

export function splitMeasures(phrase){
  const barLength=beatsPerMeasure(phrase.timeSignature);
  const result=[];
  let current=[];
  let beats=0;
  phrase.notes.forEach((note,globalIndex)=>{
    const duration=Number(note.beats);
    const event={...note,globalIndex,startBeat:beats,measureIndex:result.length};
    current.push(event);
    beats+=duration;
    if(beats>barLength+1e-9) throw new Error("Note crosses a measure boundary at index "+globalIndex);
    if(Math.abs(beats-barLength)<1e-9){
      result.push(current);
      current=[];
      beats=0;
    }
  });
  if(current.length) result.push(current);
  return result;
}

export function buildPhraseModel(phrase){
  const measures=splitMeasures(phrase);
  const signature=annotateAccidentals(measures,phrase.key);
  const notes=measures.flat();
  const noteById=new Map(notes.filter(note=>note.id).map(note=>[note.id,note]));
  return {
    phrase,
    measures,
    notes,
    noteById,
    signature,
    beatsPerBar:beatsPerMeasure(phrase.timeSignature),
    tuplets:phrase.tuplets??[],
    notations:phrase.notations??[]
  };
}

export function bendLabel(alter){
  const value=Number(alter);
  if(Math.abs(value-.5)<1e-9) return "¼";
  if(Math.abs(value-1)<1e-9) return "½";
  if(Math.abs(value-2)<1e-9) return "Full";
  if(Math.abs(value-3)<1e-9) return "1½";
  return (value/2).toFixed(1).replace(/\.0$/g,"");
}
