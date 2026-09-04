import { isBarBoundary } from "../pattern-model.js";

export const GHOST_BLOCK_BARS = 4;
export const GHOST_PREFERRED_ORDER = Object.freeze([
  "right",
  "left",
  "foot",
  "voice"
]);

export function createGhostMode({
  blockBars = GHOST_BLOCK_BARS,
  preferredOrder = GHOST_PREFERRED_ORDER
} = {}) {
  let enabled = false;
  const mutedParts = new Set();
  const visibleMutedParts = new Set();
  let scheduledBarCount = 0;
  let renderedBarCount = 0;
  const uiQueue = [];

  function reset() {
    mutedParts.clear();
    visibleMutedParts.clear();
    uiQueue.length = 0;
    scheduledBarCount = 0;
    renderedBarCount = 0;
  }

  function toggle() {
    enabled = !enabled;
    reset();
    return enabled;
  }

  function isEnabled() {
    return enabled;
  }

  function advance(time, activeParts) {
    const activeKeys = preferredOrder.filter(key => activeParts.has(key));
    if (activeKeys.length <= 1) return false;

    const maxMuted = activeKeys.length - 1;
    if (mutedParts.size >= maxMuted) {
      mutedParts.clear();
    } else {
      const next = preferredOrder.find(
        key => activeParts.has(key) && !mutedParts.has(key)
      );
      if (next) mutedParts.add(next);
    }

    uiQueue.push({
      time,
      muted: Array.from(mutedParts)
    });
    return true;
  }

  function handleScheduledStep(pattern, step, time, activeParts) {
    if (!isBarBoundary(pattern, step)) return false;

    let changed = false;
    if (enabled && scheduledBarCount > 0 && scheduledBarCount % blockBars === 0) {
      changed = advance(time, activeParts);
    }
    scheduledBarCount += 1;
    return changed;
  }

  function handleRenderedStep(pattern, step) {
    if (!isBarBoundary(pattern, step)) return false;
    renderedBarCount += 1;
    return true;
  }

  function flushVisibleQueue(visualNow) {
    let changed = false;
    while (uiQueue.length && uiQueue[0].time <= visualNow) {
      const event = uiQueue.shift();
      visibleMutedParts.clear();
      event.muted.forEach(key => visibleMutedParts.add(key));
      changed = true;
    }
    return changed;
  }

  function isPartMuted(key) {
    return mutedParts.has(key);
  }

  function getVisibleMutedParts() {
    return new Set(visibleMutedParts);
  }

  function getBarsRemaining() {
    const barsIntoBlock = renderedBarCount === 0
      ? 0
      : (renderedBarCount - 1) % blockBars;
    return blockBars - barsIntoBlock;
  }

  function getSnapshot() {
    return {
      enabled,
      mutedParts: new Set(mutedParts),
      visibleMutedParts: new Set(visibleMutedParts),
      scheduledBarCount,
      renderedBarCount,
      barsRemaining: getBarsRemaining(),
      queuedChanges: uiQueue.length
    };
  }

  return {
    reset,
    toggle,
    isEnabled,
    handleScheduledStep,
    handleRenderedStep,
    flushVisibleQueue,
    isPartMuted,
    getVisibleMutedParts,
    getBarsRemaining,
    getSnapshot
  };
}
