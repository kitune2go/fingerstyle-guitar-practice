import { readFile, writeFile } from "node:fs/promises";

const path="phrase.js";
const source=await readFile(path,"utf8");
const before='    buildStaff();\n    renderPracticeControls();\n    savePracticePreferences();\n    renderRecords();\n  }';
const after='    buildStaff();\n    renderPracticeControls();\n    // stop() ran while the previous focus was active. Recompute the audio\n    // entry buttons after state.focusMode has changed so reading cannot expose\n    // the normal phrase transport as a primary action.\n    setAudioEntriesPending(false);\n    savePracticePreferences();\n    renderRecords();\n  }';
if(!source.includes(before)) throw new Error("changeFocus anchor not found");
await writeFile(path,source.replace(before,after).trimEnd()+"\n");
