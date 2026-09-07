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

round-trip calibrationで直接得たoffsetを、**独立した測定根拠なしに input latency と output latency へ分解してはなりません。**
round-tripの観測値には output path / acoustic path / input path / detector delay 等が含まれ得るため、単一のround-trip観測だけでは各成分を識別できません。

したがって、`roundTrip` calibration recordを `input` targetまたは `output` targetへ代用適用してはなりません。同じ `pathKind` のtargetにだけ適用します。
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
- [x] `pathKind` を実装した
- [x] calibration schemaを実装した
- [x] calibration validationを実装した
- [x] offsetのsign conventionを固定した
- [x] calibration applicabilityを実装した
- [x] calibration quality evaluationを実装した
- [x] measurement result schema / validationを実装した
- [x] unit testsを追加した
- [ ] calibration persistenceを実装する
- [ ] IndexedDB migrationを実装する
- [ ] calibration UIを実装する
- [ ] browser calibration flowを実装する
- [ ] E2E integrationを追加する
- [ ] Phase 4B用PRを作成する
- [ ] GitHub Actionsをgreenにする
- [ ] `main` へマージする
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

export const SIGN_CONVENTION = "observed-minus-reference";
export const MIN_CALIBRATION_SAMPLES = 5;
export const MAX_CALIBRATION_SPREAD_MS = 20;

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
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function requireDateString(value, name) {
  requireNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be a valid date`);
  return value;
}

function normalizePathKind(value) {
  if (!CALIBRATION_PATH_KINDS.includes(value)) throw new TypeError("pathKind is not supported");
  return value;
}

function normalizeStatus(value) {
  if (!CALIBRATION_STATUSES.includes(value)) throw new TypeError("status is not supported");
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
  if (!Number.isInteger(object.sampleCount) || object.sampleCount < 1) {
    throw new RangeError("sampleCount must be an integer >= 1");
  }
  if (object.signConvention !== SIGN_CONVENTION) {
    throw new TypeError(`signConvention must be ${SIGN_CONVENTION}`);
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

export function calibrationApplies(record, target) {
  const normalizedRecord = validateCalibrationRecord(record);
  const normalizedTarget = validateCalibrationTarget(target);
  if (normalizedRecord.status !== "calibrated") return false;
  if (evaluateCalibrationQuality(normalizedRecord) !== "calibrated") return false;
  if (normalizedRecord.validity.invalidatedAt !== null) return false;
  if (normalizedRecord.pathKind !== normalizedTarget.pathKind) return false;
  if (normalizedRecord.timebase.reference !== normalizedTarget.timebase.reference) return false;
  if (normalizedRecord.timebase.observed !== normalizedTarget.timebase.observed) return false;
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
  const patterns = [
    /\\b(?:import|export)\\s+(?:[^"'()]*?\\s+from\\s+)?(["'])([^"']+)\\1/g,
    /\\bimport\\s*\\(\\s*(["'])([^"']+)\\1\\s*\\)/g
  ];
  for (const pattern of patterns) {
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
old = '''    for (const ref of referencesInHtml(read(page), page)) {
      if (!shell.has(ref)) errors.push(`sw.js: ${page} が読み込む ${ref} がAPP_SHELLにありません`);
      if (ref.endsWith(".css")) stylesheets.add(ref);
    }
'''
new = '''    for (const ref of referencesInHtml(read(page), page)) {
      if (!shell.has(ref)) errors.push(`sw.js: ${page} が読み込む ${ref} がAPP_SHELLにありません`);
      if (ref.endsWith(".css")) stylesheets.add(ref);
      if (ref.endsWith(".js")) scripts.add(ref);
    }
'''
if old not in s:
    raise SystemExit('HTML reference loop not found')
s = s.replace(old, new, 1)
old_modules = '''  // Modules imported below the page entry points are invisible to HTML
  // attributes, so every shipped module in both shared and rhythm namespaces
  // must be checked recursively.
  for (const directory of ["core", "rhythm"]) {
    for (const file of filesBelow(root, directory, (name) => name.endsWith(".js"))) {
      if (!shell.has(file)) errors.push(`sw.js: ${file} がAPP_SHELLにありません`);
    }
  }
'''
new_modules = '''  // Only modules reachable from a page entry are runtime assets. Pure core
  // modules used by Node tests do not belong in the offline shell until a
  // browser entry imports them.
  const pendingScripts = [...scripts];
  const visitedScripts = new Set();
  while (pendingScripts.length) {
    const file = pendingScripts.pop();
    if (visitedScripts.has(file)) continue;
    visitedScripts.add(file);
    if (!fs.existsSync(path.join(root, file))) continue;
    for (const ref of referencesInJs(read(file), file)) {
      if (!ref.endsWith(".js")) continue;
      if (!shell.has(ref)) errors.push(`sw.js: ${file} が読み込む ${ref} がAPP_SHELLにありません`);
      if (!visitedScripts.has(ref)) pendingScripts.push(ref);
    }
  }
'''
if old_modules not in s:
    raise SystemExit('module scan block not found')
s = s.replace(old_modules, new_modules, 1)
p.write_text(s)
PY

python - <<'PY'
from pathlib import Path
p = Path('tests/unit/validate-shell.test.mjs')
s = p.read_text()
s = s.replace(
'function fixture({ shell, files = [], core = [], rhythm = [], audio = [], html = "", css = "" }) {',
'function fixture({ shell, files = [], core = [], rhythm = [], audio = [], html = "", css = "", appJs = "" }) {'
)
s = s.replace('  fs.writeFileSync(path.join(root, "app.css"), css);\n', '  fs.writeFileSync(path.join(root, "app.css"), css);\n  fs.writeFileSync(path.join(root, "app.js"), appJs);\n', 1)
old_core = '''    for (const file of core) {
      const target = path.join(root, "core", file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "");
    }
'''
new_core = '''    for (const entry of core) {
      const file = typeof entry === "string" ? entry : entry.path;
      const target = path.join(root, "core", file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof entry === "string" ? "" : entry.content ?? "");
    }
'''
s = s.replace(old_core, new_core, 1)
old_rhythm = '''    for (const file of rhythm) {
      const target = path.join(root, "rhythm", file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "");
    }
'''
new_rhythm = '''    for (const entry of rhythm) {
      const file = typeof entry === "string" ? entry : entry.path;
      const target = path.join(root, "rhythm", file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof entry === "string" ? "" : entry.content ?? "");
    }
'''
s = s.replace(old_rhythm, new_rhythm, 1)
start = s.index('test("a core module missing from the shell is reported"')
end = s.index('test("an audio sample missing from the shell is reported"')
replacement = '''test("an unreferenced pure core module does not require a shell entry", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE, files: PRESENT, core: ["calibration.js"]
  }));
  assert.deepEqual(errors, []);
});

test("a runtime-imported core module missing from the shell is reported", () => {
  const { errors } = checkShell(fixture({
    shell: COMPLETE,
    files: PRESENT,
    core: ["music.js"],
    appJs: 'import "./core/music.js";'
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /core\\/music\\.js/);
});

test("core modules present in the shell pass", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./core/music.js"],
    files: PRESENT,
    core: ["music.js"],
    appJs: 'import "./core/music.js";'
  }));
  assert.deepEqual(errors, []);
});

test("nested runtime imports missing from the shell are reported recursively", () => {
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, "./core/audio/player.js"],
    files: PRESENT,
    core: [{ path: "audio/player.js", content: 'import "../../rhythm/views/orbit-view.js";' }],
    rhythm: ["views/orbit-view.js"],
    appJs: 'import "./core/audio/player.js";'
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /rhythm\\/views\\/orbit-view\\.js/);
});

test("nested core and rhythm modules present in the shell pass", () => {
  const modules = ["./core/audio/player.js", "./rhythm/views/orbit-view.js"];
  const { errors } = checkShell(fixture({
    shell: [...COMPLETE, ...modules],
    files: PRESENT,
    core: [{ path: "audio/player.js", content: 'import "../../rhythm/views/orbit-view.js";' }],
    rhythm: ["views/orbit-view.js"],
    appJs: 'import "./core/audio/player.js";'
  }));
  assert.deepEqual(errors, []);
});

'''
s = s[:start] + replacement + s[end:]
p.write_text(s)
PY

cat > tests/unit/calibration.test.mjs <<'EOF'
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
  invalidateCalibration
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
EOF

cat > tests/unit/measurement.test.mjs <<'EOF'
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
EOF

node --check core/calibration.js
node --check core/measurement.js
npm test
git diff --check "$START_HEAD"

npm install --no-package-lock
npx playwright install --with-deps chromium
npm run test:e2e

changes=$(git status --porcelain | grep -v '^?? _phase4b_core_helper/' || true)
if [[ -z "$changes" ]]; then
  echo "no implementation changes found" >&2
  exit 1
fi

git add docs/TASK-NEXT-MEASUREMENT-CALIBRATION.md \
  core/calibration.js core/measurement.js \
  scripts/validate-shell.mjs tests/unit/validate-shell.test.mjs \
  tests/unit/calibration.test.mjs tests/unit/measurement.test.mjs

git commit -m "Add calibration semantics core"
git diff --check "$START_HEAD"...HEAD

remaining=$(git status --porcelain | grep -v '^?? _phase4b_core_helper/' || true)
if [[ -n "$remaining" ]]; then
  echo "working tree is not clean after validation" >&2
  printf '%s\n' "$remaining" >&2
  exit 1
fi

git push origin "HEAD:$TARGET_BRANCH"
