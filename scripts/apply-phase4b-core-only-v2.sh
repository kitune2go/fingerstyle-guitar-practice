#!/usr/bin/env bash
set -euo pipefail

TARGET_BRANCH="feat/measurement-semantics-calibration"
START_HEAD="7f2c39e327b056f4236e3470fc2b7aa6d3dc1f9a"

if [[ "$(git rev-parse HEAD)" != "$START_HEAD" ]]; then
  echo "unexpected target head: $(git rev-parse HEAD)" >&2
  exit 1
fi

python - <<'PY'
from pathlib import Path
p = Path('docs/TASK-NEXT-MEASUREMENT-CALIBRATION.md')
s = p.read_text()
needle = "単一のoffsetを全デバイス・全入出力経路へ適用してはいけません。\n"
insert = """単一のoffsetを全デバイス・全入出力経路へ適用してはいけません。

#### round-trip calibrationの分解禁止

round-trip calibrationで直接得た値を、**独立した測定根拠なしに input latency / output latency へ分解してはなりません。**
round-trip値には output path / acoustic path / input path / detector delay 等が含まれ得るため、単一観測から各成分を識別できません。

したがって、`roundTrip = 50 ms` という観測から `output = 30 ms` / `input = 20 ms` のような値を作ってはいけません。
`roundTrip` calibration recordは `input` target / `output` targetへ代用適用してはならず、同じ `pathKind` の対象にだけ適用します。
"""
if needle not in s:
    raise SystemExit('round-trip insertion point not found')
s = s.replace(needle, insert, 1)
old = """- [ ] calibration schemaを実装する
- [ ] calibration acceptance testを追加する
- [ ] ブラウザでの校正フローを実装する
- [ ] Phase 4B用PRを作成する
"""
new = """- [x] roundTrip分解禁止を明記した
- [x] calibration schemaを実装した
- [x] `pathKind` を実装した
- [x] offsetのsign conventionを固定した
- [x] calibration validationを実装した
- [x] calibration applicabilityを実装した
- [x] calibration quality判定を実装した
- [x] measurement result schema / validationを実装した
- [x] calibration / measurement unit testを追加した
- [ ] calibration persistenceを実装する
- [ ] IndexedDB migrationを実装する
- [ ] ブラウザでのcalibration UI / flowを実装する
- [ ] E2Eを追加する
- [ ] Phase 4B用PRを作成する
- [ ] GitHub Actionsをgreenにする
"""
if old not in s:
    raise SystemExit('acceptance checklist block not found')
s = s.replace(old, new, 1)
p.write_text(s)
PY

cat > core/calibration.js <<'EOF'
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

export const CALIBRATION_SIGN_CONVENTION = "observed-minus-reference";
export const MIN_CALIBRATION_SAMPLES = 5;
export const MAX_CALIBRATION_SPREAD_MS = 20;

