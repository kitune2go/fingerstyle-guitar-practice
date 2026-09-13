import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALIBRATION_PATH_KINDS,
  CALIBRATION_STATUSES,
  PRECISION_METHODS,
  SIGN_CONVENTION,
  MIN_CALIBRATION_SAMPLES,
  MAX_CALIBRATION_SPREAD_MS,
  validateCalibrationRecord,
  applyCalibrationOffset,
  calibrationApplies,
  evaluateCalibrationQuality,
  invalidateCalibration,
  extractSampleOffsetMs
} from "../../core/calibration.js";

function record(overrides = {}) {
  const base = {
    id: "cal-1",
    createdAt: "2026-09-06T00:00:00.000Z",
    pathKind: "roundTrip",
    timebase: { reference: "audio-context", observed: "audio-context" },
    offsetMs: 42.5,
    signConvention: SIGN_CONVENTION,
    sampleCount: 8,
    precision: { spreadMs: 4.2, method: "stddev" },
    environment: { inputRoute: "built-in-mic", outputRoute: "built-in-speaker" },
    status: "calibrated",
    validity: { invalidatedAt: null, reason: null }
  };
  return {
    ...base,
    ...overrides,
    timebase: { ...base.timebase, ...(overrides.timebase ?? {}) },
    precision: { ...base.precision, ...(overrides.precision ?? {}) },
    environment: { ...base.environment, ...(overrides.environment ?? {}) },
    validity: { ...base.validity, ...(overrides.validity ?? {}) }
  };
}

function target(pathKind, overrides = {}) {
  return {
    pathKind,
    timebase: {
      reference: "audio-context",
      observed: "audio-context",
      ...(overrides.timebase ?? {})
    },
    environment: {
      inputRoute: "built-in-mic",
      outputRoute: "built-in-speaker",
      ...(overrides.environment ?? {})
    }
  };
}

test("calibration constants keep the Phase 4B boundary centralized", () => {
  assert.deepEqual(CALIBRATION_PATH_KINDS, ["roundTrip", "input", "output"]);
  assert.deepEqual(CALIBRATION_STATUSES, ["calibrated", "uncalibrated"]);
  assert.deepEqual(PRECISION_METHODS, ["stddev"]);
  assert.equal(SIGN_CONVENTION, "observed-minus-reference");
  assert.equal(MIN_CALIBRATION_SAMPLES, 5);
  assert.equal(MAX_CALIBRATION_SPREAD_MS, 20);
});

test("roundTrip record is valid", () => assert.equal(validateCalibrationRecord(record()).pathKind, "roundTrip"));
test("input record is valid", () => assert.equal(validateCalibrationRecord(record({ pathKind: "input" })).pathKind, "input"));
test("output record is valid", () => assert.equal(validateCalibrationRecord(record({ pathKind: "output" })).pathKind, "output"));
test("unknown pathKind is rejected", () => assert.throws(() => validateCalibrationRecord(record({ pathKind: "nearby" }))));

test("positive offset correction subtracts observed-minus-reference", () => assert.equal(applyCalibrationOffset(150, 50), 100));
test("negative offset correction uses the same convention", () => assert.equal(applyCalibrationOffset(100, -25), 125));

test("roundTrip cannot apply to input", () => assert.equal(calibrationApplies(record(), target("input")), false));
test("roundTrip cannot apply to output", () => assert.equal(calibrationApplies(record(), target("output")), false));
test("input applies to matching input", () => assert.equal(calibrationApplies(record({ pathKind: "input" }), target("input")), true));
test("output applies to matching output", () => assert.equal(calibrationApplies(record({ pathKind: "output" }), target("output")), true));
test("input cannot apply to output", () => assert.equal(calibrationApplies(record({ pathKind: "input" }), target("output")), false));
test("output cannot apply to input", () => assert.equal(calibrationApplies(record({ pathKind: "output" }), target("input")), false));
test("input cannot apply to roundTrip", () => assert.equal(calibrationApplies(record({ pathKind: "input" }), target("roundTrip")), false));
test("output cannot apply to roundTrip", () => assert.equal(calibrationApplies(record({ pathKind: "output" }), target("roundTrip")), false));

test("reference timebase mismatch is not applicable", () => assert.equal(calibrationApplies(record({ pathKind: "input" }), target("input", { timebase: { reference: "performance" } })), false));
test("observed timebase mismatch is not applicable", () => assert.equal(calibrationApplies(record({ pathKind: "input" }), target("input", { timebase: { observed: "capture" } })), false));
test("inputRoute mismatch is not applicable", () => assert.equal(calibrationApplies(record({ pathKind: "input" }), target("input", { environment: { inputRoute: "usb-mic" } })), false));
test("outputRoute mismatch is not applicable", () => assert.equal(calibrationApplies(record({ pathKind: "output" }), target("output", { environment: { outputRoute: "headphones" } })), false));
test("unknown route does not match even if both are unknown", () => {
  assert.equal(calibrationApplies(record({ environment: { inputRoute: "unknown" } }), target("roundTrip", { environment: { inputRoute: "unknown" } })), false);
  assert.equal(calibrationApplies(record({ environment: { outputRoute: "unknown" } }), target("roundTrip", { environment: { outputRoute: "unknown" } })), false);
});
test("invalidated record is not applicable", () => assert.equal(calibrationApplies(record({ validity: { invalidatedAt: "2026-09-07T00:00:00Z", reason: "route changed" } }), target("roundTrip")), false));
test("uncalibrated record is not applicable", () => assert.equal(calibrationApplies(record({ status: "uncalibrated" }), target("roundTrip")), false));

