import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path,before,after){
  const source=await readFile(path,"utf8");
  if(!source.includes(before)) throw new Error(`${path}: expected source not found`);
  const updated=source.replace(before,after);
  if(updated===source) throw new Error(`${path}: replacement made no change`);
  await writeFile(path,updated);
}

// Shared Attempt schema and focus-specific diagnosis.
await replaceOnce(
  "core/practice.js",
  'export const SELF_REVIEW_KEYS=Object.freeze(["noise","evenness","tone","flow"]);',
  `export const SELF_REVIEW_KEYS=Object.freeze(["noise","evenness","tone","flow"]);\n\nexport const FOCUS_MODES=Object.freeze({\n  reading:"譜読み",\n  rhythm:"リズム",\n  execution:"演奏動作",\n  integrated:"統合演奏"\n});\n\nexport const FOCUS_MODE_KEYS=Object.freeze(Object.keys(FOCUS_MODES));\n\nexport function normalizeFocusMode(value){\n  const focusMode=value===undefined?"integrated":value;\n  if(!Object.hasOwn(FOCUS_MODES,focusMode)) throw new Error("練習focusが不正です。");\n  return focusMode;\n}`
);

await replaceOnce(
  "core/practice.js",
  '  const {id,phraseId,date,conditions:c,observed:o,reported:r}=value;\n  requireValue(typeof id==="string"&&id.length>0&&id.length<=100,"記録IDが不正です。");',
  '  const {id,phraseId,date,conditions:c,observed:o,reported:r}=value;\n  const focusMode=normalizeFocusMode(c?.focusMode);\n  requireValue(typeof id==="string"&&id.length>0&&id.length<=100,"記録IDが不正です。");'
);

await replaceOnce(
  "core/practice.js",
  '  requireValue(!r.clean||o.transportCompleted,"区間の再生完了前には達成を記録できません。");',
  '  requireValue(!r.clean||o.transportCompleted||focusMode==="reading","区間の再生完了前には達成を記録できません。");'
);

await replaceOnce(
  "core/practice.js",
  '    conditions:{tempo:c.tempo,start:c.start,end:c.end,assist:c.assist,melody:c.melody,countIn:c.countIn,backing:[...c.backing]},',
  '    conditions:{tempo:c.tempo,start:c.start,end:c.end,assist:c.assist,melody:c.melody,countIn:c.countIn,backing:[...c.backing],focusMode},'
);

await replaceOnce(
  "core/practice.js",
  `export function practiceAdvice(attempts,conditions){\n  const same=attempt=>["tempo","start","end","assist","melody","countIn"].every(key=>attempt.conditions[key]===conditions[key])\n    &&[...attempt.conditions.backing].sort().join() === [...conditions.backing].sort().join();`,
  `export function practiceAdvice(attempts,conditions){\n  const expectedFocus=normalizeFocusMode(conditions.focusMode);\n  const same=attempt=>["tempo","start","end","assist","melody","countIn"].every(key=>attempt.conditions[key]===conditions[key])\n    &&normalizeFocusMode(attempt.conditions.focusMode)===expectedFocus\n    &&[...attempt.conditions.backing].sort().join() === [...conditions.backing].sort().join();`
);

const practicePath="core/practice.js";
let practiceSource=await readFile(practicePath,"utf8");
if(practiceSource.includes("export function practiceFocusDiagnosis")) throw new Error("practice focus helpers already exist");
practiceSource=practiceSource.trimEnd()+`\n\nexport function practiceFocusStatuses(attempts,{phraseId,start,end,tempo}){\n  const matching=attempts\n    .filter(attempt=>attempt.phraseId===phraseId\n      &&attempt.conditions.start===start\n      &&attempt.conditions.end===end\n      &&attempt.conditions.tempo===tempo)\n    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));\n  const statuses={};\n  for(const focusMode of FOCUS_MODE_KEYS){\n    const latest=matching.find(attempt=>normalizeFocusMode(attempt.conditions.focusMode)===focusMode);\n    statuses[focusMode]=latest\n      ?{status:latest.reported.clean?"success":"fail",attemptId:latest.id,date:latest.date}\n      :{status:"unknown",attemptId:null,date:null};\n  }\n  return statuses;\n}\n\nexport function practiceFocusDiagnosis(attempts,target){\n  const statuses=practiceFocusStatuses(attempts,target);\n  const foundations=["reading","rhythm","execution"];\n  const failed=foundations.filter(mode=>statuses[mode].status==="fail");\n  const unknown=foundations.filter(mode=>statuses[mode].status==="unknown");\n  const integrated=statuses.integrated.status;\n\n  if(integrated==="success"){\n    return {statuses,candidates:[],recommendation:{action:"advance",focusMode:"integrated",tempoDelta:2},message:"統合演奏は達成（自己評価）。次の区間、またはテンポ＋2を候補にできます。"};\n  }\n  if(failed.length===1){\n    const focusMode=failed[0];\n    return {statuses,candidates:[focusMode],recommendation:{action:"repeat-focus",focusMode,tempoDelta:0},message:"主ボトルネック候補: "+FOCUS_MODES[focusMode]+"（自己評価）。このfocusを再確認しましょう。"};\n  }\n  if(failed.length>1){\n    return {statuses,candidates:failed,recommendation:{action:"repeat-focuses",focusModes:failed,tempoDelta:0},message:"ボトルネック候補: "+failed.map(mode=>FOCUS_MODES[mode]).join("・")+"（自己評価）。単一原因とは断定せず、順に確認しましょう。"};\n  }\n  if(unknown.length===0&&integrated==="fail"){\n    return {statuses,candidates:["integrated"],recommendation:{action:"retry-integrated",focusMode:"integrated",tempoDelta:-4},message:"reading / rhythm / execution は達成、統合演奏は要復習です。統合演奏をテンポ－4で再試行しましょう。"};\n  }\n  if(integrated==="fail"){\n    return {statuses,candidates:[],recommendation:{action:"check-foundations",focusModes:unknown,tempoDelta:0},message:"統合演奏は要復習です。未確認のreading / rhythm / executionを同じ区間で切り分けましょう。"};\n  }\n  return {statuses,candidates:[],recommendation:{action:"collect",focusModes:unknown,tempoDelta:0},message:"同じ区間・テンポでfocus別の自己評価を記録すると、ボトルネック候補を比較できます。"};\n}\n`;
await writeFile(practicePath,practiceSource);

