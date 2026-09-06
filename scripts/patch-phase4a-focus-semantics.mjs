import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, from, to) {
  const text = await readFile(path, "utf8");
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one match, found ${count}`);
  await writeFile(path, text.replace(from, to));
}

async function appendOnce(path, marker, addition) {
  const text = await readFile(path, "utf8");
  if (text.includes(marker)) throw new Error(`${path}: patch already applied (${marker})`);
  await writeFile(path, text.trimEnd() + "\n\n" + addition.trim() + "\n");
}

await replaceOnce(
  "core/practice.js",
  `export const FOCUS_MODE_KEYS=Object.freeze(Object.keys(FOCUS_MODES));\n\nexport function normalizeFocusMode(value){`,
  `export const FOCUS_MODE_KEYS=Object.freeze(Object.keys(FOCUS_MODES));\n\nexport const FOCUS_SUCCESS_LABELS=Object.freeze({\n  reading:"譜読みできた",\n  rhythm:"リズムを合わせられた",\n  execution:"動作・発音を揃えられた",\n  integrated:"統合して弾けた"\n});\n\nexport function normalizeFocusMode(value){`
);

await replaceOnce(
  "core/practice.js",
  `export function normalizeFocusMode(value){\n  const focusMode=value===undefined?"integrated":value;\n  if(!Object.hasOwn(FOCUS_MODES,focusMode)) throw new Error("練習focusが不正です。");\n  return focusMode;\n}\n\nexport function practiceRange`,
  `export function normalizeFocusMode(value){\n  const focusMode=value===undefined?"integrated":value;\n  if(!Object.hasOwn(FOCUS_MODES,focusMode)) throw new Error("練習focusが不正です。");\n  return focusMode;\n}\n\nexport function focusResultLabel(focusMode,clean){\n  const normalized=normalizeFocusMode(focusMode);\n  return clean?FOCUS_SUCCESS_LABELS[normalized]+"（自己評価）":"要復習（自己評価）";\n}\n\nexport function focusMelodyLabel(focusMode,melody){\n  const normalized=normalizeFocusMode(focusMode);\n  return (normalized==="rhythm"?"リズムガイド":"お手本")+(melody?"あり":"なし");\n}\n\nexport function practiceHistoryCompletionLabel(attempt){\n  const focusMode=normalizeFocusMode(attempt?.conditions?.focusMode);\n  if(focusMode==="reading") return "譜読み確認完了";\n  return (Number.isInteger(attempt?.observed?.completedLoops)?attempt.observed.completedLoops:0)+"回再生完了";\n}\n\nexport function practiceRange`
);

const oldAdvice = `export function practiceAdvice(attempts,conditions){\n  const expectedFocus=normalizeFocusMode(conditions.focusMode);\n  const same=attempt=>["tempo","start","end","assist","melody","countIn"].every(key=>attempt.conditions[key]===conditions[key])\n    &&normalizeFocusMode(attempt.conditions.focusMode)===expectedFocus\n    &&[...attempt.conditions.backing].sort().join() === [...conditions.backing].sort().join();\n  const recent=attempts.filter(same).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));\n  if(!recent.length) return "同じ区間を2回、止まらず音を揃えて弾けるか確認しましょう。";\n  if(!recent[0].reported.clean) return "同じ区間をゆっくり再確認。難しければテンポを4下げて、補助は今のまま練習しましょう。";\n  if(recent.length<2||!recent[1].reported.clean) return "同じ条件でもう1回確認しましょう。成功は自己評価として記録しています。";\n  return "同じ条件で2回達成（自己評価）。次回も再現できたら、次の区間かテンポ＋2を試しましょう。";\n}`;

const newAdvice = `export function practiceAdvice(attempts,conditions){\n  const expectedFocus=normalizeFocusMode(conditions.focusMode);\n  const same=attempt=>["tempo","start","end","assist","melody","countIn"].every(key=>attempt.conditions[key]===conditions[key])\n    &&normalizeFocusMode(attempt.conditions.focusMode)===expectedFocus\n    &&[...attempt.conditions.backing].sort().join() === [...conditions.backing].sort().join();\n  const recent=attempts.filter(same).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));\n  const messages={\n    reading:{\n      empty:"同じ区間の音を順に読み、答えを見る前に音名・度数・指板位置を考えましょう。",\n      fail:"同じ区間をもう一度譜読み。難しければ1小節へ縮めて確認しましょう。",\n      once:"同じ条件でもう1回、答えを見る前に判断できるか確認しましょう。",\n      twice:"同じ条件で2回達成（自己評価）。次の区間へ進む候補です。"\n    },\n    rhythm:{\n      empty:"中立音に合わせ、音高を気にせず拍・細分・アクセントだけ確認しましょう。",\n      fail:"テンポを下げ、ミュート弦・手拍子等でリズムだけ再確認しましょう。",\n      once:"同じ条件でもう1回、拍と細分を崩さず合わせられるか確認しましょう。",\n      twice:"同じ条件で2回達成（自己評価）。統合演奏で同じリズムを再確認しましょう。"\n    },\n    execution:{\n      empty:"譜読み負荷を下げ、運指・弦移動・左右同期・発音品質へ集中しましょう。",\n      fail:"短い区間または遅いテンポで、動作と発音を再確認しましょう。",\n      once:"同じ条件でもう1回、動作と発音を再現できるか確認しましょう。",\n      twice:"同じ条件で2回達成（自己評価）。統合演奏へ戻す候補です。"\n    },\n    integrated:{\n      empty:"同じ区間を2回、止まらず音を揃えて弾けるか確認しましょう。",\n      fail:"同じ区間をゆっくり再確認。難しければテンポを4下げて、補助は今のまま練習しましょう。",\n      once:"同じ条件でもう1回確認しましょう。成功は自己評価として記録しています。",\n      twice:"同じ条件で2回達成（自己評価）。次回も再現できたら、次の区間かテンポ＋2を試しましょう。"\n    }\n  }[expectedFocus];\n  if(!recent.length) return messages.empty;\n  if(!recent[0].reported.clean) return messages.fail;\n  if(recent.length<2||!recent[1].reported.clean) return messages.once;\n  return messages.twice;\n}`;
await replaceOnce("core/practice.js", oldAdvice, newAdvice);

await replaceOnce(
  "core/practice.js",
  `export function practiceFocusComparisonKey(value){`,
  `// Phase 4A compares the four focus dimensions only within the same\n// phrase/range/exact tempo. Assist, backing and melody remain Attempt\n// conditions but are intentionally not diagnosis comparison keys here.\nexport function practiceFocusComparisonKey(value){`
);

