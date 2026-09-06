import { readFile, writeFile } from "node:fs/promises";
const path="docs/ROADMAP.md";
const source=await readFile(path,"utf8");
const before="**NEXT SUBPHASE: Phase 4B — 測定・処方**";
const after="**NEXT SUBPHASE: Phase 4B — 測定意味論とレイテンシ校正**";
if(!source.includes(before)) throw new Error("ROADMAP next subphase anchor not found");
await writeFile(path,source.replace(before,after).trimEnd()+"\n");