test("sampleCount 4 evaluates uncalibrated", () => assert.equal(evaluateCalibrationQuality(record({ sampleCount: 4 })), "uncalibrated"));
test("sampleCount 5 can satisfy the threshold", () => assert.equal(evaluateCalibrationQuality(record({ sampleCount: 5 })), "calibrated"));
test("spread 21 evaluates uncalibrated", () => assert.equal(evaluateCalibrationQuality(record({ precision: { spreadMs: 21 } })), "uncalibrated"));
test("spread 20 can satisfy the threshold", () => assert.equal(evaluateCalibrationQuality(record({ precision: { spreadMs: 20 } })), "calibrated"));
test("calibrated status is not trusted when quality fails", () => assert.equal(calibrationApplies(record({ sampleCount: 4, status: "calibrated" }), target("roundTrip")), false));

test("NaN offset is rejected", () => assert.throws(() => validateCalibrationRecord(record({ offsetMs: Number.NaN }))));
test("Infinity offset is rejected", () => assert.throws(() => validateCalibrationRecord(record({ offsetMs: Number.POSITIVE_INFINITY }))));
test("negative spread is rejected", () => assert.throws(() => validateCalibrationRecord(record({ precision: { spreadMs: -1 } }))));
test("NaN spread is rejected", () => assert.throws(() => validateCalibrationRecord(record({ precision: { spreadMs: Number.NaN } }))));
test("Infinity spread is rejected", () => assert.throws(() => validateCalibrationRecord(record({ precision: { spreadMs: Number.POSITIVE_INFINITY } }))));
test("invalid createdAt is rejected", () => assert.throws(() => validateCalibrationRecord(record({ createdAt: "not-a-date" }))));
test("empty id is rejected", () => assert.throws(() => validateCalibrationRecord(record({ id: "" }))));
test("non-string id is rejected", () => assert.throws(() => validateCalibrationRecord(record({ id: 1 }))));
test("unknown sign convention is rejected", () => assert.throws(() => validateCalibrationRecord(record({ signConvention: "reference-minus-observed" }))));
test("sampleCount below one is rejected", () => assert.throws(() => validateCalibrationRecord(record({ sampleCount: 0 }))));
test("non-integer sampleCount is rejected", () => assert.throws(() => validateCalibrationRecord(record({ sampleCount: 1.5 }))));
test("unknown precision method is rejected", () => assert.throws(() => validateCalibrationRecord(record({ precision: { method: "range" } }))));
test("empty reference timebase is rejected", () => assert.throws(() => validateCalibrationRecord(record({ timebase: { reference: "" } }))));
test("empty observed timebase is rejected", () => assert.throws(() => validateCalibrationRecord(record({ timebase: { observed: "" } }))));
test("unknown status is rejected", () => assert.throws(() => validateCalibrationRecord(record({ status: "trusted" }))));
test("invalid invalidatedAt is rejected", () => assert.throws(() => validateCalibrationRecord(record({ validity: { invalidatedAt: "yesterday", reason: "route changed" } }))));
test("strict validation rejects unknown fields", () => assert.throws(() => validateCalibrationRecord({ ...record(), guessedLatencyMs: 10 })));

test("validation returns an independent frozen nested record", () => {
  const input = record();
  const normalized = validateCalibrationRecord(input);
  input.environment.inputRoute = "changed";
  input.timebase.reference = "changed";
  input.precision.spreadMs = 99;
  assert.equal(normalized.environment.inputRoute, "built-in-mic");
  assert.equal(normalized.timebase.reference, "audio-context");
  assert.equal(normalized.precision.spreadMs, 4.2);
  assert.notEqual(normalized, input);
  assert.notEqual(normalized.environment, input.environment);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.environment), true);
});

test("invalidateCalibration returns a new invalidated record without mutating the source", () => {
  const input = record();
  const invalidated = invalidateCalibration(input, { at: "2026-09-07T01:02:03Z", reason: "route changed" });
  assert.equal(input.validity.invalidatedAt, null);
  assert.equal(invalidated.validity.invalidatedAt, "2026-09-07T01:02:03Z");
  assert.equal(invalidated.validity.reason, "route changed");
  assert.notEqual(invalidated, input);
});

test("extractSampleOffsetMs handles unit 's' correctly", () => {
  assert.equal(extractSampleOffsetMs({ referenceTime: 0, observedTime: 0.04, unit: "s" }), 40);
  assert.equal(extractSampleOffsetMs({ offsetMs: 0.04, unit: "s" }), 40);
});

test("extractSampleOffsetMs handles unit 'ms' correctly", () => {
  assert.equal(extractSampleOffsetMs({ referenceTime: 0, observedTime: 5, unit: "ms" }), 5);
  assert.equal(extractSampleOffsetMs({ offsetMs: 5, unit: "ms" }), 5);
});

test("extractSampleOffsetMs treats unspecified unit as milliseconds without guessing", () => {
  // Unspecified unit must remain 5ms and NOT be converted to 5000ms
  assert.equal(extractSampleOffsetMs({ referenceTime: 0, observedTime: 5 }), 5);
  assert.equal(extractSampleOffsetMs({ offsetMs: 5 }), 5);
  assert.equal(extractSampleOffsetMs({ referenceTime: 0, observedTime: 5, unit: null }), 5);
});

test("extractSampleOffsetMs throws on unsupported unit", () => {
  assert.throws(() => extractSampleOffsetMs({ referenceTime: 0, observedTime: 5, unit: "minutes" }), TypeError);
  assert.throws(() => extractSampleOffsetMs({ offsetMs: 5, unit: "hours" }), TypeError);
});