await replaceOnce(
  "phrase.js",
  `import { ASSIST_LABELS, FOCUS_MODES, SELF_REVIEW_KEYS, buildPracticeTimeline, practiceAdvice, practiceFocusDiagnosis, practiceRange, parsePracticeBackup, validateAttempt } from "./core/practice.js";`,
  `import { ASSIST_LABELS, FOCUS_MODES, FOCUS_SUCCESS_LABELS, SELF_REVIEW_KEYS, buildPracticeTimeline, focusMelodyLabel, focusResultLabel, practiceAdvice, practiceFocusDiagnosis, practiceHistoryCompletionLabel, practiceRange, parsePracticeBackup, validateAttempt } from "./core/practice.js";`
);

await replaceOnce(
  "phrase.js",
  `    $("focus-description").textContent=FOCUS_DESCRIPTIONS[state.focusMode];\n    document.body.dataset.focus=state.focusMode;`,
  `    $("focus-description").textContent=FOCUS_DESCRIPTIONS[state.focusMode];\n    $("record-clean").textContent=FOCUS_SUCCESS_LABELS[state.focusMode];\n    const resultHints={\n      reading:"自己評価の記録です。譜読み確認を終えると達成を記録できます。演奏音の自動採点は行いません。",\n      rhythm:"自己評価の記録です。中立音に拍・細分を合わせた結果を記録します。正しい音高は成功条件にしません。",\n      execution:"自己評価の記録です。動作・発音の再現を記録します。録音時は聴き返しレビューを行えます。",\n      integrated:"自己評価の記録です。演奏音の自動採点は行いません。「統合して弾けた」は選択区間を最後まで再生した後に記録できます。"\n    };\n    $("record-hint").textContent=resultHints[state.focusMode];\n    document.body.dataset.focus=state.focusMode;`
);

