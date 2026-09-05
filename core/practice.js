export const ASSIST_LABELS=Object.freeze({
  full:"音名・TAB・運指あり",
  "no-names":"音名なし",
  staff:"五線譜のみ",
  memory:"暗譜（譜面なし）"
});

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

export function validateAttempt(value){
  requireValue(value&&typeof value==="object","練習記録の形式が不正です。");
  const {id,phraseId,date,conditions:c,observed:o,reported:r}=value;
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
  requireValue(!r.clean||o.transportCompleted,"区間の再生完了前には達成を記録できません。");
  // Rebuild records instead of trusting imported assessment or measured fields.
  return {
    id,phraseId,date,
    conditions:{tempo:c.tempo,start:c.start,end:c.end,assist:c.assist,melody:c.melody,countIn:c.countIn,backing:[...c.backing]},
    observed:{transportCompleted:o.transportCompleted,completedLoops:o.completedLoops,elapsedSec:o.elapsedSec},
    reported:{clean:r.clean},
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
  const same=attempt=>["tempo","start","end","assist","melody","countIn"].every(key=>attempt.conditions[key]===conditions[key])
    &&[...attempt.conditions.backing].sort().join() === [...conditions.backing].sort().join();
  const recent=attempts.filter(same).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  if(!recent.length) return "同じ区間を2回、止まらず音を揃えて弾けるか確認しましょう。";
  if(!recent[0].reported.clean) return "同じ区間をゆっくり再確認。難しければテンポを4下げて、補助は今のまま練習しましょう。";
  if(recent.length<2||!recent[1].reported.clean) return "同じ条件でもう1回確認しましょう。成功は自己評価として記録しています。";
  return "同じ条件で2回達成（自己評価）。次回も再現できたら、次の区間かテンポ＋2を試しましょう。";
}
