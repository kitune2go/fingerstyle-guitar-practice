import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path,before,after){
  const source=await readFile(path,"utf8");
  if(!source.includes(before)) throw new Error(`${path}: expected source not found`);
  const updated=source.replace(before,after);
  if(updated===source) throw new Error(`${path}: replacement made no change`);
  await writeFile(path,updated.trimEnd()+"\n");
}

await replaceOnce(
  "phrase.js",
  '    const recordButton=$("record-play");\n    if(recordButton) recordButton.disabled=state.starting||state.running||state.focusMode==="reading";\n  }',
  '    // Keep one source of truth for focus-specific audio entry availability.\n    // This prevents range/assist redraws from re-enabling recording in rhythm.\n    setAudioEntriesPending(state.starting);\n  }'
);

await replaceOnce(
  "phrase.js",
  '      const attempts=await state.store.all();\n      const blob=new Blob([JSON.stringify({format:"guitar-phrase-practice",version:1,attempts},null,2)],{type:"application/json"});',
  '      const attempts=(await state.store.all()).map(validateAttempt);\n      const blob=new Blob([JSON.stringify({format:"guitar-phrase-practice",version:1,attempts},null,2)],{type:"application/json"});'
);

await replaceOnce(
  "tests/focus.spec.mjs",
  '  await page.locator("#focus-mode").selectOption("rhythm");\n  await page.locator("#loop").click();',
  '  await page.locator("#focus-mode").selectOption("rhythm");\n  await expect(page.locator("#record-play")).toBeDisabled();\n  await page.locator("#assist-mode").selectOption("no-names");\n  await expect(page.locator("#record-play")).toBeDisabled();\n  await page.locator("#range-one").click();\n  await expect(page.locator("#record-play")).toBeDisabled();\n  await page.locator("#loop").click();'
);

await replaceOnce(
  "tests/focus.spec.mjs",
  '  const stored=await attempts(page);\n  expect(stored.find(item=>item.id==="legacy-focus").conditions.focusMode).toBe("integrated");\n});',
  '  const stored=await attempts(page);\n  expect(stored.find(item=>item.id==="legacy-focus").conditions.focusMode).toBe("integrated");\n  await page.locator("summary").click();\n  const downloadPromise=page.waitForEvent("download");\n  await page.locator("#export-practice").click();\n  const download=await downloadPromise;\n  const backup=JSON.parse((await readFile(await download.path())).toString());\n  expect(backup.version).toBe(1);\n  expect(backup.attempts.find(item=>item.id==="legacy-focus").conditions.focusMode).toBe("integrated");\n});'
);