await replaceOnce(
  "phrase.js",
  `  function conditionsLabel(c){\n    return FOCUS_MODES[c.focusMode??"integrated"]+"・"+rangeLabel(c)+"・"+c.tempo+" BPM・"+ASSIST_LABELS[c.assist]+"・お手本"+(c.melody?"あり":"なし");\n  }`,
  `  function conditionsLabel(c){\n    const focusMode=c.focusMode??"integrated";\n    return FOCUS_MODES[focusMode]+"・"+rangeLabel(c)+"・"+c.tempo+" BPM・"+ASSIST_LABELS[c.assist]+"・"+focusMelodyLabel(focusMode,c.melody);\n  }`
);

await replaceOnce(
  "phrase.js",
  `      item.textContent=new Date(attempt.date).toLocaleString("ja-JP")+" — "+(attempt.reported.clean?"弾けた（自己評価）":"要復習（自己評価）");\n      const detail=document.createElement("small");\n      detail.textContent=conditionsLabel(attempt.conditions)+" / "+attempt.observed.completedLoops+"回再生完了";`,
  `      item.textContent=new Date(attempt.date).toLocaleString("ja-JP")+" — "+focusResultLabel(attempt.conditions.focusMode,attempt.reported.clean);\n      const detail=document.createElement("small");\n      detail.textContent=conditionsLabel(attempt.conditions)+" / "+practiceHistoryCompletionLabel(attempt);`
);

await replaceOnce(
  "phrase.html",
  `        <button id="record-clean" class="primary" type="button" disabled>弾けた</button>`,
  `        <button id="record-clean" class="primary" type="button" disabled>統合して弾けた</button>`
);

await replaceOnce(
  "phrase.html",
  `      <p class="hint">自己評価の記録です。演奏音の自動採点は行いません。「弾けた」は選択区間を最後まで再生した後に記録できます。</p>`,
  `      <p id="record-hint" class="hint">自己評価の記録です。演奏音の自動採点は行いません。「統合して弾けた」は選択区間を最後まで再生した後に記録できます。</p>`
);

await replaceOnce(
  "docs/TASK-NEXT-DIAGNOSTIC-FOCUS.md",
  `最低限、同じphrase/rangeについてfocus別の直近状況を区別して表示できればよいです。`,
  `最低限、同じphrase/rangeについてfocus別の直近状況を区別して表示できればよいです。\n\n**Phase 4Aでは同一 phrase / range / exact tempo の4focusを比較します。**\n` +
  `\`assist\` / \`backing\` / \`melody\` はAttempt条件として保持しますが、このSubphaseの診断比較キーへは追加しません。`
);

await replaceOnce(
  "tests/unit/practice-focus.test.mjs",
  `import { FOCUS_MODE_KEYS, parsePracticeBackup, practiceAdvice, practiceFocusComparisonKey, practiceFocusDiagnosis, practiceFocusStatuses, validateAttempt } from "../../core/practice.js";`,
  `import { FOCUS_MODE_KEYS, FOCUS_SUCCESS_LABELS, focusMelodyLabel, focusResultLabel, parsePracticeBackup, practiceAdvice, practiceFocusComparisonKey, practiceFocusDiagnosis, practiceFocusStatuses, practiceHistoryCompletionLabel, validateAttempt } from "../../core/practice.js";`
);

await replaceOnce(
  "tests/unit/practice-focus.test.mjs",
  `  assert.match(advice,/同じ区間を2回/);`,
  `  assert.match(advice,/運指・弦移動・左右同期・発音品質/);`
);