// UI shell: one selector, one compact reading protocol, one diagnosis panel.
await replaceOnce(
  "phrase.html",
  '      <div class="practice-grid">\n        <label>開始小節<select id="range-start"></select></label>',
  `      <div class="focus-control">\n        <label for="focus-mode">練習focus</label>\n        <select id="focus-mode">\n          <option value="reading">譜読み</option>\n          <option value="rhythm">リズム</option>\n          <option value="execution">演奏動作</option>\n          <option value="integrated">統合演奏</option>\n        </select>\n        <p id="focus-description" class="hint"></p>\n      </div>\n      <div id="reading-focus" class="reading-focus" hidden>\n        <strong>譜読みチェック</strong>\n        <p id="reading-prompt">譜面を見て、音名・度数・指板位置を先に考えます。</p>\n        <p id="reading-answer" class="reading-answer" hidden></p>\n        <div class="practice-presets">\n          <button id="reading-reveal" type="button">答えを見る</button>\n          <button id="reading-next" type="button" disabled>次の音 →</button>\n        </div>\n      </div>\n      <div class="practice-grid">\n        <label>開始小節<select id="range-start"></select></label>`
);

await replaceOnce(
  "phrase.html",
  '      <p id="practice-advice" class="practice-status"></p>\n      <details><summary>このフレーズの履歴・バックアップ</summary>',
  `      <p id="practice-advice" class="practice-status"></p>\n      <div id="focus-diagnosis" class="focus-diagnosis">\n        <strong>同じ区間・テンポのfocus別結果</strong>\n        <ul id="focus-status-list" class="focus-status-list"></ul>\n        <p id="focus-diagnosis-text" class="hint"></p>\n      </div>\n      <details><summary>このフレーズの履歴・バックアップ</summary>`
);

// Responsive styles and answer masking.
const cssPath="phrase.css";
let css=await readFile(cssPath,"utf8");
if(css.includes(".focus-control{")) throw new Error("focus styles already exist");
css=css.replace(
  '.practice-panel>.backing-toggle{width:100%;font-size:14px}',
  `.practice-panel>.backing-toggle{width:100%;font-size:14px}\n.focus-control{display:grid;grid-template-columns:minmax(110px,.45fr) minmax(0,1fr);gap:8px 12px;align-items:center;margin-bottom:14px;padding:12px;border:1px solid var(--line);background:#faf7ef}.focus-control>label{font-size:14px;font-weight:800}.focus-control .hint{grid-column:1/-1;margin:0}.reading-focus{margin:0 0 14px;padding:14px;border:1px solid var(--green);background:var(--green-light)}.reading-focus>p{margin:8px 0;line-height:1.6}.reading-answer{padding:10px;background:#fff;border:1px solid var(--line);font-weight:800}.focus-diagnosis{margin:14px 0;padding:12px;border:1px solid var(--line);background:#faf7ef}.focus-status-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:10px 0;padding:0;list-style:none}.focus-status-list li{padding:8px;border:1px solid var(--line);background:#fff;font-size:12px}.focus-diagnosis .hint{margin:8px 0 0}\nbody[data-focus="execution"] .note-name-text,body[data-focus="execution"] #note-name{visibility:hidden}\nbody[data-focus="rhythm"] .note-name-text,body[data-focus="rhythm"] .finger-text{display:none}`
);
css=css.replace(
  '  .self-review{grid-template-columns:1fr}\n  .panel{padding:14px}',
  '  .self-review{grid-template-columns:1fr}\n  .focus-control{grid-template-columns:1fr}.focus-control .hint{grid-column:1}.focus-status-list{grid-template-columns:1fr}\n  .panel{padding:14px}'
);
await writeFile(cssPath,css);

