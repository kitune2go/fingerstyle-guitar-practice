export const UNKNOWN_ROUTE = "unknown";

export function isKnownRoute(route) {
  return typeof route === "string" && route.trim() !== "" && route !== UNKNOWN_ROUTE;
}

export function resolveInputRoute(track) {
  if (!track || typeof track.getSettings !== "function") return UNKNOWN_ROUTE;
  const settings = track.getSettings();
  const deviceId = typeof settings?.deviceId === "string" ? settings.deviceId.trim() : "";
  return deviceId !== "" ? deviceId : UNKNOWN_ROUTE;
}

export function resolveOutputRoute(audioContext) {
  if (!audioContext) return UNKNOWN_ROUTE;
  const sinkId = typeof audioContext.sinkId === "string" ? audioContext.sinkId.trim() : "";
  return sinkId !== "" ? sinkId : UNKNOWN_ROUTE;
}

export function inspectTrackProcessing(track) {
  if (!track || typeof track.getSettings !== "function") {
    return {
      echoCancellation: null,
      noiseSuppression: null,
      autoGainControl: null,
      rawCaptureVerified: false
    };
  }
  const settings = track.getSettings();
  const echoCancellation = typeof settings.echoCancellation === "boolean" ? settings.echoCancellation : null;
  const noiseSuppression = typeof settings.noiseSuppression === "boolean" ? settings.noiseSuppression : null;
  const autoGainControl = typeof settings.autoGainControl === "boolean" ? settings.autoGainControl : null;
  const rawCaptureVerified = echoCancellation === false && noiseSuppression === false && autoGainControl === false;
  return {
    echoCancellation,
    noiseSuppression,
    autoGainControl,
    rawCaptureVerified
  };
}

export function createRouteTarget({
  pathKind = "roundTrip",
  inputRoute = UNKNOWN_ROUTE,
  outputRoute = UNKNOWN_ROUTE,
  timebase = { reference: "audio-context", observed: "audio-context" }
} = {}) {
  return Object.freeze({
    pathKind,
    timebase: Object.freeze({
      reference: timebase.reference ?? "audio-context",
      observed: timebase.observed ?? "audio-context"
    }),
    environment: Object.freeze({
      inputRoute: typeof inputRoute === "string" && inputRoute.trim() !== "" ? inputRoute : UNKNOWN_ROUTE,
      outputRoute: typeof outputRoute === "string" && outputRoute.trim() !== "" ? outputRoute : UNKNOWN_ROUTE
    })
  });
}
