export const ASSIST_LABELS=Object.freeze({
  full:"音名・TAB・運指あり",
  "no-names":"音名なし",
  staff:"五線譜のみ",
  memory:"暗譜（譜面なし）"
});

export const SELF_REVIEW_KEYS=Object.freeze(["noise","evenness","tone","flow"]);

export const FOCUS_MODES=Object.freeze({
  reading:"譜読み",
  rhythm:"リズム",
  execution:"演奏動作",
  integrated:"統合演奏"
});

export const FOCUS_MODE_KEYS=Object.freeze(Object.keys(FOCUS_MODES));

export function normalizeFocusMode(value){
  const focusMode=value===undefined?"integrated":value;
  if(!Object.hasOwn(FOCUS_MODES,focusMode)) throw new Error("練習focusが不正です。");
  return focusMode;
}

export function practiceRange(total,start=1,end=total){
  const bounded=value=>Math.max(1,Math.min(total,Math.round(Number(value)||1)));
  const first=bounded(start);
  return {start:first,end:Math.max(first,bounded(end))};
}

// Scheduling actual beat positions avoids a fixed tick grid rejecting valid
// 32nd notes, dotted durations, or quintuplets accepted by the score schema.
export function buildPracticeTimeline(model,range){
  const {start,end}=practiceRange(model.measures.length,range.start,range.end);
  const firstBeat=(start-1)*model.beatsPerBar;
  const lengthBeats=(end-start+1)*model.beatsPerBar;
  const selected=model.notes.filter(note=>note.measureIndex>=start-1&&note.measureIndex<end);
  const selectedIds=new Set(selected.filter(note=>note.id).map(note=>note.id));
  const ties=model.notations.filter(mark=>mark.type==="tie");
  const forward=new Map(ties.map(mark=>[mark.from,mark.to]));
  const continued=new Set(ties.filter(mark=>selectedIds.has(mark.from)).map(mark=>mark.to));
  const events=new Map();
  const eventAt=beat=>{
    const key=Math.round(beat*1e9);
    if(!events.has(key)) events.set(key,{beat,notes:[]});
    return events.get(key);
  };

  for(const note of selected){
    const beat=note.measureIndex*model.beatsPerBar+note.startBeat-firstBeat;
    let durationBeats=Number(note.beats);
    let nextId=forward.get(note.id);
    const visited=new Set();
    while(nextId&&selectedIds.has(nextId)&&!visited.has(nextId)){
      visited.add(nextId);
      const next=model.noteById.get(nextId);
      durationBeats+=Number(next.beats);
      nextId=forward.get(next.id);
    }
    eventAt(beat).notes.push({
      note,index:note.globalIndex,attack:!continued.has(note.id),
      durationBeats:Math.min(durationBeats,lengthBeats-beat)
    });
  }
  for(let beat=0;beat<lengthBeats;beat+=.5){
    const absolute=firstBeat+beat;
    eventAt(beat).backing={
      measure:Math.floor(absolute/model.beatsPerBar),
      eighth:Math.round((absolute%model.beatsPerBar)*2)
    };
  }
  return {events:[...events.values()].sort((a,b)=>a.beat-b.beat),lengthBeats};
}

function requireValue(condition,message){
  if(!condition) throw new Error(message);
}

function validateSelfReview(review){
  if(review===undefined) return undefined;
  requireValue(review&&typeof review==="object"&&!Array.isArray(review),"自己レビューの形式が不正です。");
  const result={};
  for(const key of SELF_REVIEW_KEYS){
    requireValue(Number.isInteger(review[key])&&review[key]>=1&&review[key]<=3,"自己レビューは1〜3で記録してください。");
    result[key]=review[key];
  }
  requireValue(Object.keys(review).every(key=>SELF_REVIEW_KEYS.includes(key)),"自己レビューに未対応の項目があります。");
  return result;
}

