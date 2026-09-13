import test from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_ROUTE,
  DEFAULT_OUTPUT_ROUTE,
  isKnownRoute,
  resolveInputRoute,
  resolveOutputRoute,
  inspectTrackProcessing,
  createRouteTarget
} from "../../core/audio-route.js";

test("isKnownRoute identifies valid routes and rejects unknown/empty", () => {
  assert.equal(isKnownRoute("mic-123"), true);
  assert.equal(isKnownRoute(DEFAULT_OUTPUT_ROUTE), true);
  assert.equal(isKnownRoute(""), false);
  assert.equal(isKnownRoute("   "), false);
  assert.equal(isKnownRoute("unknown"), false);
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

  const noIdTrack = {
    getSettings() {
      return { label: "USB Microphone" };
    }
  };
  assert.equal(resolveInputRoute(noIdTrack), UNKNOWN_ROUTE);
  assert.equal(resolveInputRoute(null), UNKNOWN_ROUTE);
});

test("resolveOutputRoute resolves explicit sinkId and returns UNKNOWN_ROUTE for default or unverified outputs", () => {
  const explicitContext = { sinkId: "sink-device-789" };
  assert.equal(resolveOutputRoute(explicitContext), "sink-device-789");
  assert.equal(isKnownRoute(resolveOutputRoute(explicitContext)), true);

  // Default / empty sinkId cannot verify physical output device identity across changes
  const defaultContext = { sinkId: "" };
  assert.equal(resolveOutputRoute(defaultContext), UNKNOWN_ROUTE);
  assert.equal(isKnownRoute(resolveOutputRoute(defaultContext)), false);

  const defaultNamedContext = { sinkId: "default" };
  assert.equal(resolveOutputRoute(defaultNamedContext), UNKNOWN_ROUTE);

  const sinkObjectContext = { sinkId: { deviceId: "custom-speaker" } };
  assert.equal(resolveOutputRoute(sinkObjectContext), "custom-speaker");

  const defaultSinkObjectContext = { sinkId: { deviceId: "" } };
  assert.equal(resolveOutputRoute(defaultSinkObjectContext), UNKNOWN_ROUTE);

  const defaultNamedSinkObjectContext = { sinkId: { deviceId: "default" } };
  assert.equal(resolveOutputRoute(defaultNamedSinkObjectContext), UNKNOWN_ROUTE);

  // Missing sinkId / destination fallback cannot verify physical device
  const destinationContext = { destination: {} };
  assert.equal(resolveOutputRoute(destinationContext), UNKNOWN_ROUTE);

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