// Phrase focus behavior.
await replaceOnce(
  "phrase.js",
  'import { ASSIST_LABELS, SELF_REVIEW_KEYS, buildPracticeTimeline, practiceAdvice, practiceRange, parsePracticeBackup, validateAttempt } from "./core/practice.js";',
  'import { ASSIST_LABELS, FOCUS_MODES, SELF_REVIEW_KEYS, buildPracticeTimeline, practiceAdvice, practiceFocusDiagnosis, practiceRange, parsePracticeBackup, validateAttempt } from "./core/practice.js";'
);

await replaceOnce(
  "phrase.js",
  '    range:{start:1,end:1}, assist:"full", melody:true, countIn:0,',
  '    range:{start:1,end:1}, assist:"full", melody:true, countIn:0, focusMode:"integrated", readingSession:null,'
);

await replaceOnce(
  "phrase.js",
  `  function buildStaff(){\n    const host=$("staff");\n    renderScore(host,state.model,{\n      engraver:window.VexFlow,\n      assist:state.assist,`,
  `  function buildStaff(){\n    const host=$("staff");\n    const focusAssist=state.focusMode==="reading"||state.focusMode==="rhythm"\n      ?"staff"\n      :state.focusMode==="execution"&&state.assist==="full"?"no-names":state.assist;\n    renderScore(host,state.model,{\n      engraver:window.VexFlow,\n      assist:focusAssist,`
);

await replaceOnce(
  "phrase.js",
  '    state.noteIndex=0;\n    state.followedMeasure=-1;',
  '    state.noteIndex=0;\n    state.readingSession=null;\n    state.followedMeasure=-1;'
);

await replaceOnce(
  "phrase.js",
  '    if(recordButton) recordButton.disabled=pending||state.running;',
  '    if(recordButton) recordButton.disabled=pending||state.running||state.focusMode==="reading";'
);

await replaceOnce(
  "phrase.js",
  `  function scheduleEvent(event,time){\n    if(event.countIn){`,
  `  function scheduleRhythmGuide(time,accent=false){\n    const osc=state.audio.createOscillator();\n    const gain=envelopeGain(time,accent?.12:.08,.055,state.mix.melody);\n    osc.type="square";\n    osc.frequency.setValueAtTime(880,time);\n    osc.connect(gain);\n    trackSource(osc);\n    osc.start(time);\n    osc.stop(time+.065);\n  }\n\n  function scheduleEvent(event,time){\n    if(event.countIn){`
);

await replaceOnce(
  "phrase.js",
  `    const spb=state.run.spb;\n    event.notes.forEach(({note,index,attack,durationBeats})=>{\n      if(attack&&state.run.conditions.melody) scheduleMelody(note,time,durationBeats*spb);\n      state.visualQueue.push({time,index,measure:note.measureIndex,beat:event.beat});\n    });`,
  `    const spb=state.run.spb;\n    const rhythmFocus=state.run.conditions.focusMode==="rhythm";\n    if(rhythmFocus&&state.run.conditions.melody&&event.notes.some(item=>item.attack)){\n      scheduleRhythmGuide(time,Math.abs(event.beat%state.model.beatsPerBar)<1e-9);\n    }\n    event.notes.forEach(({note,index,attack,durationBeats})=>{\n      if(!rhythmFocus&&attack&&state.run.conditions.melody) scheduleMelody(note,time,durationBeats*spb);\n      state.visualQueue.push({time,index,measure:note.measureIndex,beat:event.beat});\n    });`
);

await replaceOnce(
  "phrase.js",
  '  async function play(withRecording=false){\n    if(state.running||state.starting) return;',
  '  async function play(withRecording=false){\n    if(state.running||state.starting||withRecording&&state.focusMode==="reading") return;'
);

await replaceOnce(
  "phrase.js",
  `      state.pending=elapsedSec>0?{\n        id:run.id,phraseId:run.phraseId,date:run.date,conditions:run.conditions,\n        observed:{transportCompleted:run.completedLoops>0,completedLoops:run.completedLoops,elapsedSec:Math.round(elapsedSec*100)/100}\n      }:null;`,
  `      if(run.conditions.focusMode!=="reading"){\n        state.pending=elapsedSec>0?{\n          id:run.id,phraseId:run.phraseId,date:run.date,conditions:run.conditions,\n          observed:{transportCompleted:run.completedLoops>0,completedLoops:run.completedLoops,elapsedSec:Math.round(elapsedSec*100)/100}\n        }:null;\n      }`
);

await replaceOnce(
  "phrase.js",
  `  function practiceConditions(){\n    return {\n      ...state.range,tempo:Number($("tempo").value),assist:state.assist,\n      melody:state.melody,countIn:state.countIn,\n      backing:Object.keys(state.backing).filter(part=>state.backing[part])\n    };\n  }`,
  `  function practiceConditions(){\n    return {\n      ...state.range,tempo:Number($("tempo").value),assist:state.assist,\n      melody:state.melody,countIn:state.countIn,\n      backing:Object.keys(state.backing).filter(part=>state.backing[part]),focusMode:state.focusMode\n    };\n  }`
);

