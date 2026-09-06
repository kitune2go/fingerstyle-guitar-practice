import { readFile, writeFile } from "node:fs/promises";

const path="docs/ROADMAP.md";
const text=await readFile(path,"utf8");
const from="**NEXT SUBPHASE: Phase 4B — 測定・処方**";
const to="**NEXT SUBPHASE: Phase 4B — 測定意味論とレイテンシ校正**";
const count=text.split(from).length-1;
if(count!==1) throw new Error(`ROADMAP expected one outdated NEXT SUBPHASE, found ${count}`);
await writeFile(path,text.replace(from,to));
