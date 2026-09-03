import {
  getBarIndex,
  getEventStep,
  getEventVelocity,
  getEventsForBar,
  getStepWithinBar,
  getStepsPerBar,
  isEventAccented,
  isEventGhostNote
} from "../pattern-model.js";

function createSvgElement(documentRef, name, attrs = {}) {
  const element = documentRef.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

export function createOrbitView({ svg, partDefs }) {
  const documentRef = svg.ownerDocument;
  let pattern = null;
  let currentBarIndex = -1;
  let activeParts = new Set();
  let visibleGhostMutedParts = new Set();

  function setState(nextActiveParts, nextVisibleGhostMutedParts) {
    activeParts = new Set(nextActiveParts);
    visibleGhostMutedParts = new Set(nextVisibleGhostMutedParts);

    svg.querySelectorAll("[data-orbit-part]").forEach(marker => {
      const key = marker.dataset.orbitPart;
      marker.classList.toggle("inactive", !activeParts.has(key));
      marker.classList.toggle("ghosted", visibleGhostMutedParts.has(key));
    });

    svg.querySelectorAll("[data-orbit-ring]").forEach(ring => {
      ring.classList.toggle("inactive", !activeParts.has(ring.dataset.orbitRing));
    });

    svg.querySelectorAll("[data-orbit-label]").forEach(label => {
      label.classList.toggle("inactive", !activeParts.has(label.dataset.orbitLabel));
    });
  }

  function build(nextPattern, barIndex = 0) {
    pattern = nextPattern;
    svg.innerHTML = "";

    const stepsPerBar = getStepsPerBar(pattern);
    const safeBarIndex = Math.max(0, Math.min(pattern.bars - 1, barIndex));
    const center = 150;
    const radii = [58, 82, 106, 130];

    partDefs.forEach((part, index) => {
      const radius = radii[index];

      const ring = createSvgElement(documentRef, "circle", {
        cx: center,
        cy: center,
        r: radius,
        class: "orbit-ring",
        "data-orbit-ring": part.key
      });
      svg.appendChild(ring);

      for (const event of getEventsForBar(pattern, part.key, safeBarIndex)) {
        const step = getEventStep(event);
        const velocity = getEventVelocity(event);
        const stepInBar = getStepWithinBar(pattern, step);
        const angle = (stepInBar / stepsPerBar) * Math.PI * 2 - Math.PI / 2;
        const x = center + Math.cos(angle) * radius;
        const y = center + Math.sin(angle) * radius;

        const marker = createSvgElement(documentRef, "circle", {
          cx: x.toFixed(2),
          cy: y.toFixed(2),
          r: (3.7 * (0.8 + velocity * 0.2)).toFixed(2),
          class:
            "orbit-marker" +
            (isEventAccented(event) ? " accent" : "") +
            (isEventGhostNote(event) ? " note-ghost" : ""),
          opacity: (0.55 + velocity * 0.45).toFixed(2),
          "data-orbit-part": part.key,
          "data-orbit-step": step,
          "data-velocity": velocity
        });
        svg.appendChild(marker);
      }

      const label = createSvgElement(documentRef, "text", {
        x: center,
        y: center - radius + 11,
        class: "orbit-label",
        "data-orbit-label": part.key
      });
      label.textContent = part.label;
      svg.appendChild(label);
    });

    const playhead = createSvgElement(documentRef, "line", {
      id: "orbitPlayhead",
      x1: center,
      y1: center,
      x2: center,
      y2: 10,
      class: "orbit-playhead"
    });
    svg.appendChild(playhead);

    const centerDisc = createSvgElement(documentRef, "circle", {
      cx: center,
      cy: center,
      r: 28,
      class: "orbit-center"
    });
    svg.appendChild(centerDisc);

    const beatText = createSvgElement(documentRef, "text", {
      id: "orbitBeat",
      x: center,
      y: center - 5,
      class: "orbit-beat"
    });
    beatText.textContent = "—";
    svg.appendChild(beatText);

    const barText = createSvgElement(documentRef, "text", {
      id: "orbitBar",
      x: center,
      y: center + 16,
      class: "orbit-bar"
    });
    barText.textContent = "BAR " + (safeBarIndex + 1) + "/" + pattern.bars;
    svg.appendChild(barText);

    currentBarIndex = safeBarIndex;
    setState(activeParts, visibleGhostMutedParts);
  }

  function renderStep(nextPattern, step, pulse) {
    const barIndex = getBarIndex(nextPattern, step);
    if (pattern !== nextPattern || barIndex !== currentBarIndex) {
      build(nextPattern, barIndex);
    }

    const stepInBar = getStepWithinBar(nextPattern, step);
    const playhead = svg.querySelector("#orbitPlayhead");
    if (playhead) {
      const angle = (stepInBar / getStepsPerBar(nextPattern)) * 360;
      playhead.setAttribute("transform", "rotate(" + angle + " 150 150)");
    }

    const beatText = svg.querySelector("#orbitBeat");
    if (beatText) beatText.textContent = pulse;

    const barText = svg.querySelector("#orbitBar");
    if (barText) {
      barText.textContent = "BAR " + (barIndex + 1) + "/" + nextPattern.bars;
    }

    svg.querySelectorAll(".orbit-marker.hit-now").forEach(marker => {
      marker.classList.remove("hit-now");
    });
    svg.querySelectorAll('[data-orbit-step="' + step + '"]').forEach(marker => {
      marker.classList.add("hit-now");
    });
  }

  function clear() {
    currentBarIndex = -1;
    svg.querySelectorAll(".orbit-marker.hit-now").forEach(marker => {
      marker.classList.remove("hit-now");
    });

    const playhead = svg.querySelector("#orbitPlayhead");
    if (playhead) playhead.setAttribute("transform", "rotate(0 150 150)");

    const beatText = svg.querySelector("#orbitBeat");
    if (beatText) beatText.textContent = "—";
  }

  return {
    build,
    setState,
    renderStep,
    clear
  };
}
