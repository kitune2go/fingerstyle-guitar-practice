import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:4173";
test.use({ viewport: { width: 390, height: 844 } });

test("basic practice loads on mobile", async ({ page }) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+"/index.html");
  await expect(page.getByRole("heading",{name:"指弾きギター練習帖"})).toBeVisible();
  await expect(page.locator("#lesson-title")).not.toHaveText("読み込み中です。");
  await expect(page.getByRole("link",{name:"フレーズ"})).toBeVisible();
  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test("musical phrase renders readable notes, key, bars and backing", async ({ page }) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));

  await page.goto(base+"/phrase.html");
  await expect(page.locator("#phrase-title")).toHaveText("Cメジャー 8小節エチュード");
  await expect(page.locator("#key-label")).toHaveText("C Major");
  await expect(page.locator("#bar-label")).toHaveText("8 BARS");
  await expect(page.locator(".staff-system")).toHaveCount(8);
  await expect(page.locator(".chord-chip")).toHaveCount(8);

  const noteCount=await page.locator(".note-head").count();
  expect(noteCount).toBeGreaterThan(20);
  const firstHead=page.locator(".note-head").first();
  await expect(firstHead).toBeVisible();
  const box=await firstHead.boundingBox();
  expect(box.width).toBeGreaterThan(4);
  expect(box.height).toBeGreaterThan(3);

  await expect(page.locator("#backing-chords")).toHaveAttribute("aria-pressed","true");
  await page.locator("#backing-bass").click();
  await expect(page.locator("#backing-bass")).toHaveAttribute("aria-pressed","false");
  await page.locator("#backing-bass").click();

  await page.getByRole("button",{name:"次 →"}).click();
  await expect(page.locator("#position-label")).toContainText("2 of");

  await page.getByRole("button",{name:"▶ 再生"}).click();
  await expect(page.getByRole("button",{name:"■ 停止"})).toBeEnabled();
  await page.waitForTimeout(220);
  await page.getByRole("button",{name:"■ 停止"}).click();

  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test("G major score shows key signature marker", async ({ page }) => {
  await page.goto(base+"/phrase.html");
  await page.locator("#phrase-select").selectOption("1");
  await expect(page.locator("#key-label")).toHaveText("G Major");
  await expect(page.locator(".key-signature")).toHaveText("♯");
  await expect(page.locator(".staff-system")).toHaveCount(8);
});

test("rhythm practice is integrated and interactive", async ({ page }) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+"/rhythm.html");
  await expect(page.getByRole("heading",{name:"Rhythm Practice"})).toBeVisible();
  await expect(page.locator("#patternSelect option")).not.toHaveCount(0);
  await expect(page.getByRole("link",{name:"基礎"})).toBeVisible();
  await expect(page.getByRole("link",{name:"フレーズ"})).toBeVisible();
  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});
