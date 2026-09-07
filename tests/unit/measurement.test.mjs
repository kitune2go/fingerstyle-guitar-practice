import { test } from "node:test";
import assert from "node:assert/strict";
import * as measurement from "../../core/measurement.js";
import { MEASUREMENT_STATES, validateMeasurementResult } from "../../core/measurement.js";

function result(overrides = {}) {
  return {
    metric: "onset-offset",
    state: "measured",
    value: 12.5,
    unit: "ms",
    calibrationId: "cal-1",
    reason: null,
    ...overrides
  };
}

test("measurement states are explicit", () => assert.deepEqual(MEASUREMENT_STATES, ["measured", "uncalibrated", "unmeasurable"]));

test("measured result is valid", () => assert.equal(validateMeasurementResult(result()).value, 12.5));
test("measured value zero is a valid measurement", () => assert.equal(validateMeasurementResult(result({ value: 0 })).value, 0));
test("measured null is rejected", () => assert.throws(() => validateMeasurementResult(result({ value: null }))));
test("measured NaN is rejected", () => assert.throws(() => validateMeasurementResult(result({ value: Number.NaN }))));
test("measured Infinity is rejected", () => assert.throws(() => validateMeasurementResult(result({ value: Number.POSITIVE_INFINITY }))));

test("uncalibrated result may retain a finite raw value without calibrationId", () => {
  const normalized = validateMeasurementResult(result({
    state: "uncalibrated",
    value: 18,
    calibrationId: null,
    reason: "matching calibration unavailable"
  }));
  assert.equal(normalized.state, "uncalibrated");
  assert.equal(normalized.value, 18);
  assert.equal(normalized.calibrationId, null);
});

test("uncalibrated result may explicitly have no raw value", () => {
  const normalized = validateMeasurementResult(result({
    state: "uncalibrated",
    value: null,
    calibrationId: null,
    reason: null
  }));
  assert.equal(normalized.value, null);
});

test("unmeasurable is valid with null and a reason", () => {
  const normalized = validateMeasurementResult(result({
    state: "unmeasurable",
    value: null,
    calibrationId: null,
    reason: "input signal unavailable"
  }));
  assert.equal(normalized.value, null);
});

test("unmeasurable value zero is rejected", () => assert.throws(() => validateMeasurementResult(result({
  state: "unmeasurable",
  value: 0,
  calibrationId: null,
  reason: "input signal unavailable"
}))));

test("unmeasurable without reason is rejected", () => assert.throws(() => validateMeasurementResult(result({
  state: "unmeasurable",
  value: null,
  calibrationId: null,
  reason: null
}))));

test("unknown measurement state is rejected", () => assert.throws(() => validateMeasurementResult(result({ state: "estimated" }))));
test("empty metric is rejected", () => assert.throws(() => validateMeasurementResult(result({ metric: "" }))));
test("empty unit is rejected", () => assert.throws(() => validateMeasurementResult(result({ unit: "" }))));
test("strict measurement validation rejects unknown fields", () => assert.throws(() => validateMeasurementResult({ ...result(), score: 100 })));

test("reported evidence has no API that promotes it to measured", () => {
  assert.equal("fromReported" in measurement, false);
  assert.equal("promoteReportedToMeasured" in measurement, false);
});

test("observed evidence has no API that promotes it to measured", () => {
  assert.equal("fromObserved" in measurement, false);
  assert.equal("promoteObservedToMeasured" in measurement, false);
});