await replaceOnce(
  "phrase.js",
  '    state.melody=typeof saved.melody==="boolean"?saved.melody:true;\n    if(Array.isArray(saved.backing)){',
  '    state.melody=typeof saved.melody==="boolean"?saved.melody:true;\n    state.focusMode=Object.hasOwn(FOCUS_MODES,saved.focusMode)?saved.focusMode:"integrated";\n    if(Array.isArray(saved.backing)){'
);

const focusHelpers=`\n  const FOCUS_DESCRIPTIONS=Object.freeze({\n    reading:"譜面の音を見て、音名・度数・指板位置を先に考えてから答えを確認します。通常transport完遂は譜読み成功の根拠にしません。",\n    rhythm:"同じ音価・onsetを固定の中立音で鳴らし、拍・細分・アクセントへ集中します。正しい音高は必須条件にしません。",\n    execution:"音名表示を減らし、TAB・運指・弦移動・左右同期・発音品質へ集中します。録音と自己レビューを利用できます。",\n    integrated:"譜面・音高・リズム・運指・奏法・音色を同時に成立させる通常の統合練習です。"\n  });\n\n  function selectedRangeNotes(){\n    return state.model.notes.filter(note=>note.measureIndex>=state.range.start-1&&note.measureIndex<state.range.end);\n  }\n\n  function resetReadingSession(){\n    state.readingSession=null;\n    const answer=$("reading-answer");\n    if(answer){answer.hidden=true;answer.textContent="";}\n  }\n\n  function ensureReadingSession(){\n    if(state.focusMode!=="reading"||!state.model) return null;\n    const key=state.phrase.id+":"+state.range.start+":"+state.range.end;\n    if(!state.readingSession||state.readingSession.key!==key){\n      const notes=selectedRangeNotes().map(note=>note.globalIndex);\n      state.readingSession={key,notes,position:0,revealed:false,completed:false,startedAt:Date.now()};\n    }\n    return state.readingSession;\n  }\n\n  function renderReadingFocus(){\n    const panel=$("reading-focus");\n    if(!panel) return;\n    panel.hidden=state.focusMode!=="reading";\n    if(panel.hidden) return;\n    const session=ensureReadingSession();\n    const reveal=$("reading-reveal");\n    const next=$("reading-next");\n    const answer=$("reading-answer");\n    if(!session||!session.notes.length){\n      $("reading-prompt").textContent="この区間には確認できる音符がありません。";\n      reveal.disabled=true;next.disabled=true;answer.hidden=true;\n      return;\n    }\n    if(session.completed){\n      $("reading-prompt").textContent="譜読み確認完了。結果を自己評価として記録できます。";\n      reveal.disabled=true;next.disabled=true;answer.hidden=true;\n      return;\n    }\n    const index=session.notes[session.position];\n    const note=state.model.notes[index];\n    state.noteIndex=index;\n    renderCurrentNote();\n    highlightNote(index);\n    highlightMeasure(note.measureIndex);\n    $("reading-prompt").textContent="M"+(note.measureIndex+1)+" / "+(session.position+1)+" of "+session.notes.length+"：譜面を見て音名・度数・指板位置を考えてください。";\n    answer.hidden=!session.revealed;\n    answer.textContent=session.revealed?note.name+" / "+note.string+"弦 "+note.fret+"フレット / 右手 "+(note.finger||"—"):"";\n    reveal.disabled=session.revealed;\n    next.disabled=!session.revealed;\n    next.textContent=session.position===session.notes.length-1?"確認を完了":"次の音 →";\n  }\n\n  function revealReadingAnswer(){\n    const session=ensureReadingSession();\n    if(!session||session.completed) return;\n    session.revealed=true;\n    renderReadingFocus();\n  }\n\n  function advanceReadingFocus(){\n    const session=ensureReadingSession();\n    if(!session||session.completed||!session.revealed) return;\n    if(session.position<session.notes.length-1){\n      session.position+=1;session.revealed=false;renderReadingFocus();return;\n    }\n    session.completed=true;\n    const elapsedSec=Math.max(.01,(Date.now()-session.startedAt)/1000);\n    state.pending={\n      id:crypto.randomUUID(),phraseId:state.phrase.id,date:new Date().toISOString(),conditions:practiceConditions(),\n      observed:{transportCompleted:false,completedLoops:0,elapsedSec:Math.round(elapsedSec*100)/100}\n    };\n    $("practice-status").textContent=rangeLabel()+" / 譜読み確認完了";\n    renderReadingFocus();\n    renderRecords();\n  }\n\n  function changeFocus(focusMode){\n    if(!Object.hasOwn(FOCUS_MODES,focusMode)||focusMode===state.focusMode) return;\n    stop();\n    state.focusMode=focusMode;\n    resetReadingSession();\n    buildStaff();\n    renderPracticeControls();\n    savePracticePreferences();\n    renderRecords();\n  }\n\n  function renderFocusDiagnosis(attempts){\n    const view=practiceFocusDiagnosis(attempts,{\n      phraseId:state.phrase.id,start:state.range.start,end:state.range.end,tempo:Number($("tempo").value)\n    });\n    const list=$("focus-status-list");\n    list.replaceChildren();\n    for(const [focusMode,label] of Object.entries(FOCUS_MODES)){\n      const status=view.statuses[focusMode].status;\n      const item=document.createElement("li");\n      item.dataset.focusStatus=focusMode;\n      item.textContent=label+"："+(status==="success"?"達成（自己評価）":status==="fail"?"要復習（自己評価）":"未記録");\n      list.append(item);\n    }\n    $("focus-diagnosis-text").textContent=view.message;\n  }\n`;

