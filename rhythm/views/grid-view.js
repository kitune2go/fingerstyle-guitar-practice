import {
  getEventStep,
  getEventVelocity,
  getStepsPerBar,
  isEventAccented,
  isEventGhostNote
} from "../pattern-model.js";

export function createGridView({ board, partDefs, meterLabel }) {
  const documentRef = board.ownerDocument;

  function build(pattern) {
    const stepsPerBar = getStepsPerBar(pattern);
    board.innerHTML = "";

    for (let barIndex = 0; barIndex < pattern.bars; barIndex++) {
      const barBlock = documentRef.createElement("section");
      barBlock.className = "bar-block";
      barBlock.dataset.bar = String(barIndex);

      const heading = documentRef.createElement("div");
      heading.className = "bar-heading";
      heading.innerHTML =
        "<span>Bar " + (barIndex + 1) + " / " + pattern.bars + "</span>" +
        "<span>" + meterLabel(pattern) + " · " + pattern.pulse.count + " pulse</span>";
      barBlock.appendChild(heading);

      const ruler = documentRef.createElement("div");
      ruler.className = "ruler";
      const rulerLabel = documentRef.createElement("div");
      rulerLabel.className = "ruler-label";
      rulerLabel.textContent = "PART";

      const pulseRuler = documentRef.createElement("div");
      pulseRuler.className = "beat-ruler";
      pulseRuler.style.setProperty("--pulse-count", String(pattern.pulse.count));
      for (let pulse = 0; pulse < pattern.pulse.count; pulse++) {
        const label = documentRef.createElement("span");
        label.textContent = String(pulse + 1);
        pulseRuler.appendChild(label);
      }

      ruler.appendChild(rulerLabel);
      ruler.appendChild(pulseRuler);
      barBlock.appendChild(ruler);

      for (const part of partDefs) {
        const row = documentRef.createElement("div");
        row.className = "part-row";
        row.dataset.partRow = part.key;

        const label = documentRef.createElement("div");
        label.className = "part-label";
        label.textContent = part.label;

        const steps = documentRef.createElement("div");
        steps.className = "steps";
        steps.style.setProperty("--step-count", String(stepsPerBar));
        const events = new Map(
          (pattern.events[part.key] || []).map(event => [getEventStep(event), event])
        );
        const barStart = barIndex * stepsPerBar;

        for (let stepInBar = 0; stepInBar < stepsPerBar; stepInBar++) {
          const absoluteStep = barStart + stepInBar;
          const cell = documentRef.createElement("div");
          cell.className = "cell";
          if (stepInBar % pattern.subdivisionsPerPulse === 0) {
            cell.classList.add("pulse-start");
          }

          const event = events.get(absoluteStep);
          if (event) {
            const velocity = getEventVelocity(event);
            cell.classList.add("event");
            cell.classList.toggle("accent", isEventAccented(event));
            cell.classList.toggle("note-ghost", isEventGhostNote(event));
            cell.style.setProperty("--event-opacity", String(0.55 + velocity * 0.45));
            cell.dataset.velocity = String(velocity);
          }

          cell.dataset.step = String(absoluteStep);
          cell.dataset.part = part.key;
          steps.appendChild(cell);
        }

        row.appendChild(label);
        row.appendChild(steps);
        barBlock.appendChild(row);
      }

      board.appendChild(barBlock);
    }
  }

  function setActiveParts(activeParts) {
    board.querySelectorAll("[data-part-row]").forEach(row => {
      row.classList.toggle("inactive", !activeParts.has(row.dataset.partRow));
    });
  }

  function renderStep(step) {
    board.querySelectorAll(".cell.now").forEach(cell => cell.classList.remove("now"));
    board.querySelectorAll('[data-step="' + step + '"]').forEach(cell => {
      cell.classList.add("now");
    });
  }

  function clear() {
    board.querySelectorAll(".cell.now").forEach(cell => cell.classList.remove("now"));
  }

  return {
    build,
    setActiveParts,
    renderStep,
    clear
  };
}
