export const CALIBRATION_PATH_KINDS = Object.freeze([
  "roundTrip",
  "input",
  "output"
]);

export const CALIBRATION_STATUSES = Object.freeze([
  "calibrated",
  "uncalibrated"
]);

export const PRECISION_METHODS = Object.freeze([
  "stddev"
]);

export const SIGN_CONVENTION = "observed-minus-reference";
export const MIN_CALIBRATION_SAMPLES = 5;
export const MAX_CALIBRATION_SPREAD_MS = 20;
export const MAX_CALIBRATION_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const RECORD_KEYS = new Set([
  "id", "createdAt", "pathKind", "timebase", "offsetMs", "signConvention",
  "sampleCount", "precision", "environment", "status", "validity"
]);
const TARGET_KEYS = new Set(["pathKind", "timebase", "environment"]);
const TIMEBASE_KEYS = new Set(["reference", "observed"]);
const PRECISION_KEYS = new Set(["spreadMs", "method"]);
const ENVIRONMENT_KEYS = new Set(["inputRoute", "outputRoute"]);
const VALIDITY_KEYS = new Set(["invalidatedAt", "reason"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name}はオブジェクトである必要があります`);
  return value;
}

function rejectUnknownKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name}.${key}はサポートされていません`);
  }
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

function requireFiniteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name}は有限の数値である必要があります`);
  }
  return value;
}

function requireDateString(value, name) {
  requireNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name}は有効な日時文字列である必要があります`);
  return value;
}

function normalizePathKind(value) {
  if (!CALIBRATION_PATH_KINDS.includes(value)) throw new TypeError("pathKindはサポートされていません");
  return value;
}

function normalizeStatus(value) {
  if (!CALIBRATION_STATUSES.includes(value)) throw new TypeError("statusはサポートされていません");
  return value;
}

function normalizeTimebase(value, name) {
  const object = requireObject(value, name);
  rejectUnknownKeys(object, TIMEBASE_KEYS, name);
  return Object.freeze({
    reference: requireNonEmptyString(object.reference, `${name}.reference`),
    observed: requireNonEmptyString(object.observed, `${name}.observed`)
  });
}

function normalizeEnvironment(value, name) {
  const object = requireObject(value, name);
  rejectUnknownKeys(object, ENVIRONMENT_KEYS, name);
  return Object.freeze({
    inputRoute: requireNonEmptyString(object.inputRoute, `${name}.inputRoute`),
    outputRoute: requireNonEmptyString(object.outputRoute, `${name}.outputRoute`)
  });
}

function normalizePrecision(value) {
  const object = requireObject(value, "precision");
  rejectUnknownKeys(object, PRECISION_KEYS, "precision");
  const spreadMs = requireFiniteNumber(object.spreadMs, "precision.spreadMs");
  if (spreadMs < 0) throw new RangeError("precision.spreadMsは0以上である必要があります");
  if (!PRECISION_METHODS.includes(object.method)) {
    throw new TypeError("precision.methodはサポートされていません");
  }
  return Object.freeze({ spreadMs, method: object.method });
}

function normalizeValidity(value) {
  const object = requireObject(value, "validity");
  rejectUnknownKeys(object, VALIDITY_KEYS, "validity");
  const invalidatedAt = object.invalidatedAt === null || object.invalidatedAt === undefined
    ? null
    : requireDateString(object.invalidatedAt, "validity.invalidatedAt");
  const reason = nullableNonEmptyString(object.reason, "validity.reason");
  if (invalidatedAt !== null && reason === null) {
    throw new TypeError("invalidatedAtが設定されている場合はvalidity.reasonが必須です");
  }
  return Object.freeze({ invalidatedAt, reason });
}

export function validateCalibrationRecord(value) {
  const object = requireObject(value, "calibration");
  rejectUnknownKeys(object, RECORD_KEYS, "calibration");
  if (!Number.isInteger(object.sampleCount) || object.sampleCount < 1) {
    throw new RangeError("sampleCountは1以上の整数である必要があります");
  }
  if (object.signConvention !== SIGN_CONVENTION) {
    throw new TypeError(`signConventionは${SIGN_CONVENTION}である必要があります`);
  }
  return Object.freeze({
    id: requireNonEmptyString(object.id, "id"),
    createdAt: requireDateString(object.createdAt, "createdAt"),
    pathKind: normalizePathKind(object.pathKind),
    timebase: normalizeTimebase(object.timebase, "timebase"),
    offsetMs: requireFiniteNumber(object.offsetMs, "offsetMs"),
    signConvention: SIGN_CONVENTION,
    sampleCount: object.sampleCount,
    precision: normalizePrecision(object.precision),
    environment: normalizeEnvironment(object.environment, "environment"),
    status: normalizeStatus(object.status),
    validity: normalizeValidity(object.validity)
  });
}

