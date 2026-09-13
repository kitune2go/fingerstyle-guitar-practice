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

    // On reload, route is unverified (mic not initialized / route unknown), so status must remain 未校正
    await page.reload();
    await expect(page.locator("#phrase-title")).not.toHaveText("読み込み中");
    await expect(page.locator("#calibration-badge")).toHaveText("未校正");
    await expect(page.locator("#calibration-state-text")).toHaveText("未校正");
    await expect(page.locator("#reset-calibration")).toBeDisabled();

    // When the physical route is verified (e.g. mic permission granted / active route identified), applicable calibration applies
    await page.evaluate(() => {
      // Simulate verified route establishment and trigger calibration reload
      window.dispatchEvent(new CustomEvent("fingerstyle:set-route", {
        detail: { inputRoute: "test-mic", outputRoute: "test-speaker" }
      }));
    });
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

  test("unknown output route keeps calibration status uncalibrated with explanation", async ({ page }) => {
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
        ],
        route: {
          inputRoute: "built-in-mic",
          outputRoute: "unknown"
        }
      });
    });

    await page.locator("#start-calibration").click();

    await expect(page.locator("#calibration-badge")).toHaveText("未校正");
    await expect(page.locator("#calibration-state-text")).toHaveText("未校正");
    await expect(page.locator("#calibration-message")).toContainText("入出力オーディオルートが特定できないため");
    await expect(page.locator("#reset-calibration")).toBeDisabled();

    const stored = await getStoredCalibrations(page);
    expect(stored.length).toBe(1);
    expect(stored[0].status).toBe("uncalibrated");
  });

  test("reset button is disabled while recalibration is in-flight and active playback stops", async ({ page }) => {
    await openPhrase(page);

    // 1. Establish calibrated state
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
    await expect(page.locator("#reset-calibration")).toBeEnabled();

    // 2. Start playback
    await page.locator("#play").click();
    await expect(page.locator("#play")).toBeDisabled();
    await expect(page.locator("#stop")).toBeEnabled();

    // 3. Set up in-flight collector and start calibration
    let resolveCollector;
    await page.exposeFunction("__blockCollector", () => new Promise((resolve) => {
      resolveCollector = resolve;
    }));
    await page.evaluate(() => {
      window.__calibrationCollector = async () => {
        await window.__blockCollector();
        return {
          samples: [
            { referenceTime: 0, observedTime: 45.0 },
            { referenceTime: 0, observedTime: 46.0 },
            { referenceTime: 0, observedTime: 44.0 },
            { referenceTime: 0, observedTime: 45.0 },
            { referenceTime: 0, observedTime: 45.5 },
            { referenceTime: 0, observedTime: 44.5 }
          ]
        };
      };
    });

    await page.locator("#start-calibration").click();

    // Active playback should have been stopped
    await expect(page.locator("#stop")).toBeDisabled();

    // Audio entries, configuration controls, and reset button must be disabled while recalibration is running
    await expect(page.locator("#play")).toBeDisabled();
    await expect(page.locator("#record-play")).toBeDisabled();
    await expect(page.locator("#play-note")).toBeDisabled();
    await expect(page.locator("#preview-backing")).toBeDisabled();
    await expect(page.locator("#tempo")).toBeDisabled();
    await expect(page.locator("#focus-mode")).toBeDisabled();
    await expect(page.locator("#phrase-select")).toBeDisabled();
    await expect(page.locator("#loop")).toBeDisabled();
    await expect(page.locator("#range-start")).toBeDisabled();
    await expect(page.locator("#range-end")).toBeDisabled();
    await expect(page.locator("#backing-chords")).toBeDisabled();
    await expect(page.locator("#backing-bass")).toBeDisabled();
    await expect(page.locator("#backing-drums")).toBeDisabled();
    await expect(page.locator("#count-in")).toBeDisabled();
    await expect(page.locator("#assist-mode")).toBeDisabled();
    await expect(page.locator("#melody-toggle")).toBeDisabled();
    await expect(page.locator("#reset-calibration")).toBeDisabled();
    await expect(page.locator("#start-calibration")).toBeDisabled();

    // Resolve the in-flight collector
    await page.evaluate(() => window.__unblock && window.__unblock());
    // Since __blockCollector was exposed, let's complete it:
    resolveCollector();

    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");
    await expect(page.locator("#calibration-offset")).toContainText("45.0");
    await expect(page.locator("#reset-calibration")).toBeEnabled();
    await expect(page.locator("#play")).toBeEnabled();
    await expect(page.locator("#record-play")).toBeEnabled();
    await expect(page.locator("#play-note")).toBeEnabled();
    await expect(page.locator("#preview-backing")).toBeEnabled();
    await expect(page.locator("#tempo")).toBeEnabled();
    await expect(page.locator("#focus-mode")).toBeEnabled();
    await expect(page.locator("#phrase-select")).toBeEnabled();
    await expect(page.locator("#loop")).toBeEnabled();
    await expect(page.locator("#range-start")).toBeEnabled();
    await expect(page.locator("#range-end")).toBeEnabled();
    await expect(page.locator("#backing-chords")).toBeEnabled();
    await expect(page.locator("#backing-bass")).toBeEnabled();
    await expect(page.locator("#backing-drums")).toBeEnabled();
    await expect(page.locator("#count-in")).toBeEnabled();
    await expect(page.locator("#assist-mode")).toBeEnabled();
    await expect(page.locator("#melody-toggle")).toBeEnabled();
  });

  test("failed recalibration preserves previously active applicable calibration", async ({ page }) => {
    await openPhrase(page);

    // 1. Establish initial valid calibration
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
    await expect(page.locator("#calibration-offset")).toContainText("40.0 ms");
    await expect(page.locator("#reset-calibration")).toBeEnabled();

    // 2. Retry calibration with high-spread samples (failure)
    await page.evaluate(() => {
      window.__calibrationCollector = async () => ({
        samples: [
          { referenceTime: 0, observedTime: 10 },
          { referenceTime: 0, observedTime: 70 },
          { referenceTime: 0, observedTime: 15 },
          { referenceTime: 0, observedTime: 75 },
          { referenceTime: 0, observedTime: 10 },
          { referenceTime: 0, observedTime: 70 }
        ]
      });
    });
    await page.locator("#start-calibration").click();

    // Previous valid calibration must be preserved
    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");
    await expect(page.locator("#calibration-state-text")).toHaveText("校正済み");
    await expect(page.locator("#calibration-offset")).toContainText("40.0 ms");
    await expect(page.locator("#reset-calibration")).toBeEnabled();
    await expect(page.locator("#calibration-message")).toContainText("前回の校正値を維持しています");

    // 3. Retry calibration returning unmeasurable
    await page.evaluate(() => {
      window.__calibrationCollector = async () => ({
        unmeasurable: true,
        reason: "測定に必要な信号が検出されませんでした。"
      });
    });
    await page.locator("#start-calibration").click();

    // Still preserves previous valid calibration
    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");
    await expect(page.locator("#calibration-state-text")).toHaveText("校正済み");
    await expect(page.locator("#calibration-offset")).toContainText("40.0 ms");
    await expect(page.locator("#reset-calibration")).toBeEnabled();
    await expect(page.locator("#calibration-message")).toContainText("前回の校正値を維持しています");

    // Verify stored calibrations still retain active calibrated record
    const stored = await getStoredCalibrations(page);
    const calibratedRecords = stored.filter(r => r.status === "calibrated" && r.validity.invalidatedAt === null);
    expect(calibratedRecords.length).toBe(1);
    expect(calibratedRecords[0].offsetMs).toBe(40.0);
  });

  test("existing media playback is paused before calibration starts and prevented during calibration", async ({ page }) => {
    await page.goto("/phrase.html");
    await page.waitForSelector("#start-calibration");

    // Add a test audio element with audio context tone or mock playback
    await page.evaluate(() => {
      const audio = document.createElement("audio");
      audio.id = "test-media-player";
      // Mock playing state
      Object.defineProperty(audio, "paused", { value: false, writable: true });
      audio.pause = () => { audio.paused = true; };
      document.body.appendChild(audio);
      window.__testAudio = audio;
    });

    const isPlayingBefore = await page.evaluate(() => !window.__testAudio.paused);
    expect(isPlayingBefore).toBe(true);

    let resolveCollector;
    await page.evaluate(() => {
      window.__calibrationPromise = new Promise(resolve => {
        window.__resolveCalibration = resolve;
      });
      window.__calibrationCollector = () => window.__calibrationPromise;
    });

    // Start calibration
    await page.locator("#start-calibration").click();

    // Verify audio was paused immediately
    const isPausedDuring = await page.evaluate(() => window.__testAudio.paused);
    expect(isPausedDuring).toBe(true);

    // Verify pointer-events is disabled during calibration
    const pointerEvents = await page.evaluate(() => window.__testAudio.style.pointerEvents);
    expect(pointerEvents).toBe("none");

    // Attempting to play during calibration is paused
    await page.evaluate(() => {
      window.__testAudio.paused = false;
      window.__testAudio.dispatchEvent(new Event("play"));
    });
    const isPausedAfterPlayAttempt = await page.evaluate(() => window.__testAudio.paused);
    expect(isPausedAfterPlayAttempt).toBe(true);

    // Complete calibration
    await page.evaluate(() => {
      window.__resolveCalibration({
        samples: [
          { referenceTime: 0, observedTime: 40 },
          { referenceTime: 0, observedTime: 41 },
          { referenceTime: 0, observedTime: 39 },
          { referenceTime: 0, observedTime: 40 },
          { referenceTime: 0, observedTime: 40.5 },
          { referenceTime: 0, observedTime: 39.5 }
        ]
      });
    });

    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");

    // Pointer events restored
    const pointerEventsAfter = await page.evaluate(() => window.__testAudio.style.pointerEvents);
    expect(pointerEventsAfter).toBe("");
  });

  test("atomic replacement: storage failure during replacement preserves previous valid calibration", async ({ page }) => {
    await page.goto("/phrase.html");
    await page.waitForSelector("#start-calibration");

    // 1. Initial valid calibration
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
    await expect(page.locator("#calibration-offset")).toContainText("40.0 ms");

    // 2. Inject storage failure into replaceCalibration
    await page.evaluate(() => {
      const origReplace = window.__testStoreReplace || (window.indexedDB ? true : false);
      // Hook into IndexedDB or create error in replaceCalibration
      const store = window.__practiceStore; // or monkey-patch store.replaceCalibration
    });
    await page.evaluate(() => {
      // Monkey patch replaceCalibration on state store if accessible
      // We can intercept by patching IDBObjectStore.prototype.put to throw on second calibration
      let putCount = 0;
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args) {
        putCount++;
        if (putCount > 1) {
          throw new Error("Simulated storage failure");
        }
        return originalPut.apply(this, args);
      };
      window.__calibrationCollector = async () => ({
        samples: [
          { referenceTime: 0, observedTime: 50.0 },
          { referenceTime: 0, observedTime: 51.0 },
          { referenceTime: 0, observedTime: 49.0 },
          { referenceTime: 0, observedTime: 50.0 },
          { referenceTime: 0, observedTime: 50.5 },
          { referenceTime: 0, observedTime: 49.5 }
        ]
      });
    });

    await page.locator("#start-calibration").click();

    // Previous valid calibration must be preserved
    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");
    await expect(page.locator("#calibration-offset")).toContainText("40.0 ms");
    await expect(page.locator("#calibration-message")).toContainText("前回の校正値を維持しています");

    // Verify stored records still have active valid record
    const stored = await getStoredCalibrations(page);
    const validRecords = stored.filter(r => r.status === "calibrated" && r.validity.invalidatedAt === null);
    expect(validRecords.length).toBe(1);
    expect(validRecords[0].offsetMs).toBe(40.0);
  });

  test("reset failure due to storage error retains active calibration and informs user", async ({ page }) => {
    await page.goto("/phrase.html");
    await page.waitForSelector("#start-calibration");

    // 1. Initial valid calibration
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
    await expect(page.locator("#reset-calibration")).toBeEnabled();

    // 2. Monkey-patch IDBObjectStore.prototype.put to throw on reset invalidation
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = function() {
        throw new Error("Simulated storage error on reset invalidation");
      };
    });

    // 3. Click reset calibration
    await page.locator("#reset-calibration").click();

    // Active calibration must NOT be cleared, message must state failure
    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");
    await expect(page.locator("#calibration-state-text")).toHaveText("校正済み");
    await expect(page.locator("#calibration-offset")).toContainText("40.0 ms");
    await expect(page.locator("#calibration-message")).toHaveText("校正をリセットできませんでした。もう一度お試しください。");
    await expect(page.locator("#reset-calibration")).toBeEnabled();
  });

  test("calibration initiated during active recording awaits recorder shutdown before collection", async ({ page }) => {
    await page.goto("/phrase.html");
    await page.waitForSelector("#start-calibration");

    let recorderShutdownBeforeCollector = false;
    await page.evaluate(() => {
      // Mock MediaDevices and MediaRecorder
      window.__recorderActive = false;
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await originalGetUserMedia(constraints);
        window.__recorderActive = true;
        const origStop = stream.getTracks()[0].stop.bind(stream.getTracks()[0]);
        stream.getTracks()[0].stop = () => {
          window.__recorderActive = false;
          origStop();
        };
        return stream;
      };

      window.__calibrationCollector = async () => {
        // At the moment collector is called, previous recorder must NOT be active
        window.__recorderActiveAtCollectorStart = window.__recorderActive;
        return {
          samples: [
            { referenceTime: 0, observedTime: 40.0 },
            { referenceTime: 0, observedTime: 41.0 },
            { referenceTime: 0, observedTime: 39.0 },
            { referenceTime: 0, observedTime: 40.0 },
            { referenceTime: 0, observedTime: 40.5 },
            { referenceTime: 0, observedTime: 39.5 }
          ]
        };
      };
    });

    // Start practice with recording
    await page.locator("#record-play").click();
    await page.waitForTimeout(500);

    // Now start calibration while recording was running
    await page.locator("#start-calibration").click();

    await expect(page.locator("#calibration-badge")).toHaveText("校正済み");
    const activeAtStart = await page.evaluate(() => window.__recorderActiveAtCollectorStart);
    expect(activeAtStart).toBe(false);
  });
});
