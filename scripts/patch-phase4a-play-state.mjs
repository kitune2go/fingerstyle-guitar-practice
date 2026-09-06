import { readFile, writeFile } from "node:fs/promises";

const path="phrase.js";
const source=await readFile(path,"utf8");
const before='    $("practice-status").textContent=rangeLabel()+"を練習 / "+ASSIST_LABELS[state.assist];\n  }';
const after='    $("practice-status").textContent=rangeLabel()+"を練習 / "+ASSIST_LABELS[state.assist];\n    // stop() runs before a focus change and therefore reflects the previous\n    // focus. Recompute audio entry availability after the new focus is drawn.\n    setAudioEntriesPending(state.starting);\n  }';
if(!source.includes(before)) throw new Error("renderPracticeControls anchor not found");
await writeFile(path,source.replace(before,after).trimEnd()+"\n");
