import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path,before,after){
  const source=await readFile(path,"utf8");
  if(!source.includes(before)) throw new Error(`${path}: expected source not found`);
  const updated=source.replace(before,after);
  if(updated===source) throw new Error(`${path}: replacement made no change`);
  await writeFile(path,updated);
}

// Keep roadmap terminology aligned with the authoritative Phase 4A task.
await replaceOnce(
  "docs/ROADMAP.md",
  "**NEXT SUBPHASE: Phase 4B — 測定・処方**",
  "**NEXT SUBPHASE: Phase 4B — 測定意味論とレイテンシ校正**"
);

// Diagnosis deliberately compares only phrase + range + exact tempo. Assist,
// melody and backing remain Attempt conditions, but do not fragment Phase 4A
// bottleneck comparison. focusMode is the dimension being compared.
{
  const path="core/practice.js";
  let source=await readFile(path,"utf8");
  const statusStart=source.indexOf("export function practiceFocusStatuses");
  const diagnosisStart=source.indexOf("export function practiceFocusDiagnosis");
  if(statusStart<0||diagnosisStart<0||diagnosisStart<=statusStart) throw new Error(`${path}: focus helpers not found`);
  const prefix=source.slice(0,statusStart);
  const helpers=`export function practiceFocusComparisonKey(value){
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
`;
  source=prefix+helpers;
  await writeFile(path,source);
}

// Reading must actually reveal the requested theory information, not merely
// rename the one-note trainer.
await replaceOnce(
  "phrase.js",
  '    answer.textContent=session.revealed?note.name+" / "+note.string+"弦 "+note.fret+"フレット / 右手 "+(note.finger||"—"):"";',
  '    const degreeLetters={C:0,D:1,E:2,F:3,G:4,A:5,B:6};\n    const tonic=String(state.phrase.key||"C").replace(/m$/,"" )[0]||"C";\n    const degree=((degreeLetters[note.name[0]]-degreeLetters[tonic]+7)%7)+1;\n    answer.textContent=session.revealed?note.name+" / "+degree+"度 / "+note.string+"弦 "+note.fret+"フレット / 右手 "+(note.finger||"—"):"";'
);

// Reading is reveal-based, rhythm is neutral-pitch transport. Neither asks for
// microphone recording in Phase 4A, so recording semantics stay unambiguous.
await replaceOnce(
  "phrase.js",
  '    if(playButton) playButton.disabled=pending||state.running;\n    if(recordButton) recordButton.disabled=pending||state.running||state.focusMode==="reading";\n    if(noteButton) noteButton.disabled=pending;\n    if(backingButton) backingButton.disabled=pending;',
  '    if(playButton) playButton.disabled=pending||state.running||state.focusMode==="reading";\n    if(recordButton) recordButton.disabled=pending||state.running||state.focusMode==="reading"||state.focusMode==="rhythm";\n    if(noteButton) noteButton.disabled=pending;\n    if(backingButton) backingButton.disabled=pending||state.focusMode==="reading"||state.focusMode==="rhythm";'
);

await replaceOnce(
  "phrase.js",
  '  async function play(withRecording=false){\n    if(state.running||state.starting||withRecording&&state.focusMode==="reading") return;',
  '  async function play(withRecording=false){\n    if(state.running||state.starting||withRecording&&(state.focusMode==="reading"||state.focusMode==="rhythm")) return;'
);

await replaceOnce(
  "phrase.js",
  '    rhythm:"同じ音価・onsetを固定の中立音で鳴らし、拍・細分・アクセントへ集中します。正しい音高は必須条件にしません。",',
  '    rhythm:"同じ音価・onsetを固定の中立音で鳴らし、拍・細分・アクセントへ集中します。正しい音高は使わず、録音も行いません。",'
);