const RECORD_KEYS = new Set([
  "id", "createdAt", "pathKind", "timebase", "offsetMs", "signConvention",
  "sampleCount", "precision", "environment", "status", "validity"
]);
const TIMEBASE_KEYS = new Set(["reference", "observed"]);
const PRECISION_KEYS = new Set(["spreadMs", "method"]);
const ENVIRONMENT_KEYS = new Set(["inputRoute", "outputRoute"]);
const VALIDITY_KEYS = new Set(["invalidatedAt", "reason"]);
const TARGET_KEYS = new Set(["pathKind", "timebase", "environment"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, name) {
  if (!isPlainObject(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function rejectUnknownKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name}.${key} is not supported`);
  }
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

function requireFiniteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return value;
}

function requireDateString(value, name) {
  requireNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be a valid date`);
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

function normalizeEnvironment(value, pathKind, name) {
  const object = requireObject(value, name);
  rejectUnknownKeys(object, ENVIRONMENT_KEYS, name);
  const environment = {
    inputRoute: nullableNonEmptyString(object.inputRoute, `${name}.inputRoute`),
    outputRoute: nullableNonEmptyString(object.outputRoute, `${name}.outputRoute`)
  };
  if ((pathKind === "input" || pathKind === "roundTrip") && environment.inputRoute === null) {
    throw new TypeError(`${name}.inputRoute is required for ${pathKind}`);
  }
  if ((pathKind === "output" || pathKind === "roundTrip") && environment.outputRoute === null) {
    throw new TypeError(`${name}.outputRoute is required for ${pathKind}`);
  }
  return Object.freeze(environment);
}

function normalizePathKind(value) {
  if (!CALIBRATION_PATH_KINDS.includes(value)) throw new TypeError("pathKind is not supported");
  return value;
}

function normalizeStatus(value) {
  if (!CALIBRATION_STATUSES.includes(value)) throw new TypeError("status is not supported");
  return value;
}

function normalizePrecision(value) {
  const object = requireObject(value, "precision");
  rejectUnknownKeys(object, PRECISION_KEYS, "precision");
  const spreadMs = requireFiniteNumber(object.spreadMs, "precision.spreadMs");
  if (spreadMs < 0) throw new RangeError("precision.spreadMs must be non-negative");
  if (!PRECISION_METHODS.includes(object.method)) {
    throw new TypeError("precision.method is not supported");
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
    throw new TypeError("validity.reason is required when invalidatedAt is set");
  }
  return Object.freeze({ invalidatedAt, reason });
}

export function validateCalibrationRecord(value) {
  const object = requireObject(value, "calibration");
  rejectUnknownKeys(object, RECORD_KEYS, "calibration");
  const pathKind = normalizePathKind(object.pathKind);
  if (!Number.isInteger(object.sampleCount) || object.sampleCount < 1) {
    throw new RangeError("sampleCount must be an integer >= 1");
  }
  if (object.signConvention !== CALIBRATION_SIGN_CONVENTION) {
    throw new TypeError(`signConvention must be ${CALIBRATION_SIGN_CONVENTION}`);
  }
  return Object.freeze({
    id: requireNonEmptyString(object.id, "id"),
    createdAt: requireDateString(object.createdAt, "createdAt"),
    pathKind,
    timebase: normalizeTimebase(object.timebase, "timebase"),
    offsetMs: requireFiniteNumber(object.offsetMs, "offsetMs"),
    signConvention: CALIBRATION_SIGN_CONVENTION,
    sampleCount: object.sampleCount,
    precision: normalizePrecision(object.precision),
    environment: normalizeEnvironment(object.environment, pathKind, "environment"),
    status: normalizeStatus(object.status),
    validity: normalizeValidity(object.validity)
  });
}

export function applyCalibrationOffset(observedTimeMs, offsetMs) {
  return requireFiniteNumber(observedTimeMs, "observedTimeMs")
    - requireFiniteNumber(offsetMs, "offsetMs");
}

function validateCalibrationTarget(value) {
  const object = requireObject(value, "target");
  rejectUnknownKeys(object, TARGET_KEYS, "target");
  const pathKind = normalizePathKind(object.pathKind);
  return Object.freeze({
    pathKind,
    timebase: normalizeTimebase(object.timebase, "target.timebase"),
    environment: normalizeEnvironment(object.environment, pathKind, "target.environment")
  });
}

function sameTimebase(left, right) {
  return left.reference === right.reference && left.observed === right.observed;
}

function sameRequiredRoutes(pathKind, left, right) {
  if (pathKind === "input") return left.inputRoute === right.inputRoute;
  if (pathKind === "output") return left.outputRoute === right.outputRoute;
  return left.inputRoute === right.inputRoute && left.outputRoute === right.outputRoute;
}

export function evaluateCalibrationQuality(record, options = {}) {
  const normalized = validateCalibrationRecord(record);
  const minimumSamples = options.minimumSamples ?? MIN_CALIBRATION_SAMPLES;
  const maximumSpreadMs = options.maximumSpreadMs ?? MAX_CALIBRATION_SPREAD_MS;
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1) {
    throw new RangeError("minimumSamples must be an integer >= 1");
  }
  requireFiniteNumber(maximumSpreadMs, "maximumSpreadMs");
  if (maximumSpreadMs < 0) throw new RangeError("maximumSpreadMs must be non-negative");
  return normalized.sampleCount >= minimumSamples && normalized.precision.spreadMs <= maximumSpreadMs
    ? "calibrated"
    : "uncalibrated";
}

export function calibrationApplies(record, target) {
  const normalizedRecord = validateCalibrationRecord(record);
  const normalizedTarget = validateCalibrationTarget(target);
  if (normalizedRecord.status !== "calibrated") return false;
  if (evaluateCalibrationQuality(normalizedRecord) !== "calibrated") return false;
  if (normalizedRecord.validity.invalidatedAt !== null) return false;
  if (normalizedRecord.pathKind !== normalizedTarget.pathKind) return false;
  if (!sameTimebase(normalizedRecord.timebase, normalizedTarget.timebase)) return false;
  return sameRequiredRoutes(
    normalizedRecord.pathKind,
    normalizedRecord.environment,
    normalizedTarget.environment
  );
}
EOF

cat > core/measurement.js <<'EOF'
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
  const metric = requireNonEmptyString(value.metric, "metric");
  const unit = requireNonEmptyString(value.unit, "unit");
  const calibrationId = nullableNonEmptyString(value.calibrationId, "calibrationId");
  if (!("value" in value)) throw new TypeError("value is required");
  let normalizedValue = finiteOrNull(value.value, "value");
  const reason = nullableNonEmptyString(value.reason, "reason");

  if (value.state === "measured") {
    if (normalizedValue === null) throw new TypeError("measured value must not be null");
    if (reason !== null) throw new TypeError("measured reason must be null");
  } else if (value.state === "uncalibrated") {
    if (reason === null) throw new TypeError("uncalibrated reason is required");
  } else {
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
EOF

python - <<'PY'
from pathlib import Path
p = Path('scripts/validate-shell.mjs')
s = p.read_text()
needle = '''function referencesInCss(css, owner) {
  const found = new Set();
  for (const match of css.matchAll(/url\\(\\s*(?:(["'])(.*?)\\1|([^)]*))\\s*\\)/g)) {
    const reference = localReference(owner, match[2] ?? match[3]);
    if (reference !== null) found.add(reference);
  }
  return found;
}
'''
insert = needle + '''\nfunction referencesInJs(js, owner) {
  const found = new Set();
  const staticImport = /\\b(?:import|export)\\s+(?:[^"'()]*?\\s+from\\s+)?(["'])([^"']+)\\1/g;
  const dynamicImport = /\\bimport\\s*\\(\\s*(["'])([^"']+)\\1\\s*\\)/g;
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of js.matchAll(pattern)) {
      const reference = localReference(owner, match[2]);
      if (reference !== null) found.add(reference);
    }
  }
  return found;
}
'''
if needle not in s:
    raise SystemExit('referencesInCss block not found')
s = s.replace(needle, insert, 1)
s = s.replace('  const stylesheets = new Set();\n', '  const stylesheets = new Set();\n  const scripts = new Set();\n', 1)
s = s.replace('      if (ref.endsWith(".css")) stylesheets.add(ref);\n', '      if (ref.endsWith(".css")) stylesheets.add(ref);\n      if (ref.endsWith(".js")) scripts.add(ref);\n', 1)
old = '''  // Modules imported below the page entry points are invisible to HTML
  // attributes, so every shipped module in both shared and rhythm namespaces
  // must be checked recursively.
  for (const directory of ["core", "rhythm"]) {
    for (const file of filesBelow(root, directory, (name) => name.endsWith(".js"))) {
      if (!shell.has(file)) errors.push(`sw.js: ${file} がAPP_SHELLにありません`);
    }
  }
'''
new = '''  // Only modules reachable from page entry points are runtime assets. Pure
  // modules used exclusively by Node tests must not force a service-worker
  // cache bump before a browser entry point imports them.
  const visitedScripts = new Set();
  const pendingScripts = [...scripts];
  while (pendingScripts.length) {
    const owner = pendingScripts.shift();
    if (visitedScripts.has(owner)) continue;
    visitedScripts.add(owner);
    if (!fs.existsSync(path.join(root, owner))) continue;
    for (const ref of referencesInJs(read(owner), owner)) {
      if (!ref.endsWith(".js")) continue;
      if (!shell.has(ref)) errors.push(`sw.js: ${owner} が読み込む ${ref} がAPP_SHELLにありません`);
      if (!visitedScripts.has(ref)) pendingScripts.push(ref);
    }
  }
'''
if old not in s:
    raise SystemExit('blanket module scan block not found')
s = s.replace(old, new, 1)
p.write_text(s)
PY

python - <<'PY'
from pathlib import Path
p = Path('tests/unit/validate-shell.test.mjs')
s = p.read_text()
s = s.replace(
'function fixture({ shell, files = [], core = [], rhythm = [], audio = [], html = "", css = "" }) {',
'function fixture({ shell, files = [], core = [], rhythm = [], audio = [], html = "", css = "", js = "", moduleSources = {} }) {'
)
s = s.replace('  fs.writeFileSync(path.join(root, "app.css"), css);\n', '  fs.writeFileSync(path.join(root, "app.css"), css);\n  fs.writeFileSync(path.join(root, "app.js"), js);\n', 1)
anchor = '''  for (const file of audio) {
    const target = path.join(root, "assets/audio", file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "sample");
  }
'''
insert = anchor + '''  for (const [file, source] of Object.entries(moduleSources)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
'''
if anchor not in s:
    raise SystemExit('fixture audio block not found')
s = s.replace(anchor, insert, 1)
old = '''test("a core module missing from the shell is reported", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE, files: PRESENT, core: ["music.js", "clock.js"]
  }));
  assert.equal(errors.length, 2);
  assert.match(errors.join(" "), /core\\/music\\.js/);
  assert.match(errors.join(" "), /core\\/clock\\.js/);
});
'''
new = '''test("an unreferenced pure core module does not require a shell entry", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE, files: PRESENT, core: ["measurement.js"]
  }));
  assert.deepEqual(errors, []);
});

test("a runtime-imported core module missing from the shell is reported", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE,
    files: PRESENT,
    core: ["music.js"],
    js: 'import "./core/music.js";'
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /core\\/music\\.js/);
});
'''
if old not in s:
    raise SystemExit('core missing test block not found')
s = s.replace(old, new, 1)
old = '''test("nested rhythm modules missing from the shell are reported", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE,
    files: PRESENT,
    rhythm: ["pattern-model.js", "core/scheduler.js"]
  }));
  assert.equal(errors.length, 2);
  assert.match(errors.join(" "), /rhythm\\/pattern-model\\.js/);
  assert.match(errors.join(" "), /rhythm\\/core\\/scheduler\\.js/);
});
'''
new = '''test("nested runtime imports missing from the shell are reported recursively", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE,
    files: PRESENT,
    core: ["audio/player.js"],
    rhythm: ["views/orbit-view.js"],
    js: 'import "./core/audio/player.js";',
    moduleSources: {
      "core/audio/player.js": 'import "../../rhythm/views/orbit-view.js";'
    }
  }));
  assert.equal(errors.length, 2);
  assert.match(errors.join(" "), /core\\/audio\\/player\\.js/);
  assert.match(errors.join(" "), /rhythm\\/views\\/orbit-view\\.js/);
});
'''
if old not in s:
    raise SystemExit('nested rhythm test block not found')
s = s.replace(old, new, 1)
p.write_text(s)
PY

cat > tests/unit/calibration.test.mjs <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import * as calibrationModule from "../../core/calibration.js";
import * as measurementModule from "../../core/measurement.js";

const {
  applyCalibrationOffset,
  calibrationApplies,
  evaluateCalibrationQuality,
  validateCalibrationRecord
} = calibrationModule;
const { validateMeasurementResult } = measurementModule;

function calibration(overrides = {}) {
  return {
    id: "cal-1",
    createdAt: "2026-09-06T12:00:00.000Z",
    pathKind: "roundTrip",
    timebase: { reference: "audio-context", observed: "audio-context" },
    offsetMs: 42.5,
    signConvention: "observed-minus-reference",
    sampleCount: 8,
    precision: { spreadMs: 4.2, method: "stddev" },
    environment: { inputRoute: "built-in-mic", outputRoute: "built-in-speaker" },
    status: "calibrated",
    validity: { invalidatedAt: null, reason: null },
    ...overrides
  };
}

function target(pathKind, overrides = {}) {
  const environment = pathKind === "input"
    ? { inputRoute: "built-in-mic", outputRoute: null }
    : pathKind === "output"
      ? { inputRoute: null, outputRoute: "built-in-speaker" }
      : { inputRoute: "built-in-mic", outputRoute: "built-in-speaker" };
  return {
    pathKind,
    timebase: { reference: "audio-context", observed: "audio-context" },
    environment,
    ...overrides
  };
}

test("pathKind roundTrip is accepted", () => assert.equal(validateCalibrationRecord(calibration()).pathKind, "roundTrip"));
test("pathKind input is accepted", () => assert.equal(validateCalibrationRecord(calibration({ pathKind: "input", environment: { inputRoute: "built-in-mic", outputRoute: null } })).pathKind, "input"));
test("pathKind output is accepted", () => assert.equal(validateCalibrationRecord(calibration({ pathKind: "output", environment: { inputRoute: null, outputRoute: "built-in-speaker" } })).pathKind, "output"));
test("unknown pathKind is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ pathKind: "near-enough" }))));
test("empty id is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ id: "" }))));
test("non-string id is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ id: 1 }))));
test("invalid createdAt is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ createdAt: "not-a-date" }))));
test("wrong sign convention is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ signConvention: "reference-minus-observed" }))));
test("sampleCount below one is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ sampleCount: 0 }))));
test("fractional sampleCount is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ sampleCount: 2.5 }))));
test("unsupported precision method is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ precision: { spreadMs: 1, method: "mad" } }))));
test("empty reference timebase is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ timebase: { reference: "", observed: "audio-context" } }))));
test("empty observed timebase is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ timebase: { reference: "audio-context", observed: "" } }))));
test("unknown status is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ status: "measured" }))));
test("invalid invalidatedAt is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ validity: { invalidatedAt: "bad-date", reason: "route changed" } }))));
test("positive offset uses observed-minus-reference convention", () => assert.equal(applyCalibrationOffset(150, 50), 100));
test("negative offset uses the same sign convention", () => assert.equal(applyCalibrationOffset(100, -20), 120));
test("roundTrip calibration cannot apply to input target", () => assert.equal(calibrationApplies(calibration(), target("input")), false));
test("roundTrip calibration cannot apply to output target", () => assert.equal(calibrationApplies(calibration(), target("output")), false));
test("input calibration applies only to matching input target", () => {
  const record = calibration({ pathKind: "input", environment: { inputRoute: "built-in-mic", outputRoute: null } });
  assert.equal(calibrationApplies(record, target("input")), true);
  assert.equal(calibrationApplies(record, target("roundTrip")), false);
});
test("output calibration applies only to matching output target", () => {
  const record = calibration({ pathKind: "output", environment: { inputRoute: null, outputRoute: "built-in-speaker" } });
  assert.equal(calibrationApplies(record, target("output")), true);
  assert.equal(calibrationApplies(record, target("roundTrip")), false);
});
test("timebase mismatch is not applicable", () => assert.equal(calibrationApplies(calibration(), target("roundTrip", { timebase: { reference: "performance", observed: "audio-context" } })), false));
test("required route mismatch is not applicable", () => assert.equal(calibrationApplies(calibration(), target("roundTrip", { environment: { inputRoute: "usb-mic", outputRoute: "built-in-speaker" } })), false));
test("invalidated calibration is not applicable", () => assert.equal(calibrationApplies(calibration({ validity: { invalidatedAt: "2026-09-06T13:00:00.000Z", reason: "route changed" } }), target("roundTrip")), false));
test("uncalibrated record is not applicable", () => assert.equal(calibrationApplies(calibration({ status: "uncalibrated" }), target("roundTrip")), false));
test("insufficient sampleCount evaluates uncalibrated", () => assert.equal(evaluateCalibrationQuality(calibration({ sampleCount: 4 })), "uncalibrated"));
test("spread above threshold evaluates uncalibrated", () => assert.equal(evaluateCalibrationQuality(calibration({ precision: { spreadMs: 20.01, method: "stddev" } })), "uncalibrated"));
test("quality at thresholds evaluates calibrated", () => assert.equal(evaluateCalibrationQuality(calibration({ sampleCount: 5, precision: { spreadMs: 20, method: "stddev" }, status: "uncalibrated" })), "calibrated"));
test("NaN offset is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ offsetMs: Number.NaN }))));
test("Infinity offset is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ offsetMs: Number.POSITIVE_INFINITY }))));
test("negative precision spread is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ precision: { spreadMs: -1, method: "stddev" } }))));
test("non-finite precision spread is rejected", () => assert.throws(() => validateCalibrationRecord(calibration({ precision: { spreadMs: Number.POSITIVE_INFINITY, method: "stddev" } }))));
test("measured result is valid with a finite value", () => assert.equal(validateMeasurementResult({ metric: "onset-offset", state: "measured", value: 12.5, unit: "ms", calibrationId: "cal-1", reason: null }).value, 12.5));
test("uncalibrated result may retain a raw finite value", () => assert.equal(validateMeasurementResult({ metric: "onset-offset", state: "uncalibrated", value: 18, unit: "ms", calibrationId: null, reason: "matching calibration unavailable" }).value, 18));
test("unmeasurable result is valid only with null value", () => assert.equal(validateMeasurementResult({ metric: "onset-offset", state: "unmeasurable", value: null, unit: "ms", calibrationId: null, reason: "reference unavailable" }).value, null));
test("unmeasurable value zero is rejected", () => assert.throws(() => validateMeasurementResult({ metric: "onset-offset", state: "unmeasurable", value: 0, unit: "ms", calibrationId: null, reason: "reference unavailable" })));
test("unknown measurement state is rejected", () => assert.throws(() => validateMeasurementResult({ metric: "onset-offset", state: "observed", value: 1, unit: "ms", calibrationId: null, reason: null })));
test("measured null value is rejected", () => assert.throws(() => validateMeasurementResult({ metric: "onset-offset", state: "measured", value: null, unit: "ms", calibrationId: null, reason: null })));
test("measurement empty unit is rejected", () => assert.throws(() => validateMeasurementResult({ metric: "onset-offset", state: "measured", value: 1, unit: "", calibrationId: null, reason: null })));
test("uncalibrated requires a reason", () => assert.throws(() => validateMeasurementResult({ metric: "onset-offset", state: "uncalibrated", value: 1, unit: "ms", calibrationId: null, reason: null })));
test("measurement rejects non-finite values", () => assert.throws(() => validateMeasurementResult({ metric: "onset-offset", state: "measured", value: Number.POSITIVE_INFINITY, unit: "ms", calibrationId: null, reason: null })));
test("reported evidence has no promotion API to measured", () => {
  assert.equal("promoteReportedToMeasured" in measurementModule, false);
  assert.equal("measurementFromReported" in measurementModule, false);
});
test("observed evidence has no promotion API to measured", () => {
  assert.equal("promoteObservedToMeasured" in measurementModule, false);
  assert.equal("measurementFromObserved" in measurementModule, false);
});
test("validation clones and freezes nested calibration data", () => {
  const input = calibration();
  const validated = validateCalibrationRecord(input);
  input.environment.inputRoute = "changed";
  input.timebase.reference = "changed";
  assert.equal(validated.environment.inputRoute, "built-in-mic");
  assert.equal(validated.timebase.reference, "audio-context");
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.environment), true);
});
test("strict calibration validation rejects unknown fields", () => assert.throws(() => validateCalibrationRecord({ ...calibration(), guessedLatencyMs: 10 })));
EOF

node --check core/calibration.js
node --check core/measurement.js
npm test
git diff --check "$START_HEAD"

npm install --no-package-lock
npx playwright install --with-deps chromium
npm run test:e2e

# This subphase checkpoint is intentionally core-only: no persistence, IDB,
# browser calibration UI, runtime import, service-worker change, or PR.
git add docs/TASK-NEXT-MEASUREMENT-CALIBRATION.md \
  core/calibration.js core/measurement.js \
  scripts/validate-shell.mjs tests/unit/validate-shell.test.mjs \
  tests/unit/calibration.test.mjs
git commit -m "Define Phase 4B calibration data boundaries"

git diff --check "$START_HEAD"...HEAD
if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree is not clean after validation" >&2
  exit 1
fi

git push origin "HEAD:$TARGET_BRANCH"
