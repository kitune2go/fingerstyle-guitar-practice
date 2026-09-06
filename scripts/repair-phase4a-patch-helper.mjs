import { readFile, writeFile } from "node:fs/promises";

const url=new URL("./patch-phase4a-focus-semantics.mjs",import.meta.url);
let text=await readFile(url,"utf8");
const from=`await replaceOnce(
  "tests/focus.spec.mjs",
  \`  await page.locator("summary").click();\\n  const downloadPromise=page.waitForEvent("download");\`,
  \`  await page.locator("summary").click();\\n  await expect(page.locator("#attempt-list")).toContainText("譜読みできた（自己評価）");\\n  await expect(page.locator("#attempt-list")).toContainText("譜読み確認完了");\\n  await expect(page.locator("#attempt-list")).not.toContainText("0回再生完了");\\n  const downloadPromise=page.waitForEvent("download");\`
);`;
const to=`await replaceOnce(
  "tests/focus.spec.mjs",
  \`  await expect(page.locator("#reading-answer")).toBeHidden();\\n  await page.locator("summary").click();\\n  const downloadPromise=page.waitForEvent("download");\`,
  \`  await expect(page.locator("#reading-answer")).toBeHidden();\\n  await page.locator("summary").click();\\nn  await expect(page.locator("#attempt-list")).toContainText("譜読みできた（自己評価）");\\n  await expect(page.locator("#attempt-list")).toContainText("譜読み確認完了");\\n  await expect(page.locator("#attempt-list")).not.toContainText("0回再生完了");\\n  const downloadPromise=page.waitForEvent("download");\`
);`.replace("\\n  await page.locator(\"summary\").click();\\n\\n  await", "\\n  await page.locator(\"summary\").click();\\n  await").replace("\\n  await page.locator(\"summary\").click();\\n n", "\\n  await page.locator(\"summary\").click();\\n  ");
const count=text.split(from).length-1;
if(count!==1) throw new Error(`expected one ambiguous summary replacement, found ${count}`);
text=text.replace(from,to);
await writeFile(url,text);