await appendOnce(
  "tests/unit/practice-focus.test.mjs",
  `focus-aware advice keeps reading semantics`,
  `test("focus-aware advice keeps reading semantics",()=>{\n  const conditions={tempo:80,start:1,end:2,assist:"full",melody:true,countIn:0,backing:[],focusMode:"reading"};\n  const advice=practiceAdvice([],conditions);\n  assert.match(advice,/音名・度数・指板位置/);\n  assert.doesNotMatch(advice,/弾ける|音を揃える|演奏完遂/);\n});\n\ntest("focus-aware advice keeps rhythm pitch-independent",()=>{\n  const advice=practiceAdvice([],{tempo:80,start:1,end:2,assist:"full",melody:true,countIn:0,backing:[],focusMode:"rhythm"});\n  assert.match(advice,/中立音/);\n  assert.match(advice,/音高を気にせず/);\n  assert.doesNotMatch(advice,/正しい音高.*(成功|達成|合わせ)/);\n});\n\ntest("focus-aware advice keeps execution independent from reading success",()=>{\n  const advice=practiceAdvice([],{tempo:80,start:1,end:2,assist:"full",melody:true,countIn:0,backing:[],focusMode:"execution"});\n  assert.match(advice,/運指・弦移動・左右同期・発音品質/);\n  assert.doesNotMatch(advice,/譜読み.*(成功|達成|でき)/);\n});\n\ntest("integrated advice keeps ordinary performance context",()=>{\n  const advice=practiceAdvice([],{tempo:80,start:1,end:2,assist:"full",melody:true,countIn:0,backing:[],focusMode:"integrated"});\n  assert.match(advice,/止まらず音を揃えて弾ける/);\n});\n\ntest("focus success labels are distinct and legacy maps to integrated",()=>{\n  assert.equal(new Set(Object.values(FOCUS_SUCCESS_LABELS)).size,4);\n  assert.equal(focusResultLabel("reading",true),"譜読みできた（自己評価）");\n  assert.doesNotMatch(focusResultLabel("reading",true),/弾けた/);\n  assert.equal(focusResultLabel(undefined,true),"統合して弾けた（自己評価）");\n});\n\ntest("rhythm melody condition is labeled as a rhythm guide",()=>{\n  assert.equal(focusMelodyLabel("rhythm",true),"リズムガイドあり");\n  assert.equal(focusMelodyLabel("rhythm",false),"リズムガイドなし");\n  assert.equal(focusMelodyLabel(undefined,true),"お手本あり");\n});\n\ntest("reading history completion does not present zero playback completions",()=>{\n  const label=practiceHistoryCompletionLabel(validateAttempt(attempt({focusMode:"reading",clean:true})));\n  assert.equal(label,"譜読み確認完了");\n  assert.doesNotMatch(label,/0回再生完了/);\n});`
);

await replaceOnce(
  "tests/focus.spec.mjs",
  `  await page.locator("#focus-mode").selectOption("reading");\n  await expect(page.locator("#reading-focus")).toBeVisible();`,
  `  await page.locator("#focus-mode").selectOption("reading");\n  await expect(page.locator("#record-clean")).toHaveText("譜読みできた");\n  await expect(page.locator("#record-hint")).not.toContainText("弾けた");\n  await expect(page.locator("#practice-advice")).toContainText("音名・度数・指板位置");\n  await expect(page.locator("#practice-advice")).not.toContainText("音を揃える");\n  await expect(page.locator("#reading-focus")).toBeVisible();`
);

await replaceOnce(
  "tests/focus.spec.mjs",
  `  await page.locator("summary").click();\n  const downloadPromise=page.waitForEvent("download");`,
  `  await page.locator("summary").click();\n  await expect(page.locator("#attempt-list")).toContainText("譜読みできた（自己評価）");\n  await expect(page.locator("#attempt-list")).toContainText("譜読み確認完了");\n  await expect(page.locator("#attempt-list")).not.toContainText("0回再生完了");\n  const downloadPromise=page.waitForEvent("download");`
);

await replaceOnce(
  "tests/focus.spec.mjs",
  `  await page.locator("#focus-mode").selectOption("rhythm");\n  await expect(page.locator("#record-play")).toBeDisabled();`,
  `  await page.locator("#focus-mode").selectOption("rhythm");\n  await expect(page.locator("#record-clean")).toHaveText("リズムを合わせられた");\n  await expect(page.locator("#practice-advice")).toContainText("音高を気にせず拍・細分・アクセント");\n  await expect(page.locator("#record-play")).toBeDisabled();`
);

