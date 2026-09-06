import { readFile, writeFile } from "node:fs/promises";

const url=new URL("./patch-phase4a-focus-semantics.mjs",import.meta.url);
let text=await readFile(url,"utf8");

function replaceSourceOnce(from,to){
  const count=text.split(from).length-1;
  if(count!==1) throw new Error(`expected one helper-source match, found ${count}`);
  text=text.replace(from,to);
}

replaceSourceOnce(
  '  `  await page.locator("summary").click();\\n  const downloadPromise=page.waitForEvent("download");`,',
  '  `  await expect(page.locator("#reading-answer")).toBeHidden();\\n  await page.locator("summary").click();\\n  const downloadPromise=page.waitForEvent("download");`,'
);
replaceSourceOnce(
  '  `  await page.locator("summary").click();\\n  await expect(page.locator("#attempt-list")).toContainText("譜読みできた（自己評価）");',
  '  `  await expect(page.locator("#reading-answer")).toBeHidden();\\n  await page.locator("summary").click();\\n  await expect(page.locator("#attempt-list")).toContainText("譜読みできた（自己評価）");'
);

await writeFile(url,text);
