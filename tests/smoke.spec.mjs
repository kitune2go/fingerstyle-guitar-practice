import { test, expect } from "@playwright/test";

const base = "http://127.0.0.1:4173";

test.use({ viewport: { width: 390, height: 844 } });

test("basic practice loads on mobile", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(base + "/index.html");
  await expect(page.getByRole("heading", { name: "指弾きギター練習帖" })).toBeVisible();
  await expect(page.locator("#lesson-title")).not.toHaveText("読み込み中です。");
  await expect(page.getByRole("link", { name: "フレーズ" })).toBeVisible();

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test("playable phrase score renders and transport starts", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(base + "/phrase.html");
  await expect(page.locator("#phrase-title")).toHaveText("開放弦 i–m");
  await expect(page.locator(".note-head")).toHaveCount(8);
  await expect(page.locator("#note-name")).toHaveText("E4");

  await page.getByRole("button", { name: "次 →" }).click();
  await expect(page.locator("#position-label")).toHaveText("2 / 8");

  await page.getByRole("button", { name: "▶ 再生" }).click();
  await expect(page.getByRole("button", { name: "■ 停止" })).toBeEnabled();
  await page.waitForTimeout(180);
  await page.getByRole("button", { name: "■ 停止" }).click();

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});

test("rhythm practice is integrated and interactive", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(base + "/rhythm.html");
  await expect(page.getByRole("heading", { name: "Rhythm Practice" })).toBeVisible();
  await expect(page.locator("#patternSelect option")).not.toHaveCount(0);
  await expect(page.getByRole("link", { name: "基礎" })).toBeVisible();
  await expect(page.getByRole("link", { name: "フレーズ" })).toBeVisible();

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBeTruthy();
  expect(errors).toEqual([]);
});
