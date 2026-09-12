import { test, expect } from "@playwright/test";

async function openPhrase(page) {
  await page.goto("/phrase.html");
  await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
}

async function getStoredCalibrations(page) {
  return page.evaluate(async () => {
    const { createPracticeStore } = await import("./core/practice-store.js");
    const store = createPracticeStore(indexedDB);
    return store.allCalibrations();
  });
}

test.describe("Minimal Calibration UI & Browser Calibration Flow", () => {
  test("default state shows 未校正 with reset-calibration disabled", async ({ page }) => {
    await openPhrase(page);
    await expect(page.locator("#calibration-badge")).toHaveText("未校正");
    await expect(page.locator("#calibration-state-text")).toHaveText("未校正");
    await expect(page.locator("#reset-calibration")).toBeDisabled();
    await expect(page.locator("#calibration-offset")).toHaveText("—");
    await expect(page.locator("#calibration-spread")).toHaveText("—");
    await expect(page.locator("#calibration-path")).toHaveText("roundTrip");
  });

  test("successful calibration flow with valid samples saves to IndexedDB and survives reload", async ({ page }) => {
    await openPhrase(page);

    await page.evaluate(() => {
      window.__calibrationCollector = async () => ({
        samples: [
          { referenceTime: 0, observedTime: 36.5 },
          { referenceTime: 0, observedTime: 43.5 },
          { referenceTime: 0, observedTime: 37.0 },
          { referenceTime: 0, observedTime: 43.0 },
          { referenceTime: 0, observedTime: 38.0 },
          { referenceTime: 0, observedTime: 42.0 }
        ]
      });
    });

    await page.locator("#start-calibration").click();

    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");
    await expect(page.locator("#calibration-state-text")).toHaveText("校正済み");
    await expect(page.locator("#calibration-offset")).toContainText("40.0 ms");
    await expect(page.locator("#calibration-spread")).toContainText("ms");
    await expect(page.locator("#reset-calibration")).toBeEnabled();

    const stored = await getStoredCalibrations(page);
    expect(stored.length).toBe(1);
    expect(stored[0].status).toBe("calibrated");
    expect(stored[0].pathKind).toBe("roundTrip");
    expect(stored[0].sampleCount).toBe(6);
    expect(stored[0].offsetMs).toBe(40.0);

    // Survives page reload
    await page.reload();
    await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");
    await expect(page.locator("#calibration-state-text")).toHaveText("校正済み");
    await expect(page.locator("#calibration-offset")).toContainText("40.0 ms");
    await expect(page.locator("#reset-calibration")).toBeEnabled();
  });

  test("high spread samples (>20ms) evaluates to uncalibrated and is rejected as calibrated", async ({ page }) => {
    await openPhrase(page);

    await page.evaluate(() => {
      window.__calibrationCollector = async () => ({
        samples: [
          { referenceTime: 0, observedTime: 10 },
          { referenceTime: 0, observedTime: 65 },
          { referenceTime: 0, observedTime: 15 },
          { referenceTime: 0, observedTime: 70 },
          { referenceTime: 0, observedTime: 10 },
          { referenceTime: 0, observedTime: 65 }
        ]
      });
    });

    await page.locator("#start-calibration").click();

    await expect(page.locator("#calibration-badge")).toHaveText("未校正");
    await expect(page.locator("#calibration-state-text")).toHaveText("未校正");
    await expect(page.locator("#reset-calibration")).toBeDisabled();
    await expect(page.locator("#calibration-message")).toContainText("ばらつき");

    const stored = await getStoredCalibrations(page);
    expect(stored.length).toBe(1);
    expect(stored[0].status).toBe("uncalibrated");
    expect(stored[0].precision.spreadMs).toBeGreaterThan(20);
  });

  test("unmeasurable scenario displays 測定不能 with reason and without zero-filling", async ({ page }) => {
    await openPhrase(page);

    await page.evaluate(() => {
      window.__calibrationCollector = async () => ({
        unmeasurable: true,
        reason: "マイク入力信号が検出されませんでした。"
      });
    });

    await page.locator("#start-calibration").click();

    await expect(page.locator("#calibration-badge")).toHaveText("測定不能");
    await expect(page.locator("#calibration-state-text")).toHaveText("測定不能");
    await expect(page.locator("#calibration-message")).toHaveText("マイク入力信号が検出されませんでした。");
    // Value MUST be null / placeholder and NEVER zero-filled
    await expect(page.locator("#calibration-offset")).toHaveText("—");
    await expect(page.locator("#calibration-spread")).toHaveText("—");
    await expect(page.locator("#reset-calibration")).toBeDisabled();
  });

  test("no collector surfaces unmeasurable with reason and without zero-filling", async ({ page }) => {
    await openPhrase(page);

    // No window.__calibrationCollector provided
    await page.locator("#start-calibration").click();

    await expect(page.locator("#calibration-badge")).toHaveText("測定不能");
    await expect(page.locator("#calibration-state-text")).toHaveText("測定不能");
    await expect(page.locator("#calibration-message")).not.toBeEmpty();
    await expect(page.locator("#calibration-offset")).toHaveText("—");
    await expect(page.locator("#calibration-spread")).toHaveText("—");
    await expect(page.locator("#reset-calibration")).toBeDisabled();
  });

  test("reset calibration invalidates active calibration and returns UI to 未校正", async ({ page }) => {
    await openPhrase(page);

    await page.evaluate(() => {
      window.__calibrationCollector = async () => ({
        samples: [
          { referenceTime: 0, observedTime: 40.0 },
          { referenceTime: 0, observedTime: 41.0 },
          { referenceTime: 0, observedTime: 39.0 },
          { referenceTime: 0, observedTime: 40.0 },
          { referenceTime: 0, observedTime: 40.5 },
          { referenceTime: 0, observedTime: 39.5 }
        ]
      });
    });

    await page.locator("#start-calibration").click();
    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");
    await expect(page.locator("#calibration-offset")).toContainText("40.0");
    await expect(page.locator("#reset-calibration")).toBeEnabled();

    // Run calibration a second time with different valid samples
    await page.evaluate(() => {
      window.__calibrationCollector = async () => ({
        samples: [
          { referenceTime: 0, observedTime: 55.0 },
          { referenceTime: 0, observedTime: 56.0 },
          { referenceTime: 0, observedTime: 54.0 },
          { referenceTime: 0, observedTime: 55.0 },
          { referenceTime: 0, observedTime: 55.5 },
          { referenceTime: 0, observedTime: 54.5 }
        ]
      });
    });
    await page.locator("#start-calibration").click();
    await expect(page.locator("#calibration-offset")).toContainText("55.0");

    // Reset should invalidate all applicable calibrations, not just the active one
    await page.locator("#reset-calibration").click();
    await expect(page.locator("#calibration-badge")).toHaveText("未校正");
    await expect(page.locator("#calibration-state-text")).toHaveText("未校正");
    await expect(page.locator("#reset-calibration")).toBeDisabled();
    await expect(page.locator("#calibration-offset")).toHaveText("—");

    // Reload page to verify that neither the first nor second calibration reactivates
    await page.reload();
    await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
    await expect(page.locator("#calibration-badge")).toHaveText("未校正");
    await expect(page.locator("#reset-calibration")).toBeDisabled();
  });

  test("page remains within 390px mobile viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPhrase(page);

    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    );
    expect(fits).toBe(true);

    // Also check after calibrating
    await page.evaluate(() => {
      window.__calibrationCollector = async () => ({
        samples: [
          { referenceTime: 0, observedTime: 40.0 },
          { referenceTime: 0, observedTime: 41.0 },
          { referenceTime: 0, observedTime: 39.0 },
          { referenceTime: 0, observedTime: 40.0 },
          { referenceTime: 0, observedTime: 40.5 },
          { referenceTime: 0, observedTime: 39.5 }
        ]
      });
    });
    await page.locator("#start-calibration").click();
    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");

    const fitsCalibrated = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    );
    expect(fitsCalibrated).toBe(true);
  });

  test("existing focus modes, practice, and recording features continue to work without regression", async ({ page }) => {
    await openPhrase(page);

    // Switching focus modes works
    await page.locator("#focus-mode").selectOption("reading");
    await expect(page.locator("#reading-focus")).toBeVisible();

    await page.locator("#focus-mode").selectOption("rhythm");
    await expect(page.locator("#focus-mode")).toHaveValue("rhythm");

    await page.locator("#focus-mode").selectOption("integrated");
    await expect(page.locator("#focus-mode")).toHaveValue("integrated");

    // Note trainer works
    await page.locator("#next-note").click();
    await expect(page.locator("#note-name")).not.toHaveText("—");

    // Calibration panel remains functional
    await expect(page.locator("#calibration-badge")).toBeVisible();
  });
});