// Pitched chord/bass backing would defeat rhythm isolation. Drums may remain,
// while the phrase rhythm itself is rendered at one neutral frequency.
await replaceOnce(
  "phrase.js",
  '  function scheduleBackingGrid(inBar,time,chord){\n    const spb=secondsPerBeat();\n    const chordHits=chordPattern(state.phrase.groove);\n\n    if(state.backing.chords && chordHits.has(inBar)){\n      scheduleChord(chord,time,spb*.82,chordHits.get(inBar));\n    }\n\n    if(state.backing.bass && (inBar===0||inBar===4)){\n      scheduleBass(chord,time);\n    }',
  '  function scheduleBackingGrid(inBar,time,chord,{pitched=true}={}){\n    const spb=secondsPerBeat();\n    const chordHits=chordPattern(state.phrase.groove);\n\n    if(pitched&&state.backing.chords&&chordHits.has(inBar)){\n      scheduleChord(chord,time,spb*.82,chordHits.get(inBar));\n    }\n\n    if(pitched&&state.backing.bass&&(inBar===0||inBar===4)){\n      scheduleBass(chord,time);\n    }'
);

await replaceOnce(
  "phrase.js",
  '    if(event.backing){\n      const {eighth,measure}=event.backing;\n      scheduleBackingGrid(eighth,time,state.phrase.chords[measure]);\n    }',
  '    if(event.backing){\n      const {eighth,measure}=event.backing;\n      scheduleBackingGrid(eighth,time,state.phrase.chords[measure],{pitched:!rhythmFocus});\n    }'
);

await replaceOnce(
  "phrase.js",
  '      await ensureAudio([...(state.melody?["nylonGuitar"]:[]),...backingSampleNames()]);',
  '      const requiredSamples=state.focusMode==="rhythm"\n        ?(state.backing.drums?["kick","snare","closedHat","openHat"]:[])\n        :[...(state.melody?["nylonGuitar"]:[]),...backingSampleNames()];\n      await ensureAudio(requiredSamples);'
);

await replaceOnce(
  "phrase.js",
  '      backing:Object.keys(state.backing).filter(part=>state.backing[part]),focusMode:state.focusMode',
  '      backing:Object.keys(state.backing).filter(part=>state.backing[part]&&(state.focusMode!=="rhythm"||part==="drums")),focusMode:state.focusMode'
);

// Focus switching abandons an unsaved Attempt from the previous focus. The
// transport/recorder are stopped first, then any pending monitor URL is revoked.
await replaceOnce(
  "phrase.js",
  '  function changeFocus(focusMode){\n    if(!Object.hasOwn(FOCUS_MODES,focusMode)||focusMode===state.focusMode) return;\n    stop();\n    state.focusMode=focusMode;\n    resetReadingSession();\n    buildStaff();\n    renderPracticeControls();\n    savePracticePreferences();\n    renderRecords();\n  }',
  '  function changeFocus(focusMode){\n    if(!Object.hasOwn(FOCUS_MODES,focusMode)||focusMode===state.focusMode) return;\n    stop();\n    state.pending=null;\n    state.recordingRunId=null;\n    state.recordingResult=null;\n    state.recordingFinalizing=false;\n    clearPendingRecording();\n    state.focusMode=focusMode;\n    resetReadingSession();\n    buildStaff();\n    renderPracticeControls();\n    savePracticePreferences();\n    renderRecords();\n  }'
);

// Keep focus-specific controls honest while preserving the existing integrated
// controls and preference state.
await replaceOnce(
  "phrase.js",
  '    $("focus-description").textContent=FOCUS_DESCRIPTIONS[state.focusMode];\n    document.body.dataset.focus=state.focusMode;',
  '    $("focus-description").textContent=FOCUS_DESCRIPTIONS[state.focusMode];\n    document.body.dataset.focus=state.focusMode;\n    const rhythmFocus=state.focusMode==="rhythm";\n    $("backing-chords").disabled=rhythmFocus;\n    $("backing-bass").disabled=rhythmFocus;'
);

