import test from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_ROUTE,
  isKnownRoute,
  resolveInputRoute,
  resolveOutputRoute,
  selectOutputRoute,
  restoreOutputRoute,
  inspectTrackProcessing,
  createRouteTarget
} from "../../core/audio-route.js";

test("isKnownRoute identifies explicit routes and rejects shared/default tokens", () => {
  assert.equal(isKnownRoute("mic-123"), true);
  assert.equal(isKnownRoute(""), false);
  assert.equal(isKnownRoute("   "), false);
  assert.equal(isKnownRoute("unknown"), false);
  assert.equal(isKnownRoute("default"), false);
  assert.equal(isKnownRoute("default-output"), false);
  assert.equal(isKnownRoute(UNKNOWN_ROUTE), false);
  assert.equal(isKnownRoute(null), false);
});

test("resolveInputRoute identifies deviceId and handles missing settings", () => {
  const track = {
    getSettings() {
      return { deviceId: "input-device-456" };
    }
  };
  assert.equal(resolveInputRoute(track), "input-device-456");

  const emptyTrack = {
    getSettings() {
      return { deviceId: "" };
    }
  };
  assert.equal(resolveInputRoute(emptyTrack), UNKNOWN_ROUTE);

  const defaultTrack = {
    getSettings() {
      return { deviceId: "default" };
    }
  };
  assert.equal(resolveInputRoute(defaultTrack), UNKNOWN_ROUTE);

  const noIdTrack = {
    getSettings() {
      return { label: "USB Microphone" };
    }
  };
  assert.equal(resolveInputRoute(noIdTrack), UNKNOWN_ROUTE);
  assert.equal(resolveInputRoute(null), UNKNOWN_ROUTE);
});

test("resolveOutputRoute resolves explicit sinkId and rejects default or unverified outputs", () => {
  const explicitContext = { sinkId: "sink-device-789" };
  assert.equal(resolveOutputRoute(explicitContext), "sink-device-789");
  assert.equal(isKnownRoute(resolveOutputRoute(explicitContext)), true);

  assert.equal(resolveOutputRoute({ sinkId: "" }), UNKNOWN_ROUTE);
  assert.equal(resolveOutputRoute({ sinkId: "default" }), UNKNOWN_ROUTE);
  assert.equal(resolveOutputRoute({ sinkId: "default-output" }), UNKNOWN_ROUTE);
  assert.equal(resolveOutputRoute({ sinkId: { deviceId: "custom-speaker" } }), "custom-speaker");
  assert.equal(resolveOutputRoute({ sinkId: { deviceId: "" } }), UNKNOWN_ROUTE);
  assert.equal(resolveOutputRoute({ sinkId: { deviceId: "default" } }), UNKNOWN_ROUTE);
  assert.equal(resolveOutputRoute({ destination: {} }), UNKNOWN_ROUTE);
  assert.equal(resolveOutputRoute({}), UNKNOWN_ROUTE);
  assert.equal(resolveOutputRoute(null), UNKNOWN_ROUTE);
});

test("selectOutputRoute applies the exact device selected by the browser", async () => {
  const calls = [];
  const audioContext = {
    sinkId: "",
    async setSinkId(deviceId) {
      calls.push(deviceId);
      this.sinkId = deviceId;
    }
  };
  const mediaDevices = {
    async selectAudioOutput(options) {
      assert.deepEqual(options, { deviceId: "previous-speaker" });
      return {
        kind: "audiooutput",
        deviceId: "physical-speaker-123",
        label: "USB DAC"
      };
    }
  };

  const result = await selectOutputRoute({
    audioContext,
    mediaDevices,
    preferredOutputRoute: "previous-speaker"
  });

  assert.deepEqual(result, { outputRoute: "physical-speaker-123" });
  assert.deepEqual(calls, ["physical-speaker-123"]);
  assert.equal(resolveOutputRoute(audioContext), "physical-speaker-123");
});

test("selectOutputRoute never promotes default, missing, unsupported, or rejected output identity", async () => {
  const audioContext = {
    sinkId: "",
    async setSinkId(deviceId) {
      this.sinkId = deviceId;
    }
  };

  const defaultResult = await selectOutputRoute({
    audioContext,
    mediaDevices: {
      async selectAudioOutput() {
        return { kind: "audiooutput", deviceId: "default" };
      }
    }
  });
  assert.equal(defaultResult.unmeasurable, true);
  assert.equal(defaultResult.outputRoute, UNKNOWN_ROUTE);

  const unsupported = await selectOutputRoute({
    audioContext,
    mediaDevices: {}
  });
  assert.equal(unsupported.unmeasurable, true);
  assert.ok(unsupported.reason.includes("対応していない"));

  const denied = new DOMException("denied", "NotAllowedError");
  const rejected = await selectOutputRoute({
    audioContext,
    mediaDevices: {
      async selectAudioOutput() {
        throw denied;
      }
    }
  });
  assert.equal(rejected.unmeasurable, true);
  assert.ok(rejected.reason.includes("選択されなかった"));
});

test("restoreOutputRoute reidentifies the persisted device before applying it", async () => {
  const applied = [];
  const audioContext = {
    sinkId: "",
    async setSinkId(deviceId) {
      applied.push(deviceId);
      this.sinkId = deviceId;
    }
  };
  const mediaDevices = {
    async enumerateDevices() {
      return [
        { kind: "audioinput", deviceId: "mic-1" },
        { kind: "audiooutput", deviceId: "speaker-1" }
      ];
    }
  };

  assert.deepEqual(await restoreOutputRoute({
    audioContext,
    mediaDevices,
    outputRoute: "speaker-1"
  }), { outputRoute: "speaker-1" });
  assert.deepEqual(applied, ["speaker-1"]);

  assert.deepEqual(await restoreOutputRoute({
    audioContext,
    mediaDevices,
    outputRoute: "missing-speaker"
  }), { outputRoute: UNKNOWN_ROUTE });
  assert.deepEqual(applied, ["speaker-1"]);
});

test("inspectTrackProcessing verifies raw capture settings", () => {
  const rawTrack = {
    getSettings() {
      return { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    }
  };
  assert.deepEqual(inspectTrackProcessing(rawTrack), {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    rawCaptureVerified: true
  });

  const processedTrack = {
    getSettings() {
      return { echoCancellation: true, noiseSuppression: false, autoGainControl: false };
    }
  };
  assert.equal(inspectTrackProcessing(processedTrack).rawCaptureVerified, false);
});

test("createRouteTarget returns a frozen target object", () => {
  const target = createRouteTarget({
    pathKind: "roundTrip",
    inputRoute: "mic-1",
    outputRoute: "speaker-1"
  });
  assert.equal(target.pathKind, "roundTrip");
  assert.equal(target.environment.inputRoute, "mic-1");
  assert.equal(target.environment.outputRoute, "speaker-1");
  assert.equal(Object.isFrozen(target), true);
  assert.equal(Object.isFrozen(target.environment), true);
});

test("createRouteTarget preserves and freezes processing configuration", () => {
  const target = createRouteTarget({
    pathKind: "roundTrip",
    inputRoute: "mic-1",
    outputRoute: "speaker-1",
    processing: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      rawCaptureVerified: true
    }
  });
  assert.deepEqual(target.environment.processing, {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    rawCaptureVerified: true
  });
  assert.equal(Object.isFrozen(target.environment.processing), true);
});
