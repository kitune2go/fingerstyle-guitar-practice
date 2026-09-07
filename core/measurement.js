export const MEASUREMENT_STATES = Object.freeze([
  "measured",
  "uncalibrated",
  "unmeasurable"
]);

const RESULT_KEYS = new Set([
  "metric", "state", "value", "unit", "calibrationId", "reason"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function nullableNonEmptyString(value, name) {
  if (value === null || value === undefined) return null;
  return requireNonEmptyString(value, name);
}

function finiteOrNull(value, name) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite or null`);
  }
  return value;
}

export function validateMeasurementResult(value) {
  if (!isPlainObject(value)) throw new TypeError("measurement result must be an object");
  for (const key of Object.keys(value)) {
    if (!RESULT_KEYS.has(key)) throw new TypeError(`measurement.${key} is not supported`);
  }
  if (!MEASUREMENT_STATES.includes(value.state)) {
    throw new TypeError("measurement state is not supported");
  }
  if (!("value" in value)) throw new TypeError("value is required");

  const metric = requireNonEmptyString(value.metric, "metric");
  const unit = requireNonEmptyString(value.unit, "unit");
  const calibrationId = nullableNonEmptyString(value.calibrationId, "calibrationId");
  const reason = nullableNonEmptyString(value.reason, "reason");
  let normalizedValue = finiteOrNull(value.value, "value");

  if (value.state === "measured") {
    if (normalizedValue === null) throw new TypeError("measured value must not be null");
    if (reason !== null) throw new TypeError("measured reason must be null");
  } else if (value.state === "unmeasurable") {
    if (normalizedValue !== null) throw new TypeError("unmeasurable value must be null");
    if (reason === null) throw new TypeError("unmeasurable reason is required");
    normalizedValue = null;
  }

  return Object.freeze({
    metric,
    state: value.state,
    value: normalizedValue,
    unit,
    calibrationId,
    reason
  });
}