let phraseSource=await readFile("phrase.js","utf8");
const renderPracticeMarker='  function renderPracticeControls(){';
if(!phraseSource.includes(renderPracticeMarker)) throw new Error("renderPracticeControls marker missing");
if(phraseSource.includes("const FOCUS_DESCRIPTIONS")) throw new Error("focus helpers already inserted");
phraseSource=phraseSource.replace(renderPracticeMarker,focusHelpers+"\n"+renderPracticeMarker);
await writeFile("phrase.js",phraseSource);

await replaceOnce(
  "phrase.js",
  `  function renderPracticeControls(){\n    $("range-start").value=String(state.range.start);`,
  `  function renderPracticeControls(){\n    $("range-start").value=String(state.range.start);\n    $("focus-mode").value=state.focusMode;\n    $("focus-description").textContent=FOCUS_DESCRIPTIONS[state.focusMode];\n    document.body.dataset.focus=state.focusMode;`
);

await replaceOnce(
  "phrase.js",
  `    document.body.dataset.assist=state.assist;\n    const memory=state.assist==="memory";\n    $("staff").hidden=memory;\n    $("memory-cover").hidden=!memory;\n    $("tab-panel").hidden=memory||state.assist==="staff";\n    document.querySelector(".note-trainer").hidden=memory||state.assist==="staff";\n    $("chord-progression").hidden=memory;`,
  `    document.body.dataset.assist=state.assist;\n    const focusNotation=state.focusMode==="reading"||state.focusMode==="rhythm";\n    const memory=state.assist==="memory"&&!focusNotation;\n    $("staff").hidden=memory;\n    $("memory-cover").hidden=!memory;\n    $("tab-panel").hidden=focusNotation||memory||state.assist==="staff";\n    document.querySelector(".note-trainer").hidden=focusNotation||memory||state.assist==="staff";\n    $("chord-progression").hidden=memory;`
);

await replaceOnce(
  "phrase.js",
  '    $("practice-status").textContent=rangeLabel()+"を練習 / "+ASSIST_LABELS[state.assist];\n  }',
  '    $("practice-status").textContent=rangeLabel()+"を練習 / "+FOCUS_MODES[state.focusMode]+" / "+ASSIST_LABELS[state.assist];\n    renderReadingFocus();\n    setAudioEntriesPending(false);\n  }'
);

await replaceOnce(
  "phrase.js",
  `  function changeRange(start,end){\n    stop();\n    state.range=practiceRange(state.phrase.measures,start,end);`,
  `  function changeRange(start,end){\n    stop();\n    state.range=practiceRange(state.phrase.measures,start,end);\n    resetReadingSession();`
);

await replaceOnce(
  "phrase.js",
  '  function conditionsLabel(c){\n    return rangeLabel(c)+"・"+c.tempo+" BPM・"+ASSIST_LABELS[c.assist]+"・お手本"+(c.melody?"あり":"なし");\n  }',
  '  function conditionsLabel(c){\n    return FOCUS_MODES[c.focusMode??"integrated"]+"・"+rangeLabel(c)+"・"+c.tempo+" BPM・"+ASSIST_LABELS[c.assist]+"・お手本"+(c.melody?"あり":"なし");\n  }'
);

await replaceOnce(
  "phrase.js",
  `    $("attempt-summary").textContent=state.running?"練習中です。停止後に結果を記録できます。":pending\n      ?conditionsLabel(pending.conditions)+" / "+pending.observed.completedLoops+"回再生完了"+(state.recordingFinalizing?" / 録音確定中":"")\n      :"再生して練習すると、条件と結果を記録できます。";\n    const reviewReady=!state.pendingRecording||Boolean(readSelfReview());\n    $("record-clean").disabled=state.saving||state.running||state.recordingFinalizing||!reviewReady||!pending?.observed.transportCompleted;`,
  `    $("attempt-summary").textContent=state.running?"練習中です。停止後に結果を記録できます。":pending\n      ?conditionsLabel(pending.conditions)+" / "+(pending.conditions.focusMode==="reading"?"譜読み確認完了":pending.observed.completedLoops+"回再生完了")+(state.recordingFinalizing?" / 録音確定中":"")\n      :state.focusMode==="reading"?"答えを見る→次の音、で譜読み確認を終えると自己評価を記録できます。":"再生して練習すると、条件と結果を記録できます。";\n    const reviewReady=!state.pendingRecording||Boolean(readSelfReview());\n    const cleanReady=pending&&(pending.conditions.focusMode==="reading"||pending.observed.transportCompleted);\n    $("record-clean").disabled=state.saving||state.running||state.recordingFinalizing||!reviewReady||!cleanReady;`
);