await replaceOnce(
  "phrase.js",
  '    $("melody-toggle").textContent="♪ お手本メロディ "+(state.melody?"ON":"OFF");',
  '    $("melody-toggle").textContent=(state.focusMode==="rhythm"?"♪ リズムガイド ":"♪ お手本メロディ ")+(state.melody?"ON":"OFF");'
);

// The previous diagnostic patch bumped the Service Worker for edits to files
// that were already in APP_SHELL. Phase 4A adds no local runtime module.
await replaceOnce(
  "sw.js",
  'const CACHE_NAME = "fingerstyle-practice-v16";',
  'const CACHE_NAME = "fingerstyle-practice-v15";'
);

// Unit tests pin the comparison key and each rule branch.
await replaceOnce(
  "tests/unit/practice-focus.test.mjs",
  'import { FOCUS_MODE_KEYS, parsePracticeBackup, practiceAdvice, practiceFocusDiagnosis, practiceFocusStatuses, validateAttempt } from "../../core/practice.js";',
  'import { FOCUS_MODE_KEYS, parsePracticeBackup, practiceAdvice, practiceFocusComparisonKey, practiceFocusDiagnosis, practiceFocusStatuses, validateAttempt } from "../../core/practice.js";'
);

{
  const path="tests/unit/practice-focus.test.mjs";
  let source=await readFile(path,"utf8");
  const extra=`\n\ntest("diagnostic comparison key is phrase + range + exact tempo only",()=>{\n  const base={phraseId:"p",conditions:{start:2,end:3,tempo:80,assist:"full",melody:true,backing:["bass"],focusMode:"reading"}};\n  assert.equal(practiceFocusComparisonKey(base),practiceFocusComparisonKey({phraseId:"p",conditions:{...base.conditions,assist:"memory",melody:false,backing:[],focusMode:"execution"}}));\n  assert.notEqual(practiceFocusComparisonKey(base),practiceFocusComparisonKey({phraseId:"p",conditions:{...base.conditions,tempo:82}}));\n  assert.notEqual(practiceFocusComparisonKey(base),practiceFocusComparisonKey({phraseId:"other",conditions:base.conditions}));\n});\n\ntest("invalid focus inside a version 1 backup is rejected rather than rounded",()=>{\n  const bad=attempt({id:"bad",focusMode:"unknown"});\n  assert.throws(()=>parsePracticeBackup(JSON.stringify({format:"guitar-phrase-practice",version:1,attempts:[bad]})),/focus/);\n});\n\nfor(const failedFocus of ["reading","rhythm","execution"]){\n  test("integrated failure keeps "+failedFocus+" as its own bottleneck candidate",()=>{\n    const attempts=[\n      validateAttempt(attempt({id:"i",focusMode:"integrated",clean:false})),\n      validateAttempt(attempt({id:"f",focusMode:failedFocus,clean:false,date:"2026-09-06T00:01:00Z"}))\n    ];\n    const diagnosis=practiceFocusDiagnosis(attempts,{phraseId:"p",start:1,end:2,tempo:80});\n    assert.deepEqual(diagnosis.candidates,[failedFocus]);\n  });\n}\n\ntest("multiple failed foundation focuses remain multiple candidates",()=>{\n  const attempts=[\n    validateAttempt(attempt({id:"i",focusMode:"integrated",clean:false})),\n    validateAttempt(attempt({id:"r",focusMode:"rhythm",clean:false})),\n    validateAttempt(attempt({id:"e",focusMode:"execution",clean:false}))\n  ];\n  const diagnosis=practiceFocusDiagnosis(attempts,{phraseId:"p",start:1,end:2,tempo:80});\n  assert.deepEqual(diagnosis.candidates,["rhythm","execution"]);\n  assert.equal(diagnosis.recommendation.action,"repeat-focuses");\n});\n\ntest("a foundation failure without integrated evidence is not declared causal",()=>{\n  const diagnosis=practiceFocusDiagnosis([validateAttempt(attempt({focusMode:"rhythm",clean:false}))],{phraseId:"p",start:1,end:2,tempo:80});\n  assert.deepEqual(diagnosis.candidates,[]);\n  assert.equal(diagnosis.recommendation.action,"check-integrated");\n});\n`;
  if(!source.includes('diagnostic comparison key is phrase + range + exact tempo only')) source=source.trimEnd()+extra+"\n";
  await writeFile(path,source);
}