function validateCalibrationTarget(value) {
  const object = requireObject(value, "target");
  rejectUnknownKeys(object, TARGET_KEYS, "target");
  return Object.freeze({
    pathKind: normalizePathKind(object.pathKind),
    timebase: normalizeTimebase(object.timebase, "target.timebase"),
    environment: normalizeEnvironment(object.environment, "target.environment")
  });
}

export function extractSampleOffsetMs(sample) {
  if (typeof sample?.offsetMs === "number" && Number.isFinite(sample.offsetMs)) {
    if (sample.unit === "s") return sample.offsetMs * 1000;
    if (sample.unit === "ms" || sample.unit === undefined || sample.unit === null) return sample.offsetMs;
    throw new TypeError(`サポートされていないunitです: ${sample.unit}`);
  }
  const ref = sample?.referenceTime;
  const obs = sample?.observedTime;
  if (typeof ref !== "number" || !Number.isFinite(ref) || typeof obs !== "number" || !Number.isFinite(obs)) {
    throw new TypeError("測定サンプルには基準時刻と観測時刻が必要です。");
  }
  const diff = obs - ref; // SIGN_CONVENTION: observed - reference
  if (sample.unit === "s") return diff * 1000;
  if (sample.unit === "ms" || sample.unit === undefined || sample.unit === null) return diff;
  throw new TypeError(`サポートされていないunitです: ${sample.unit}`);
}

export function applyCalibrationOffset(observedTimeMs, offsetMs) {
  return requireFiniteNumber(observedTimeMs, "observedTimeMs")
    - requireFiniteNumber(offsetMs, "offsetMs");
}

export function evaluateCalibrationQuality(record) {
  const normalized = validateCalibrationRecord(record);
  return normalized.sampleCount >= MIN_CALIBRATION_SAMPLES
    && normalized.precision.spreadMs <= MAX_CALIBRATION_SPREAD_MS
    ? "calibrated"
    : "uncalibrated";
}

export function calibrationApplies(record, target, options = {}) {
  const normalizedRecord = validateCalibrationRecord(record);
  const normalizedTarget = validateCalibrationTarget(target);
  if (normalizedRecord.status !== "calibrated") return false;
  if (evaluateCalibrationQuality(normalizedRecord) !== "calibrated") return false;
  if (normalizedRecord.validity.invalidatedAt !== null) return false;

  const nowMs = typeof options.now === "number"
    ? options.now
    : (typeof options.now === "string" ? Date.parse(options.now) : Date.now());
  const maxAgeMs = typeof options.maxAgeMs === "number" ? options.maxAgeMs : MAX_CALIBRATION_AGE_MS;
  const createdAtMs = Date.parse(normalizedRecord.createdAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdAtMs)) return false;
  const ageMs = nowMs - createdAtMs;
  if (ageMs < 0 || ageMs > maxAgeMs) return false;

  if (normalizedRecord.pathKind !== normalizedTarget.pathKind) return false;
  if (normalizedRecord.timebase.reference !== normalizedTarget.timebase.reference) return false;
  if (normalizedRecord.timebase.observed !== normalizedTarget.timebase.observed) return false;
  if (normalizedRecord.environment.inputRoute === "unknown" || normalizedTarget.environment.inputRoute === "unknown") return false;
  if (normalizedRecord.environment.outputRoute === "unknown" || normalizedTarget.environment.outputRoute === "unknown") return false;
  if (normalizedRecord.environment.inputRoute !== normalizedTarget.environment.inputRoute) return false;
  if (normalizedRecord.environment.outputRoute !== normalizedTarget.environment.outputRoute) return false;
  return true;
}

export function invalidateCalibration(record, { at, reason }) {
  const normalized = validateCalibrationRecord(record);
  return validateCalibrationRecord({
    ...normalized,
    timebase: { ...normalized.timebase },
    precision: { ...normalized.precision },
    environment: { ...normalized.environment },
    validity: {
      invalidatedAt: requireDateString(at, "at"),
      reason: requireNonEmptyString(reason, "reason")
    }
  });
}