export function validateAttempt(value){
  requireValue(value&&typeof value==="object","練習記録の形式が不正です。");
  const {id,phraseId,date,conditions:c,observed:o,reported:r}=value;
  const focusMode=normalizeFocusMode(c?.focusMode);
  requireValue(typeof id==="string"&&id.length>0&&id.length<=100,"記録IDが不正です。");
  requireValue(typeof phraseId==="string"&&phraseId.length>0&&phraseId.length<=100,"フレーズIDが不正です。");
  requireValue(typeof date==="string"&&Number.isFinite(Date.parse(date)),"記録日時が不正です。");
  requireValue(c&&o&&r,"練習条件・再生結果・自己評価が必要です。");
  requireValue(Number.isInteger(c.tempo)&&c.tempo>=40&&c.tempo<=160,"テンポが範囲外です。");
  requireValue(Object.hasOwn(ASSIST_LABELS,c.assist),"表示補助が不正です。");
  requireValue(Number.isInteger(c.start)&&Number.isInteger(c.end)&&c.start>=1&&c.end>=c.start&&c.end<=10000,"小節区間が不正です。");
  requireValue(typeof c.melody==="boolean"&&[0,1,2].includes(c.countIn),"再生条件が不正です。");
  requireValue(Array.isArray(c.backing)&&c.backing.every(part=>["chords","bass","drums"].includes(part))&&new Set(c.backing).size===c.backing.length,"伴奏条件が不正です。");
  requireValue(typeof o.transportCompleted==="boolean"&&Number.isInteger(o.completedLoops)&&o.completedLoops>=0&&o.completedLoops<=100000,"再生結果が不正です。");
  requireValue(o.transportCompleted===(o.completedLoops>0),"再生完了と反復回数が一致しません。");
  requireValue(Number.isFinite(o.elapsedSec)&&o.elapsedSec>=0&&o.elapsedSec<=604800,"練習時間が不正です。");
  requireValue(typeof r.clean==="boolean","自己評価が不正です。");
  requireValue(!r.clean||o.transportCompleted||focusMode==="reading","区間の再生完了前には達成を記録できません。");
  const review=validateSelfReview(r.review);
  const reported={clean:r.clean};
  if(review) reported.review=review;
  // Rebuild records instead of trusting imported assessment or measured fields.
  return {
    id,phraseId,date,
    conditions:{tempo:c.tempo,start:c.start,end:c.end,assist:c.assist,melody:c.melody,countIn:c.countIn,backing:[...c.backing],focusMode},
    observed:{transportCompleted:o.transportCompleted,completedLoops:o.completedLoops,elapsedSec:o.elapsedSec},
    reported,
    assessment:{status:r.clean?"provisional":"fail",basis:"reported"}
  };
}

export function parsePracticeBackup(text){
  requireValue(typeof text==="string"&&text.length<=5_000_000,"バックアップは5MB以下にしてください。");
  const data=JSON.parse(text);
  requireValue(data?.format==="guitar-phrase-practice"&&data.version===1&&Array.isArray(data.attempts),"対応する練習記録のバックアップではありません。");
  requireValue(data.attempts.length<=10000,"一度に読み込める記録は1万件までです。");
  const attempts=data.attempts.map(validateAttempt);
  requireValue(new Set(attempts.map(item=>item.id)).size===attempts.length,"バックアップ内に重複した記録IDがあります。");
  return attempts;
}

export function practiceAdvice(attempts,conditions){
  const expectedFocus=normalizeFocusMode(conditions.focusMode);
  const same=attempt=>["tempo","start","end","assist","melody","countIn"].every(key=>attempt.conditions[key]===conditions[key])
    &&normalizeFocusMode(attempt.conditions.focusMode)===expectedFocus
    &&[...attempt.conditions.backing].sort().join() === [...conditions.backing].sort().join();
  const recent=attempts.filter(same).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  if(!recent.length) return "同じ区間を2回、止まらず音を揃えて弾けるか確認しましょう。";
  if(!recent[0].reported.clean) return "同じ区間をゆっくり再確認。難しければテンポを4下げて、補助は今のまま練習しましょう。";
  if(recent.length<2||!recent[1].reported.clean) return "同じ条件でもう1回確認しましょう。成功は自己評価として記録しています。";
  return "同じ条件で2回達成（自己評価）。次回も再現できたら、次の区間かテンポ＋2を試しましょう。";
}