await replaceOnce(
  "phrase.js",
  `    const attempts=state.attempts.filter(item=>item.phraseId===state.phrase.id);\n    $("practice-advice").textContent=practiceAdvice(attempts,practiceConditions());`,
  `    const attempts=state.attempts.filter(item=>item.phraseId===state.phrase.id);\n    $("practice-advice").textContent=practiceAdvice(attempts,practiceConditions());\n    renderFocusDiagnosis(attempts);`
);

await replaceOnce(
  "phrase.js",
  `      if(state.pending?.id===pending.id){\n        state.pending=null;\n        clearPendingRecording();\n      }`,
  `      if(state.pending?.id===pending.id){\n        state.pending=null;\n        clearPendingRecording();\n        if(record.conditions.focusMode==="reading"){resetReadingSession();renderReadingFocus();}\n      }`
);

await replaceOnce(
  "phrase.js",
  '  function bindPracticeEvents(){\n    $("range-start").addEventListener',
  '  function bindPracticeEvents(){\n    $("focus-mode").addEventListener("change",event=>changeFocus(event.target.value));\n    $("reading-reveal").addEventListener("click",revealReadingAnswer);\n    $("reading-next").addEventListener("click",advanceReadingFocus);\n    $("range-start").addEventListener'
);

// Unit coverage for legacy compatibility, focus isolation, and rule-based diagnosis.
await writeFile("tests/unit/practice-focus.test.mjs",`import test from "node:test";\nimport assert from "node:assert/strict";\nimport { FOCUS_MODE_KEYS, parsePracticeBackup, practiceAdvice, practiceFocusDiagnosis, practiceFocusStatuses, validateAttempt } from "../../core/practice.js";\n\nfunction attempt({id="a",focusMode="integrated",clean=false,tempo=80,start=1,end=2,phraseId="p",date="2026-09-06T00:00:00Z",legacy=false}={}){\n  const conditions={tempo,start,end,assist:"full",melody:true,countIn:0,backing:[]};\n  if(!legacy) conditions.focusMode=focusMode;\n  return {id,phraseId,date,conditions,observed:{transportCompleted:focusMode!=="reading",completedLoops:focusMode!=="reading"?1:0,elapsedSec:4},reported:{clean}};\n}\n\ntest("all four focus modes validate and persist",()=>{\n  for(const focusMode of FOCUS_MODE_KEYS){\n    const value=validateAttempt(attempt({id:focusMode,focusMode,clean:true}));\n    assert.equal(value.conditions.focusMode,focusMode);\n  }\n});\n\ntest("unknown focus mode is rejected",()=>{\n  assert.throws(()=>validateAttempt(attempt({focusMode:"pitch"})),/focus/);\n});\n\ntest("legacy Attempt without focus normalizes to integrated without mutating input",()=>{\n  const legacy=attempt({legacy:true,clean:true});\n  const normalized=validateAttempt(legacy);\n  assert.equal(normalized.conditions.focusMode,"integrated");\n  assert.equal(Object.hasOwn(legacy.conditions,"focusMode"),false);\n});\n\ntest("version 1 backup remains compatible and legacy focus becomes integrated",()=>{\n  const backup={format:"guitar-phrase-practice",version:1,attempts:[attempt({id:"legacy",legacy:true,clean:true})]};\n  const [value]=parsePracticeBackup(JSON.stringify(backup));\n  assert.equal(value.conditions.focusMode,"integrated");\n});\n\ntest("practiceAdvice never treats another focus as the same condition",()=>{\n  const integrated=validateAttempt(attempt({id:"integrated",focusMode:"integrated",clean:true}));\n  const advice=practiceAdvice([integrated],{...integrated.conditions,focusMode:"execution"});\n  assert.match(advice,/同じ区間を2回/);\n});\n\ntest("focus statuses keep integrated and execution separate",()=>{\n  const attempts=[\n    validateAttempt(attempt({id:"e",focusMode:"execution",clean:false})),\n    validateAttempt(attempt({id:"i",focusMode:"integrated",clean:true,date:"2026-09-06T00:01:00Z"}))\n  ];\n  const statuses=practiceFocusStatuses(attempts,{phraseId:"p",start:1,end:2,tempo:80});\n  assert.equal(statuses.execution.status,"fail");\n  assert.equal(statuses.integrated.status,"success");\n  assert.equal(statuses.reading.status,"unknown");\n});\n\ntest("single failed foundation focus becomes a candidate, not a numeric score",()=>{\n  const attempts=[\n    validateAttempt(attempt({id:"r",focusMode:"reading",clean:true})),\n    validateAttempt(attempt({id:"h",focusMode:"rhythm",clean:true})),\n    validateAttempt(attempt({id:"e",focusMode:"execution",clean:false})),\n    validateAttempt(attempt({id:"i",focusMode:"integrated",clean:false}))\n  ];\n  const diagnosis=practiceFocusDiagnosis(attempts,{phraseId:"p",start:1,end:2,tempo:80});\n  assert.deepEqual(diagnosis.candidates,["execution"]);\n  assert.equal(diagnosis.recommendation.action,"repeat-focus");\n  assert.match(diagnosis.message,/演奏動作/);\n  assert.equal("score" in diagnosis,false);\n});\n\ntest("three foundation successes plus integrated failure prescribes slower integration",()=>{\n  const attempts=FOCUS_MODE_KEYS.map((focusMode,index)=>validateAttempt(attempt({id:String(index),focusMode,clean:focusMode!=="integrated"})));\n  const diagnosis=practiceFocusDiagnosis(attempts,{phraseId:"p",start:1,end:2,tempo:80});\n  assert.equal(diagnosis.recommendation.action,"retry-integrated");\n  assert.equal(diagnosis.recommendation.tempoDelta,-4);\n});\n\ntest("integrated success recommends next range or a small tempo increase",()=>{\n  const diagnosis=practiceFocusDiagnosis([validateAttempt(attempt({focusMode:"integrated",clean:true}))],{phraseId:"p",start:1,end:2,tempo:80});\n  assert.equal(diagnosis.recommendation.action,"advance");\n  assert.equal(diagnosis.recommendation.tempoDelta,2);\n});\n`);