// Browser tests use visible UI state as wait conditions; no sleeps/skips are
// added. Open the existing details element before exercising backup export.
await replaceOnce(
  "tests/focus.spec.mjs",
  '  expect(saved.reported.clean).toBe(true);\n  const downloadPromise=page.waitForEvent("download");',
  '  expect(saved.reported.clean).toBe(true);\n  await expect(page.locator("#reading-answer")).toBeHidden();\n  await page.locator("summary").click();\n  const downloadPromise=page.waitForEvent("download");'
);

await replaceOnce(
  "tests/focus.spec.mjs",
  '  await expect(page.locator("#focus-mode option")).toHaveCount(4);',
  '  await expect(page.locator("#focus-mode option")).toHaveCount(4);\n  expect(await page.locator("#focus-mode option").evaluateAll(options=>options.map(option=>option.value))).toEqual(["reading","rhythm","execution","integrated"]);'
);

await replaceOnce(
  "tests/focus.spec.mjs",
  '  await expect(page.locator("#record-clean")).toBeDisabled();\n  await finishReading(page);',
  '  await expect(page.locator("#record-clean")).toBeDisabled();\n  await expect(page.locator("#play")).toBeDisabled();\n  await page.locator("#reading-reveal").click();\n  await expect(page.locator("#reading-answer")).toBeVisible();\n  await expect(page.locator("#reading-answer")).toContainText("度");\n  await page.locator("#reading-next").click();\n  await finishReading(page);'
);

await replaceOnce(
  "tests/focus.spec.mjs",
  '  for(const part of ["chords","bass","drums"]) await page.locator("#backing-"+part).click();\n  await page.locator("#range-one").click();\n  await page.locator("#focus-mode").selectOption("rhythm");',
  '  await page.locator("#range-one").click();\n  await page.locator("#focus-mode").selectOption("rhythm");\n  await page.locator("#loop").click();'
);

await replaceOnce(
  "tests/focus.spec.mjs",
  '  await expect.poll(()=>page.evaluate(()=>window.__tones.filter(tone=>tone.type==="square").length)).toBeGreaterThan(0);\n  await page.locator("#stop").click();',
  '  await expect.poll(()=>page.evaluate(()=>window.__tones.filter(tone=>tone.type==="square").length)).toBeGreaterThan(0);\n  await expect(page.locator("#practice-status")).toContainText("2回目",{timeout:7000});\n  await page.locator("#stop").click();'
);

{
  const path="tests/focus.spec.mjs";
  let source=await readFile(path,"utf8");
  const extra=`\n\ntest("changing focus stops active transport and discards the previous pending Attempt",async({page})=>{\n  await open(page);\n  await page.locator("#range-one").click();\n  await page.locator("#loop").click();\n  await page.locator("#play").click();\n  await expect(page.locator("#stop")).toBeEnabled();\n  await page.locator("#focus-mode").selectOption("rhythm");\n  await expect(page.locator("#stop")).toBeDisabled();\n  await expect(page.locator("#record-clean")).toBeDisabled();\n  await expect(page.locator("#record-repeat")).toBeDisabled();\n  expect(await attempts(page)).toHaveLength(0);\n});\n`;
  if(!source.includes("changing focus stops active transport and discards")) source=source.trimEnd()+extra+"\n";
  await writeFile(path,source);
}

for(const path of ["docs/ROADMAP.md","core/practice.js","phrase.js","tests/unit/practice-focus.test.mjs","tests/focus.spec.mjs","sw.js"]){
  const text=await readFile(path,"utf8");
  await writeFile(path,text.trimEnd()+"\n");
}