export function practiceFocusComparisonKey(value){
  const conditions=value?.conditions??value;
  const phraseId=value?.phraseId;
  requireValue(typeof phraseId==="string"&&phraseId.length>0,"診断比較のフレーズIDが不正です。");
  requireValue(Number.isInteger(conditions?.start)&&Number.isInteger(conditions?.end)&&conditions.start>=1&&conditions.end>=conditions.start,"診断比較の小節区間が不正です。");
  requireValue(Number.isInteger(conditions?.tempo)&&conditions.tempo>=40&&conditions.tempo<=160,"診断比較のテンポが不正です。");
  return JSON.stringify([phraseId,conditions.start,conditions.end,conditions.tempo]);
}

export function practiceFocusStatuses(attempts,target){
  const key=practiceFocusComparisonKey(target);
  const matching=attempts
    .filter(attempt=>practiceFocusComparisonKey(attempt)===key)
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  const statuses={};
  for(const focusMode of FOCUS_MODE_KEYS){
    const latest=matching.find(attempt=>normalizeFocusMode(attempt.conditions.focusMode)===focusMode);
    statuses[focusMode]=latest
      ?{status:latest.reported.clean?"success":"fail",attemptId:latest.id,date:latest.date}
      :{status:"unknown",attemptId:null,date:null};
  }
  return statuses;
}

export function practiceFocusDiagnosis(attempts,target){
  const statuses=practiceFocusStatuses(attempts,target);
  const foundations=["reading","rhythm","execution"];
  const failed=foundations.filter(mode=>statuses[mode].status==="fail");
  const unknown=foundations.filter(mode=>statuses[mode].status==="unknown");
  const integrated=statuses.integrated.status;

  if(integrated==="success"){
    return {statuses,candidates:[],recommendation:{action:"advance",focusMode:"integrated",tempoDelta:2},message:"統合演奏は達成（自己評価）。次の区間、またはテンポ＋2を候補にできます。"};
  }
  if(integrated!=="fail"){
    return {statuses,candidates:[],recommendation:{action:"check-integrated",focusMode:"integrated",tempoDelta:0},message:"同じ区間・テンポの統合演奏を記録すると、分解focusとの比較を開始できます。"};
  }
  if(failed.length===1){
    const focusMode=failed[0];
    return {statuses,candidates:[focusMode],recommendation:{action:"repeat-focus",focusMode,tempoDelta:0},message:"主ボトルネック候補: "+FOCUS_MODES[focusMode]+"（自己評価）。このfocusを再確認しましょう。"};
  }
  if(failed.length>1){
    return {statuses,candidates:failed,recommendation:{action:"repeat-focuses",focusModes:failed,tempoDelta:0},message:"ボトルネック候補: "+failed.map(mode=>FOCUS_MODES[mode]).join("・")+"（自己評価）。単一原因とは断定せず、順に確認しましょう。"};
  }
  if(unknown.length===0){
    return {statuses,candidates:["integrated"],recommendation:{action:"retry-integrated",focusMode:"integrated",tempoDelta:-4},message:"reading / rhythm / execution は達成、統合演奏は要復習です。統合負荷が残っているため、統合演奏をテンポ－4で再試行しましょう。"};
  }
  return {statuses,candidates:[],recommendation:{action:"check-foundations",focusModes:unknown,tempoDelta:0},message:"統合演奏は要復習です。未確認のreading / rhythm / executionを同じ区間・テンポで切り分けましょう。"};
}