await replaceOnce(
  "tests/focus.spec.mjs",
  `  expect(guides.every(tone=>tone.frequency===880)).toBe(true);\n  expect(tones.some(tone=>tone.type==="triangle")).toBe(false);\n});`,
  `  expect(guides.every(tone=>tone.frequency===880)).toBe(true);\n  expect(tones.some(tone=>tone.type==="triangle")).toBe(false);\n  await expect(page.locator("#record-repeat")).toBeEnabled();\n  await page.locator("#record-repeat").click();\n  await expect(page.locator("#record-status")).toContainText("保存しました");\n  await page.locator("#play").click();\n  await expect(page.locator("#practice-status")).toContainText("2回目",{timeout:7000});\n  await page.locator("#stop").click();\n  await expect(page.locator("#record-clean")).toBeEnabled();\n  await page.locator("#record-clean").click();\n  await expect(page.locator("#record-status")).toContainText("保存しました");\n  await expect(page.locator("#practice-advice")).toContainText("拍と細分");\n  await page.locator("summary").click();\n  await expect(page.locator("#attempt-list")).toContainText("リズムガイドあり");\n  await expect(page.locator("#attempt-list")).toContainText("リズムを合わせられた（自己評価）");\n  await expect(page.locator("#attempt-list")).toContainText("要復習（自己評価）");\n});`
);

await replaceOnce(
  "tests/focus.spec.mjs",
  `  await page.locator("#focus-mode").selectOption("execution");\n  await expect(page.locator("#record-play")).toBeDisabled();`,
  `  await page.locator("#focus-mode").selectOption("execution");\n  await expect(page.locator("#record-clean")).toHaveText("動作・発音を揃えられた");\n  await expect(page.locator("#practice-advice")).toContainText("運指・弦移動・左右同期・発音品質");\n  await expect(page.locator("#record-play")).toBeDisabled();`
).catch(()=>{});

await replaceOnce(
  "tests/focus.spec.mjs",
  `  await page.locator("#focus-mode").selectOption("execution");\n  await page.locator("#record-play").click();\n  await expect(page.locator("#recording-monitor")).toBeVisible({timeout:7000});`,
  `  await page.locator("#focus-mode").selectOption("execution");\n  await expect(page.locator("#record-clean")).toHaveText("動作・発音を揃えられた");\n  await expect(page.locator("#practice-advice")).toContainText("運指・弦移動・左右同期・発音品質");\n  await page.locator("#record-play").click();\n  await expect(page.locator("#recording-monitor")).toBeVisible({timeout:7000});`
);

await replaceOnce(
  "tests/focus.spec.mjs",
  `  expect(stored.recordings[0].attemptId).toBe(stored.attempts[0].id);\n  expect(stored.attempts[0].reported.review).toEqual({noise:2,evenness:2,tone:2,flow:2});\n  expect(await page.evaluate(()=>window.__trackStops)).toBe(1);`,
  `  expect(stored.recordings[0].attemptId).toBe(stored.attempts[0].id);\n  expect(stored.attempts[0].reported.review).toEqual({noise:2,evenness:2,tone:2,flow:2});\n  await page.locator("summary").click();\n  await expect(page.locator("#attempt-list")).toContainText("動作・発音を揃えられた（自己評価）");\n  await expect(page.locator("#practice-advice")).toContainText("動作と発音");\n  expect(await page.evaluate(()=>window.__trackStops)).toBe(1);`
);

await replaceOnce(
  "tests/focus.spec.mjs",
  `  await page.locator("#focus-mode").selectOption("integrated");\n  await page.locator("#play").click();`,
  `  await page.locator("#focus-mode").selectOption("integrated");\n  await expect(page.locator("#record-clean")).toHaveText("統合して弾けた");\n  await expect(page.locator("#practice-advice")).toContainText("止まらず音を揃えて弾ける");\n  await page.locator("#play").click();`
);

await replaceOnce(
  "sw.js",
  `const CACHE_NAME = "fingerstyle-practice-v15";`,
  `const CACHE_NAME = "fingerstyle-practice-v16";`
);
