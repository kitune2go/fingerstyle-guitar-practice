export const UNKNOWN_ROUTE = "unknown";

export function isKnownRoute(route) {
  return typeof route === "string" && route.trim() !== "" && route !== UNKNOWN_ROUTE
    && route !== "default" && route !== "default-output";
}

export function resolveInputRoute(track) {
  if (!track || typeof track.getSettings !== "function") return UNKNOWN_ROUTE;
  const settings = track.getSettings();
  const deviceId = typeof settings?.deviceId === "string" ? settings.deviceId.trim() : "";
  return isKnownRoute(deviceId) ? deviceId : UNKNOWN_ROUTE;
}

export function resolveOutputRoute(audioContext) {
  if (!audioContext) return UNKNOWN_ROUTE;
  if (typeof audioContext.sinkId === "string") {
    const sinkId = audioContext.sinkId.trim();
    return isKnownRoute(sinkId) ? sinkId : UNKNOWN_ROUTE;
  }
  if (audioContext.sinkId && typeof audioContext.sinkId.deviceId === "string") {
    const deviceId = audioContext.sinkId.deviceId.trim();
    return isKnownRoute(deviceId) ? deviceId : UNKNOWN_ROUTE;
  }
  return UNKNOWN_ROUTE;
}

function outputSelectionFailure(error) {
  if (["NotAllowedError", "SecurityError"].includes(error?.name)) {
    return "音声出力先が選択されなかったため測定できません。";
  }
  if (error?.name === "NotFoundError") {
    return "利用できる音声出力デバイスが見つかりませんでした。";
  }
  if (error?.name === "InvalidStateError") {
    return "音声出力先の選択は、校正ボタンを押した直後に行ってください。";
  }
  return "音声出力先を設定できないため測定できません。";
}

export async function selectOutputRoute({
  audioContext,
  mediaDevices,
  preferredOutputRoute = null
} = {}) {
  if (typeof mediaDevices?.selectAudioOutput !== "function") {
    return {
      unmeasurable: true,
      outputRoute: UNKNOWN_ROUTE,
      reason: "このブラウザは音声出力先の選択に対応していないため測定できません。"
    };
  }
  if (typeof audioContext?.setSinkId !== "function") {
    return {
      unmeasurable: true,
      outputRoute: UNKNOWN_ROUTE,
      reason: "このブラウザはWeb Audioの出力先指定に対応していないため測定できません。"
    };
  }

  try {
    const selected = isKnownRoute(preferredOutputRoute)
      ? await mediaDevices.selectAudioOutput({ deviceId: preferredOutputRoute })
      : await mediaDevices.selectAudioOutput();
    const outputRoute = selected?.kind === "audiooutput" && isKnownRoute(selected.deviceId)
      ? selected.deviceId.trim()
      : UNKNOWN_ROUTE;
    if (!isKnownRoute(outputRoute)) {
      return {
        unmeasurable: true,
        outputRoute: UNKNOWN_ROUTE,
        reason: "選択された音声出力デバイスを識別できないため測定できません。"
      };
    }

    await audioContext.setSinkId(outputRoute);
    if (resolveOutputRoute(audioContext) !== outputRoute) {
      return {
        unmeasurable: true,
        outputRoute: UNKNOWN_ROUTE,
        reason: "選択した音声出力先をWeb Audioへ適用できないため測定できません。"
      };
    }
    return { outputRoute };
  } catch (error) {
    return {
      unmeasurable: true,
      outputRoute: UNKNOWN_ROUTE,
      reason: outputSelectionFailure(error)
    };
  }
}

export async function restoreOutputRoute({
  audioContext,
  mediaDevices,
  outputRoute
} = {}) {
  if (!isKnownRoute(outputRoute)
      || typeof audioContext?.setSinkId !== "function"
      || typeof mediaDevices?.enumerateDevices !== "function") {
    return { outputRoute: UNKNOWN_ROUTE };
  }

  try {
    const devices = await mediaDevices.enumerateDevices();
    const available = devices.some(device=>
      device?.kind === "audiooutput" && device.deviceId === outputRoute
    );
    if (!available) return { outputRoute: UNKNOWN_ROUTE };

    await audioContext.setSinkId(outputRoute);
    return {
      outputRoute: resolveOutputRoute(audioContext) === outputRoute
        ? outputRoute
        : UNKNOWN_ROUTE
    };
  } catch {
    return { outputRoute: UNKNOWN_ROUTE };
  }
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
  processing,
  timebase = { reference: "audio-context", observed: "audio-context" }
} = {}) {
  const env = {
    inputRoute: typeof inputRoute === "string" && inputRoute.trim() !== "" ? inputRoute : UNKNOWN_ROUTE,
    outputRoute: typeof outputRoute === "string" && outputRoute.trim() !== "" ? outputRoute : UNKNOWN_ROUTE
  };
  if (processing !== undefined && processing !== null) {
    env.processing = Object.freeze({
      echoCancellation: typeof processing.echoCancellation === "boolean" ? processing.echoCancellation : null,
      noiseSuppression: typeof processing.noiseSuppression === "boolean" ? processing.noiseSuppression : null,
      autoGainControl: typeof processing.autoGainControl === "boolean" ? processing.autoGainControl : null,
      rawCaptureVerified: typeof processing.rawCaptureVerified === "boolean"
        ? processing.rawCaptureVerified
        : (processing.echoCancellation === false && processing.noiseSuppression === false && processing.autoGainControl === false)
    });
  }
  return Object.freeze({
    pathKind,
    timebase: Object.freeze({
      reference: timebase.reference ?? "audio-context",
      observed: timebase.observed ?? "audio-context"
    }),
    environment: Object.freeze(env)
  });
}
