import {
  actualBeatsFromNotation,
  beatsPerMeasure,
  NOTE_TYPE_BEATS,
  noteToMidi,
  OPEN_MIDI,
  SUPPORTED_KEYS,
} from "../core/music.js";

const EPSILON=1e-9;
const SUPPORTED_CHORD=/^(?:[A-G](?:#|b)?)(?:m)?(?:7)?$/;
const RIGHT_HAND=new Set(["p","i","m","a","D","U"]);
const SPANNERS=new Set(["tie","slur","hammer-on","pull-off","slide","palm-mute"]);
const LOCAL_NOTATIONS=new Set(["bend","harmonic"]);
const NOTATION_TYPES=new Set([...SPANNERS,...LOCAL_NOTATIONS,"vibrato"]);
const PLACEMENTS=new Set(["above","below"]);

function fail(message){
  throw new Error(message);
}

function assert(condition,message){
  if(!condition) fail(message);
}

function closeTo(left,right){
  return Math.abs(Number(left)-Number(right))<EPSILON;
}

function pitch(name,context){
  try{
    return noteToMidi(name);
  }catch{
    fail(context+": 音名 '"+name+"' が不正です");
  }
}

function validateTimeModification(note,context){
  if(note.technique!==undefined) fail(context+": 旧 technique は使えません。phrase.notations を使ってください");
  assert(Number.isFinite(note.beats)&&note.beats>0,context+": beats は0より大きい必要があります");

  if(note.notated!==undefined){
    assert(note.notated&&typeof note.notated==="object",context+": notated はオブジェクトである必要があります");
    assert(NOTE_TYPE_BEATS[note.notated.type]!==undefined,context+": 未対応の記譜音価です");
    const dots=note.notated.dots??0;
    assert(Number.isInteger(dots)&&dots>=0&&dots<=3,context+": dots は0〜3の整数である必要があります");
  }

  if(note.timeModification!==undefined){
    const modification=note.timeModification;
    assert(note.notated,context+": timeModification には notated.type が必要です");
    assert(modification&&typeof modification==="object",context+": timeModification はオブジェクトである必要があります");
    assert(Number.isInteger(modification.actualNotes)&&modification.actualNotes>0,
      context+": actualNotes は正の整数である必要があります");
    assert(Number.isInteger(modification.normalNotes)&&modification.normalNotes>0,
      context+": normalNotes は正の整数である必要があります");
    assert(NOTE_TYPE_BEATS[modification.normalType]!==undefined,
      context+": normalType は対応済みの記譜音価である必要があります");
  }

  let represented;
  try{
    represented=actualBeatsFromNotation(note);
  }catch(error){
    fail(context+": "+error.message);
  }
  assert(closeTo(note.beats,represented),
    context+": 演奏拍数が記譜音価と連符比に一致しません");
}

function validateTuplets(phrase,noteById,noteInfo){
  const tuplets=phrase.tuplets??[];
  assert(Array.isArray(tuplets),phrase.id+": tuplets は配列である必要があります");
  const ids=new Set();
  const covered=new Set();

  tuplets.forEach((tuplet,index)=>{
    const context=phrase.id+": 連符 "+index;
    assert(tuplet&&typeof tuplet==="object",context+" はオブジェクトである必要があります");
    assert(typeof tuplet.id==="string"&&tuplet.id,context+" に id が必要です");
    assert(!ids.has(tuplet.id),context+" の id が重複しています");
    ids.add(tuplet.id);
    const first=noteById.get(tuplet.from);
    const last=noteById.get(tuplet.to);
    assert(first&&last,context+" が未知の音符を参照しています");
    const firstInfo=noteInfo.get(first);
    const lastInfo=noteInfo.get(last);
    assert(firstInfo.measure===lastInfo.measure,context+" は小節線を跨げません");
    assert(firstInfo.index<=lastInfo.index,context+" の範囲が逆順です");
    assert(Number.isInteger(tuplet.actualNotes)&&tuplet.actualNotes>1,context+" actualNotes は2以上の整数が必要です");
    assert(Number.isInteger(tuplet.normalNotes)&&tuplet.normalNotes>0,context+" normalNotes は正の整数が必要です");
    assert(typeof tuplet.bracket==="boolean",context+" bracket を明示してください");
    assert(["actual","both","none"].includes(tuplet.showNumber),context+" showNumber が不正です");
    assert(PLACEMENTS.has(tuplet.placement),context+" placement が不正です");

    const range=phrase.notes.slice(firstInfo.index,lastInfo.index+1);
    assert(range.length===tuplet.actualNotes,context+" は actualNotes と同数の音符を範囲に含む必要があります");
    range.forEach(note=>{
      const modification=note.timeModification;
      assert(modification,context+" に timeModification の無い音符が含まれます");
      assert(modification.actualNotes===tuplet.actualNotes&&modification.normalNotes===tuplet.normalNotes,
        context+" の比率が音符側と一致しません");
      assert(note.notated?.type===modification.normalType,
        context+" normalType が記譜音価と一致しません");
      const info=noteInfo.get(note);
      assert(!covered.has(info.index),context+" が別の表示連符と重なっています");
      covered.add(info.index);
    });
  });

  phrase.notes.forEach((note,index)=>{
    if(note.timeModification) assert(covered.has(index),
      phrase.id+": 時間変更付き音符 "+index+" に連符表示情報が必要です");
  });
}

function validateNotations(phrase,noteById,noteInfo){
  const notations=phrase.notations??[];
  assert(Array.isArray(notations),phrase.id+": notations は配列である必要があります");
  const unique=new Set();
  const slurRanges=[];

  notations.forEach((notation,index)=>{
    const context=phrase.id+": 記譜 "+index;
    assert(notation&&typeof notation==="object",context+" はオブジェクトである必要があります");
    assert(NOTATION_TYPES.has(notation.type),context+" に未対応の type '"+notation.type+"' があります");
    if(notation.placement!==undefined) assert(PLACEMENTS.has(notation.placement),context+" placement が不正です");
    if(notation.number!==undefined) assert(Number.isInteger(notation.number)&&notation.number>0,
      context+" number は正の整数である必要があります");

    if(notation.type==="bend"){
      const note=noteById.get(notation.note);
      assert(note,context+" が未知の音符を参照しています");
      assert(Number.isFinite(notation.bendAlter)&&notation.bendAlter>0,context+" bendAlter は0より大きい必要があります");
      const target=pitch(notation.targetName,context);
      assert(closeTo(target-pitch(note.name,context),notation.bendAlter),
        context+" targetName がbendAlterと一致しません");
    }else if(notation.type==="harmonic"){
      assert(noteById.has(notation.note),context+" が未知の音符を参照しています");
      assert(["natural","artificial"].includes(notation.kind),context+" harmonic kind が不正です");
    }else if(notation.type==="vibrato"&&notation.note){
      assert(noteById.has(notation.note),context+" が未知の音符を参照しています");
    }else{
      const from=noteById.get(notation.from);
      const to=noteById.get(notation.to);
      assert(from&&to,context+" が未知の音符を参照しています");
      const fromInfo=noteInfo.get(from);
      const toInfo=noteInfo.get(to);
      assert(fromInfo.index<toInfo.index,context+" の範囲は前方へ進む必要があります");
      if(notation.type==="palm-mute") assert(fromInfo.measure===toInfo.measure,
        context+" のパームミュートは小節線を跨げません");
      if(notation.type==="tie") assert(pitch(from.name,context)===pitch(to.name,context),
        context+" のタイは同じ音高同士を結ぶ必要があります");
      if(["hammer-on","pull-off","slide"].includes(notation.type)){
        assert(from.string===to.string,context+" は同じ弦上で行う必要があります");
      }
      if(notation.type==="hammer-on"){
        assert(to.fret>from.fret,context+" は高いフレットへ進む必要があります");
        if(notation.label!==undefined) assert(notation.label==="H",context+" label は H である必要があります");
      }
      if(notation.type==="pull-off"){
        assert(to.fret<from.fret,context+" は低いフレットへ進む必要があります");
        if(notation.label!==undefined) assert(notation.label==="P",context+" label は P である必要があります");
      }
      if(notation.type==="slide") assert(to.fret!==from.fret,context+" には異なるフレットが必要です");
      if(notation.type==="slur") slurRanges.push([fromInfo.index,toInfo.index]);
    }

    const identity=[notation.type,notation.note??notation.from,notation.to??""].join(":");
    assert(!unique.has(identity),context+" が重複しています");
    unique.add(identity);
  });

  notations.forEach((notation,index)=>{
    if(notation.type!=="hammer-on"&&notation.type!=="pull-off") return;
    const from=noteInfo.get(noteById.get(notation.from)).index;
    const to=noteInfo.get(noteById.get(notation.to)).index;
    assert(slurRanges.some(([start,stop])=>start<=from&&stop>=to),
      phrase.id+": 記譜 "+index+" には別の包括スラーが必要です");
  });
}

function validatePhrase(phrase){
  assert(phrase&&typeof phrase==="object","phrase はオブジェクトである必要があります");
  assert(phrase.id,"フレーズ id が必要です");
  assert(phrase.title&&phrase.objective,phrase.id+": title と objective が必要です");
  assert(phrase.key&&phrase.keyLabel,phrase.id+": key と keyLabel が必要です");
  assert(SUPPORTED_KEYS.has(phrase.key),phrase.id+": key '"+phrase.key+"' の調号に対応していません");
  assert(phrase.timeSignature==="4/4",phrase.id+": 現在対応する拍子は4/4のみです");
  assert(Number.isInteger(phrase.measures)&&phrase.measures>=4,phrase.id+": 4小節以上が必要です");
  assert(Number.isFinite(phrase.bpm)&&phrase.bpm>=40&&phrase.bpm<=200,phrase.id+": bpm は40〜200である必要があります");
  assert(Array.isArray(phrase.chords)&&phrase.chords.length===phrase.measures,
    phrase.id+": 各小節にコード1つが必要です");
  phrase.chords.forEach((chord,index)=>assert(SUPPORTED_CHORD.test(chord),
    phrase.id+": 第"+(index+1)+"小節のコードに対応していません"));
  assert(Array.isArray(phrase.notes)&&phrase.notes.length>0,phrase.id+": notes が必要です");
  assert(phrase.rightHand,phrase.id+": rightHand が必要です");

  const fingers=String(phrase.rightHandSequence??phrase.rightHand).trim().split(/\s+/).filter(Boolean);
  assert(fingers.length===phrase.notes.length,phrase.id+": rightHandSequence の数が音符数と一致しません");
  const noteById=new Map();
  const noteInfo=new Map();
  const barLength=beatsPerMeasure(phrase.timeSignature);
  let totalBeats=0;
  let barBeats=0;
  let measure=0;

  phrase.notes.forEach((note,index)=>{
    const context=phrase.id+": 音符 "+index;
    assert(note&&typeof note==="object",context+" はオブジェクトである必要があります");
    const midi=pitch(note.name,context);
    assert(Number.isInteger(note.string)&&note.string>=1&&note.string<=6,context+": string が不正です");
    assert(Number.isInteger(note.fret)&&note.fret>=0&&note.fret<=24,context+": fret が不正です");
    assert(RIGHT_HAND.has(note.finger),context+": 右手記号が不正です");
    assert(fingers[index]===note.finger,context+": rightHandSequence と finger が一致しません");
    assert(midi===OPEN_MIDI[note.string]+note.fret,context+": 音名とTABが一致しません ("+note.name+")");
    validateTimeModification(note,context);
    if(note.id!==undefined){
      assert(typeof note.id==="string"&&note.id,context+": id は空でない文字列が必要です");
      assert(!noteById.has(note.id),context+": id '"+note.id+"' が重複しています");
      noteById.set(note.id,note);
    }
    noteInfo.set(note,{index,measure});

    totalBeats+=note.beats;
    barBeats+=note.beats;
    assert(barBeats<=barLength+EPSILON,context+": 音符が小節境界を越えています");
    if(closeTo(barBeats,barLength)){
      measure+=1;
      barBeats=0;
    }
  });

  assert(closeTo(totalBeats,phrase.measures*barLength),phrase.id+": 総拍数と小節数が一致しません");
  assert(measure===phrase.measures&&closeTo(barBeats,0),phrase.id+": 不完全な小節があります");
  validateTuplets(phrase,noteById,noteInfo);
  validateNotations(phrase,noteById,noteInfo);
}

export function validatePhraseData(data){
  assert(data&&typeof data==="object","フレーズデータはオブジェクトである必要があります");
  assert(data.schemaVersion===3,"phrases schemaVersion は3である必要があります");
  assert(Array.isArray(data.phrases)&&data.phrases.length>0,"phrases は空にできません");
  const ids=new Set();
  data.phrases.forEach(phrase=>{
    assert(!ids.has(phrase.id),"phrase id は重複できません");
    ids.add(phrase.id);
    validatePhrase(phrase);
  });
  return data;
}
