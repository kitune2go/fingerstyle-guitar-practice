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
    throw new TypeError(`${name}は空でない文字列である必要があります`);
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
    throw new TypeError(`${name}は有限の数値またはnullである必要があります`);
  }
  return value;
}

export function validateMeasurementResult(value) {
  if (!isPlainObject(value)) throw new TypeError("測定結果はオブジェクトである必要があります");
  for (const key of Object.keys(value)) {
    if (!RESULT_KEYS.has(key)) throw new TypeError(`measurement.${key}はサポートされていません`);
  }
  if (!MEASUREMENT_STATES.includes(value.state)) {
    throw new TypeError("measurement stateはサポートされていません");
  }
  if (!("value" in value)) throw new TypeError("valueが必要です");

  const metric = requireNonEmptyString(value.metric, "metric");
  const unit = requireNonEmptyString(value.unit, "unit");
  const calibrationId = nullableNonEmptyString(value.calibrationId, "calibrationId");
  const reason = nullableNonEmptyString(value.reason, "reason");
  let normalizedValue = finiteOrNull(value.value, "value");

  if (value.state === "measured") {
    if (normalizedValue === null) throw new TypeError("measuredの場合valueをnullにすることはできません");
    if (reason !== null) throw new TypeError("measuredの場合reasonはnullである必要があります");
  } else if (value.state === "unmeasurable") {
    if (normalizedValue !== null) throw new TypeError("unmeasurableの場合valueはnullである必要があります");
    if (reason === null) throw new TypeError("unmeasurableの場合reasonが必要です");
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