// Browser coverage: selector, real behavior differences, persistence, diagnosis, legacy import, mobile layout.
await writeFile("tests/focus.spec.mjs",`import { test, expect } from "@playwright/test";\n\nasync function setTempo(page,value=160){\n  await page.locator("#tempo").evaluate((element,bpm)=>{element.value=String(bpm);element.dispatchEvent(new Event("input",{bubbles:true}));},value);\n}\n\nasync function open(page){\n  await page.goto("/phrase.html");\n  await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");\n  await page.locator("#follow-toggle").click();\n  await setTempo(page);\n}\n\nasync function attempts(page){\n  return page.evaluate(async()=>{const {createPracticeStore}=await import("./core/practice-store.js");return createPracticeStore(indexedDB).all();});\n}\n\nasync function finishReading(page){\n  for(let guard=0;guard<64;guard++){\n    await page.locator("#reading-reveal").click();\n    const last=await page.locator("#reading-next").getAttribute("textContent");\n    await page.locator("#reading-next").click();\n    if(last?.includes("確認を完了")) return;\n  }\n  throw new Error("reading focus did not finish");\n}\n\ntest("focus selector exposes four modes and reading saves reported success without transport completion",async({page})=>{\n  await open(page);\n  await page.setViewportSize({width:390,height:844});\n  await expect(page.locator("#focus-mode option")).toHaveCount(4);\n  await page.locator("#range-one").click();\n  await page.locator("#focus-mode").selectOption("reading");\n  await expect(page.locator("#reading-focus")).toBeVisible();\n  await expect(page.locator("#tab-panel")).toBeHidden();\n  await expect(page.locator(".note-trainer")).toBeHidden();\n  await expect(page.locator("#record-play")).toBeDisabled();\n  await expect(page.locator("#record-clean")).toBeDisabled();\n  await finishReading(page);\n  await expect(page.locator("#record-clean")).toBeEnabled();\n  await page.locator("#record-clean").click();\n  await expect(page.locator("#record-status")).toContainText("保存しました");\n  const [saved]=await attempts(page);\n  expect(saved.conditions.focusMode).toBe("reading");\n  expect(saved.observed.transportCompleted).toBe(false);\n  expect(saved.reported.clean).toBe(true);\n  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);\n  await page.reload();\n  await expect(page.locator("#focus-mode")).toHaveValue("reading");\n  await page.locator("summary").click();\n  await expect(page.locator("#attempt-list")).toContainText("譜読み");\n});\n\ntest("rhythm focus schedules neutral guide tones instead of phrase pitches",async({page})=>{\n  await page.addInitScript(()=>{\n    window.__tones=[];\n    const setValue=AudioParam.prototype.setValueAtTime;\n    AudioParam.prototype.setValueAtTime=function(value,time){this.__scheduledValue=value;return setValue.call(this,value,time);};\n    const start=OscillatorNode.prototype.start;\n    OscillatorNode.prototype.start=function(time){window.__tones.push({type:this.type,frequency:this.frequency.__scheduledValue,time});return start.call(this,time);};\n  });\n  await open(page);\n  await page.locator("#sound-mode-toggle").click();\n  for(const part of ["chords","bass","drums"]) await page.locator("#backing-"+part).click();\n  await page.locator("#range-one").click();\n  await page.locator("#focus-mode").selectOption("rhythm");\n  await expect(page.locator("#focus-description")).toContainText("中立音");\n  await page.locator("#play").click();\n  await expect.poll(()=>page.evaluate(()=>window.__tones.filter(tone=>tone.type==="square").length)).toBeGreaterThan(0);\n  await page.locator("#stop").click();\n  const tones=await page.evaluate(()=>window.__tones);\n  const guides=tones.filter(tone=>tone.type==="square");\n  expect(guides.every(tone=>tone.frequency===880)).toBe(true);\n  expect(tones.some(tone=>tone.type==="triangle")).toBe(false);\n});\n\ntest("execution focus lowers note-name load and saves a distinct Attempt condition",async({page})=>{\n  await open(page);\n  await page.locator("#range-one").click();\n  await page.locator("#focus-mode").selectOption("execution");\n  await expect(page.locator("#note-name")).toBeHidden();\n  await page.locator("#play").click();\n  await expect(page.locator("#record-repeat")).toBeEnabled({timeout:7000});\n  await page.locator("#record-repeat").click();\n  await expect(page.locator("#record-status")).toContainText("保存しました");\n  const [saved]=await attempts(page);\n  expect(saved.conditions.focusMode).toBe("execution");\n  expect(saved.reported.clean).toBe(false);\n});\n\ntest("same phrase range and tempo keeps four focus histories separate and diagnoses execution candidate",async({page})=>{\n  await open(page);\n  await page.locator("#range-one").click();\n  await page.evaluate(async()=>{\n    const [{createPracticeStore},{validateAttempt}]=await Promise.all([import("./core/practice-store.js"),import("./core/practice.js")]);\n    const phraseId=(await (await fetch("./data/phrases.json")).json()).phrases[0].id;\n    const store=createPracticeStore(indexedDB);\n    const values=[\n      ["reading",true,false],["rhythm",true,true],["execution",false,true],["integrated",false,true]\n    ];\n    for(let index=0;index<values.length;index++){\n      const [focusMode,clean,transportCompleted]=values[index];\n      await store.saveAttempt(validateAttempt({\n        id:"focus-"+focusMode,phraseId,date:new Date(Date.now()+index*1000).toISOString(),\n        conditions:{tempo:160,start:1,end:1,assist:"full",melody:true,countIn:0,backing:["chords","bass","drums"],focusMode},\n        observed:{transportCompleted,completedLoops:transportCompleted?1:0,elapsedSec:2},reported:{clean}\n      }));\n    }\n  });\n  await page.reload();\n  await expect(page.locator("#focus-diagnosis-text")).toContainText("主ボトルネック候補: 演奏動作");\n  await expect(page.locator('[data-focus-status="execution"]')).toContainText("要復習");\n  await expect(page.locator('[data-focus-status="integrated"]')).toContainText("要復習");\n  await page.locator("summary").click();\n  await expect(page.locator("#attempt-list li")).toHaveCount(4);\n  await expect(page.locator("#attempt-list")).toContainText("譜読み");\n  await expect(page.locator("#attempt-list")).toContainText("リズム");\n  await expect(page.locator("#attempt-list")).toContainText("演奏動作");\n  await expect(page.locator("#attempt-list")).toContainText("統合演奏");\n});\n\ntest("legacy version 1 backup imports as integrated",async({page})=>{\n  await open(page);\n  const legacy={format:"guitar-phrase-practice",version:1,attempts:[{\n    id:"legacy-focus",phraseId:"legacy",date:"2026-09-05T00:00:00Z",\n    conditions:{tempo:80,start:1,end:1,assist:"full",melody:true,countIn:0,backing:[]},\n    observed:{transportCompleted:true,completedLoops:1,elapsedSec:4},reported:{clean:true}\n  }]};\n  await page.locator("#practice-file").setInputFiles({name:"legacy.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(legacy))});\n  await expect(page.locator("#record-status")).toContainText("記録を読み込みました");\n  const stored=await attempts(page);\n  expect(stored.find(item=>item.id==="legacy-focus").conditions.focusMode).toBe("integrated");\n});\n\ntest("changing focus stops active recording and releases the track once",async({page})=>{\n  await page.addInitScript(()=>{\n    window.__trackStops=0;\n    const track={stop(){window.__trackStops++;},getSettings(){return {};}};\n    const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};\n    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>stream}});\n    class FakeMediaRecorder extends EventTarget{\n      static isTypeSupported(){return false;}\n      constructor(){super();this.mimeType="audio/fake";this.state="inactive";}\n      start(){this.state="recording";}\n      stop(){this.state="inactive";this.dispatchEvent(new Event("stop"));}\n    }\n    Object.defineProperty(window,"MediaRecorder",{configurable:true,value:FakeMediaRecorder});\n  });\n  await open(page);\n  await page.locator("#loop").click();\n  await page.locator("#focus-mode").selectOption("execution");\n  await page.locator("#record-play").click();\n  await expect(page.locator("#recording-status")).toContainText("録音中");\n  await page.locator("#focus-mode").selectOption("integrated");\n  await expect.poll(()=>page.evaluate(()=>window.__trackStops)).toBe(1);\n  await expect(page.locator("#play")).toBeEnabled();\n});\n`);

for(const path of ["core/practice.js","phrase.js","phrase.html","phrase.css","tests/unit/practice-focus.test.mjs","tests/focus.spec.mjs"]){
  const text=await readFile(path,"utf8");
  await writeFile(path,text.trimEnd()+"\n");
}
