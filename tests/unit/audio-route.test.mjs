import test from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_ROUTE,
  isKnownRoute,
  resolveInputRoute,
  resolveOutputRoute,
  inspectTrackProcessing,
  createRouteTarget
} from "../../core/audio-route.js";

test("isKnownRoute identifies valid routes and rejects unknown/empty", () => {
  assert.equal(isKnownRoute("mic-123"), true);
  assert.equal(isKnownRoute(""), false);
  assert.equal(isKnownRoute("   "), false);
  assert.equal(isKnownRoute("unknown"), false);
  assert.equal(isKnownRoute(UNKNOWN_ROUTE), false);
  assert.equal(isKnownRoute(null), false);
});

test("resolveInputRoute extracts track deviceId and ignores labels", () => {
  const track = {
    getSettings() {
      return { deviceId: "input-hardware-456", label: "Built-in Microphone" };
    }
  };
  assert.equal(resolveInputRoute(track), "input-hardware-456");

  const noIdTrack = {
    getSettings() {
      return { label: "USB Microphone" };
    }
  };
  assert.equal(resolveInputRoute(noIdTrack), UNKNOWN_ROUTE);
  assert.equal(resolveInputRoute(null), UNKNOWN_ROUTE);
});

test("resolveOutputRoute requires explicit sinkId and treats default as unknown", () => {
  const explicitContext = { sinkId: "sink-device-789" };
  assert.equal(resolveOutputRoute(explicitContext), "sink-device-789");

  const defaultContext = { sinkId: "" };
  assert.equal(resolveOutputRoute(defaultContext), UNKNOWN_ROUTE);

  const unsupportedContext = {};
  assert.equal(resolveOutputRoute(unsupportedContext), UNKNOWN_ROUTE);
  assert.equal(resolveOutputRoute(null), UNKNOWN_ROUTE);
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
