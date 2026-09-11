import test from "node:test";
import assert from "node:assert/strict";
import {
  PRACTICE_DB_NAME,
  PRACTICE_DB_VERSION,
  upgradePracticeDatabase,
  createPracticeStore
} from "../../core/practice-store.js";
import { SIGN_CONVENTION } from "../../core/calibration.js";

function createMockIndexedDB(initialStores = null) {
  const stores = new Map();
  if (initialStores) {
    for (const [name, store] of initialStores.entries()) {
      stores.set(name, {
        name,
        options: store.options,
        records: new Map(store.records)
      });
    }
  }

  const db = {
    version: initialStores ? 2 : 0,
    objectStoreNames: {
      contains(name) { return stores.has(name); },
      *[Symbol.iterator]() { yield* stores.keys(); }
    },
    createObjectStore(name, options) {
      const store = { name, options, records: new Map() };
      stores.set(name, store);
      return store;
    },
    transaction(storeNames, mode) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      let aborted = false;
      const tx = {
        mode,
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        abort() {
          aborted = true;
          queueMicrotask(() => {
            if (tx.onabort) tx.onabort();
          });
        },
        objectStore(name) {
          if (!names.includes(name) || !stores.has(name)) {
            throw new Error(`Store ${name} not in transaction`);
          }
          const backingStore = stores.get(name);
          const keyPath = backingStore.options?.keyPath ?? "id";

          return {
            get(key) {
              const req = { result: undefined, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (aborted) return;
                const rec = backingStore.records.get(key);
                req.result = rec !== undefined ? structuredClone(rec) : undefined;
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            },
            getAll() {
              const req = { result: [], onsuccess: null, onerror: null };
              queueMicrotask(() => {
                if (aborted) return;
                req.result = Array.from(backingStore.records.values()).map(v => structuredClone(v));
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            },
            add(value) {
              const key = value[keyPath];
              if (backingStore.records.has(key)) {
                throw new Error(`Key ${key} already exists`);
              }
              backingStore.records.set(key, structuredClone(value));
            },
            put(value) {
              const key = value[keyPath];
              backingStore.records.set(key, structuredClone(value));
            },
            delete(key) {
              backingStore.records.delete(key);
            }
          };
        }
      };

      queueMicrotask(() => {
        queueMicrotask(() => {
          if (!aborted && tx.oncomplete) {
            tx.oncomplete();
          }
        });
      });

      return tx;
    },
    close() {}
  };

  const indexedDB = {
    open(name, version) {
      const request = {
        result: db,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null
      };
      queueMicrotask(() => {
        if (db.version < version) {
          db.version = version;
          if (request.onupgradeneeded) request.onupgradeneeded();
        }
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
    _stores: stores
  };

  return indexedDB;
}

function sampleCalibration(overrides = {}) {
  const base = {
    id: "cal-sample-1",
    createdAt: "2026-09-06T12:00:00.000Z",
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

function sampleAttempt(overrides = {}) {
  const base = {
    id: "att-sample-1",
    phraseId: "phrase-001",
    date: "2026-09-05T13:00:00.000Z",
    conditions: {
      tempo: 80,
      start: 1,
      end: 2,
      assist: "memory",
      melody: false,
      countIn: 1,
      backing: ["bass"]
    },
    observed: {
      transportCompleted: true,
      completedLoops: 2,
      elapsedSec: 12
    },
    reported: {
      clean: true
    }
  };
  return {
    ...base,
    ...overrides,
    conditions: { ...base.conditions, ...(overrides.conditions ?? {}) },
    observed: { ...base.observed, ...(overrides.observed ?? {}) },
    reported: { ...base.reported, ...(overrides.reported ?? {}) }
  };
}

function deepFreeze(obj) {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") deepFreeze(value);
  }
  return obj;
}

test("PRACTICE_DB_VERSION is 3", () => {
  assert.equal(PRACTICE_DB_NAME, "guitar-phrase-practice");
  assert.equal(PRACTICE_DB_VERSION, 3);
});

test("migration from v1 to v3 preserves existing attempts and creates recordings and calibrations", () => {
  const legacyAttempt = { id: "legacy-att-1", phraseId: "phrase-1" };
  const attempts = {
    name: "attempts",
    options: { keyPath: "id" },
    records: new Map([[legacyAttempt.id, legacyAttempt]])
  };
  const stores = new Map([["attempts", attempts]]);
  const db = {
    objectStoreNames: {
      contains(name) { return stores.has(name); },
      *[Symbol.iterator]() { yield* stores.keys(); }
    },
    createObjectStore(name, options) {
      const store = { name, options, records: new Map() };
      stores.set(name, store);
      return store;
    }
  };

  upgradePracticeDatabase(db);
  assert.equal(stores.get("attempts"), attempts);
  assert.deepEqual(stores.get("attempts").records.get("legacy-att-1"), legacyAttempt);
  assert.equal(stores.get("recordings").options.keyPath, "attemptId");
  assert.equal(stores.get("calibrations").options.keyPath, "id");
  assert.equal(stores.size, 3);
});

test("migration from v2 to v3 preserves attempts and recordings and creates calibrations", () => {
  const attempts = {
    name: "attempts",
    options: { keyPath: "id" },
    records: new Map([["att-v2", { id: "att-v2" }]])
  };
  const recordings = {
    name: "recordings",
    options: { keyPath: "attemptId" },
    records: new Map([["att-v2", { attemptId: "att-v2", size: 1024 }]])
  };
  const stores = new Map([["attempts", attempts], ["recordings", recordings]]);
  const db = {
    objectStoreNames: {
      contains(name) { return stores.has(name); },
      *[Symbol.iterator]() { yield* stores.keys(); }
    },
    createObjectStore(name, options) {
      const store = { name, options, records: new Map() };
      stores.set(name, store);
      return store;
    }
  };

  upgradePracticeDatabase(db);
  assert.equal(stores.get("attempts"), attempts);
  assert.equal(stores.get("recordings"), recordings);
  assert.equal(stores.get("calibrations").options.keyPath, "id");
  assert.equal(stores.size, 3);

  // Subsequent call is idempotent
  upgradePracticeDatabase(db);
  assert.equal(stores.size, 3);
});

test("calibration CRUD operations in createPracticeStore with mock IndexedDB", async () => {
  const idb = createMockIndexedDB();
  const store = createPracticeStore(idb);

  // Initially empty
  const initialList = await store.allCalibrations();
  assert.deepEqual(initialList, []);

  // Not found returns null
  const notFound = await store.calibration("cal-sample-1");
  assert.equal(notFound, null);

  // Save calibration
  const cal1 = sampleCalibration({ id: "cal-sample-1", offsetMs: 35.0 });
  const saved = await store.saveCalibration(cal1);
  assert.equal(saved.id, "cal-sample-1");
  assert.equal(saved.offsetMs, 35.0);
  assert.ok(Object.isFrozen(saved));

  // Retrieve by id
  const fetched = await store.calibration("cal-sample-1");
  assert.equal(fetched.id, "cal-sample-1");
  assert.equal(fetched.offsetMs, 35.0);
  assert.ok(Object.isFrozen(fetched));

  // Save second calibration
  const cal2 = sampleCalibration({ id: "cal-sample-2", offsetMs: 48.2 });
  await store.saveCalibration(cal2);

  // allCalibrations returns all records
  const allList = await store.allCalibrations();
  assert.equal(allList.length, 2);
  assert.deepEqual(allList.map(c => c.id).sort(), ["cal-sample-1", "cal-sample-2"]);

  // Update calibration (e.g. invalidate)
  const updated = sampleCalibration({
    id: "cal-sample-1",
    offsetMs: 35.0,
    validity: { invalidatedAt: "2026-09-07T00:00:00.000Z", reason: "mic changed" }
  });
  await store.saveCalibration(updated);
  const reFetched = await store.calibration("cal-sample-1");
  assert.equal(reFetched.validity.invalidatedAt, "2026-09-07T00:00:00.000Z");
  assert.equal(reFetched.validity.reason, "mic changed");

  // Delete calibration
  await store.deleteCalibration("cal-sample-1");
  const afterDelete = await store.calibration("cal-sample-1");
  assert.equal(afterDelete, null);

  const remaining = await store.allCalibrations();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, "cal-sample-2");
});

test("invalid calibration records are rejected before storage and leave store clean", async () => {
  const idb = createMockIndexedDB();
  const store = createPracticeStore(idb);

  // Invalid sampleCount
  await assert.rejects(
    async () => store.saveCalibration(sampleCalibration({ sampleCount: 0 })),
    { name: "RangeError" }
  );

  // Invalid signConvention
  await assert.rejects(
    async () => store.saveCalibration(sampleCalibration({ signConvention: "reference-minus-observed" })),
    { name: "TypeError" }
  );

  // Negative spreadMs
  await assert.rejects(
    async () => store.saveCalibration(sampleCalibration({ precision: { spreadMs: -1, method: "stddev" } })),
    { name: "RangeError" }
  );

  // Unknown fields
  await assert.rejects(
    async () => store.saveCalibration({ ...sampleCalibration(), unexpectedField: "hack" }),
    { name: "TypeError" }
  );

  // Not an object
  await assert.rejects(
    async () => store.saveCalibration("invalid"),
    { name: "TypeError" }
  );

  // Store must remain completely empty
  const calibrations = await store.allCalibrations();
  assert.equal(calibrations.length, 0);
});

test("legacy attempts remain without measured values and are never mutated", async () => {
  const idb = createMockIndexedDB();
  const store = createPracticeStore(idb);

  const rawLegacy = sampleAttempt({
    id: "att-legacy-1",
    conditions: { focusMode: undefined }
  });

  // Deeply freeze the input object to guarantee it is never mutated
  deepFreeze(rawLegacy);

  const saved = await store.saveAttempt(rawLegacy);
  assert.equal(saved.id, "att-legacy-1");
  assert.equal(saved.conditions.focusMode, "integrated");
  assert.equal(saved.assessment.basis, "reported");
  assert.equal("measured" in saved, false);
  assert.equal(saved.measured, undefined);

  // Raw input was not mutated
  assert.equal(rawLegacy.conditions.focusMode, undefined);
  assert.equal("assessment" in rawLegacy, false);
  assert.equal("measured" in rawLegacy, false);

  // When retrieved via all(), measured values are not present
  const retrieved = await store.all();
  assert.equal(retrieved.length, 1);
  assert.equal(retrieved[0].id, "att-legacy-1");
  assert.equal(retrieved[0].assessment.basis, "reported");
  assert.equal("measured" in retrieved[0], false);
  assert.equal(retrieved[0].measured, undefined);

  // Attempt with foreign measured field injected in database is sanitized without mutation
  const foreignAttempt = {
    ...sampleAttempt({ id: "att-foreign" }),
    measured: { latencyMs: 50, metric: "unauthorized" }
  };
  deepFreeze(foreignAttempt);

  idb._stores.get("attempts").records.set(foreignAttempt.id, foreignAttempt);

  const allRecords = await store.all();
  const loadedForeign = allRecords.find(r => r.id === "att-foreign");
  assert.ok(loadedForeign);
  assert.equal("measured" in loadedForeign, false);
  assert.equal(loadedForeign.assessment.basis, "reported");
  // Original DB record object was not mutated
  assert.equal(foreignAttempt.measured.latencyMs, 50);
});
