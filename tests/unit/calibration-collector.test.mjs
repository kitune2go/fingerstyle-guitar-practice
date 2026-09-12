import test from "node:test";
import assert from "node:assert/strict";
import {
  CALIBRATION_BURST_FREQ_HZ,
  CALIBRATION_BURST_DURATION_SEC,
  CALIBRATION_CORRELATION_THRESHOLD,
  generateReferenceBurst,
  computeNormalizedCorrelation
} from "../../core/calibration-signal.js";
import { runAcousticCalibrationCollector } from "../../core/calibration-collector.js";

test("calibration burst generation respects duration and non-zero energy", () => {
  const sampleRate = 48000;
  const burst = generateReferenceBurst(sampleRate);
  assert.equal(burst.length, Math.round(sampleRate * CALIBRATION_BURST_DURATION_SEC));
  assert.equal(burst.length, 480);
  assert.equal(burst[0], 0); // Hann window start
  assert.ok(Math.abs(burst[burst.length - 1]) < 1e-4); // Hann window end
  const maxVal = Math.max(...burst);
  assert.ok(maxVal > 0.5);
});

test("computeNormalizedCorrelation detects perfect match and rejects noise/silence", () => {
  const sampleRate = 48000;
  const burst = generateReferenceBurst(sampleRate);
  // Perfect match at offset 0
  const matchScore = computeNormalizedCorrelation(burst, 0, burst);
  assert.ok(Math.abs(matchScore - 1.0) < 1e-4);

  // Silence gives 0
  const silence = new Float32Array(burst.length * 2);
  const silenceScore = computeNormalizedCorrelation(silence, 0, burst);
  assert.equal(silenceScore, 0);

  // Inverted waveform gives -1
  const inverted = new Float32Array(burst.length);
  for (let i = 0; i < burst.length; i++) inverted[i] = -burst[i];
  const invertedScore = computeNormalizedCorrelation(inverted, 0, burst);
  assert.ok(Math.abs(invertedScore - (-1.0)) < 1e-4);
});

test("runAcousticCalibrationCollector returns unmeasurable on missing context or permissions", async () => {
  // No audio context
  const res1 = await runAcousticCalibrationCollector({ audioContext: null });
  assert.equal(res1.unmeasurable, true);
  assert.ok(res1.reason.includes("Web Audio"));

  // Permission denied
  const mockAudioContext = {
    audioWorklet: { addModule: async () => {} }
  };
  const mockMediaDevices = {
    getUserMedia: async () => {
      const err = new Error("Permission denied");
      err.name = "NotAllowedError";
      throw err;
    }
  };
  const res2 = await runAcousticCalibrationCollector({
    audioContext: mockAudioContext,
    mediaDevices: mockMediaDevices
  });
  assert.equal(res2.unmeasurable, true);
  assert.equal(res2.reason, "マイクの利用が許可されませんでした。");
});
