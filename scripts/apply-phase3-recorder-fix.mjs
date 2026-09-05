import { readFile, writeFile, unlink } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) throw new Error(`${path}: expected text not found`);
  const updated = source.replace(before, after);
  if (updated === source) throw new Error(`${path}: replacement made no change`);
  await writeFile(path, updated);
}

await replaceOnce(
  "phrase.js",
  '?"端末の保存容量が不足しています。記録と録音は保存していません。今回の結果は残してありますので、不要な録音を削除して再試行してください。"',
  '?"端末の保存容量が不足しているため保存できませんでした。記録と録音は保存していません。今回の結果は残してありますので、不要な録音を削除して再試行してください。"'
);

await replaceOnce(
  "core/recorder.js",
  '  let rejectFinish=null;\n  let limitTimer=null;',
  '  let rejectFinish=null;\n  let finishSettled=false;\n  let limitTimer=null;'
);

await replaceOnce(
  "core/recorder.js",
  '  const clearLimit=()=>{\n    if(limitTimer!==null) clearTimer(limitTimer);\n    limitTimer=null;\n  };\n\n  const resetRecorder=()=>{',
  '  const clearLimit=()=>{\n    if(limitTimer!==null) clearTimer(limitTimer);\n    limitTimer=null;\n  };\n\n  const settleFinish=(kind,value)=>{\n    if(finishSettled) return false;\n    finishSettled=true;\n    const resolve=resolveFinish;\n    const reject=rejectFinish;\n    resolveFinish=null;\n    rejectFinish=null;\n    if(kind==="reject") reject?.(value);\n    else resolve?.(value);\n    return true;\n  };\n\n  const resetRecorder=()=>{'
);

await replaceOnce(
  "core/recorder.js",
  '    rejectFinish=null;\n    discard=false;',
  '    rejectFinish=null;\n    finishSettled=false;\n    discard=false;'
);

await replaceOnce(
  "core/recorder.js",
  '    finishPromise=new Promise((resolve,reject)=>{\n      resolveFinish=resolve;\n      rejectFinish=reject;\n    });',
  '    finishSettled=false;\n    finishPromise=new Promise((resolve,reject)=>{\n      resolveFinish=resolve;\n      rejectFinish=reject;\n    });'
);

await replaceOnce(
  "core/recorder.js",
  '    bind(mediaRecorder,"error",event=>{\n      clearLimit();\n      const error=recorderError("runtime-error","録音中にエラーが発生しました。",event?.error);\n      status="failed";\n      releaseStream();\n      rejectFinish?.(error);\n      resolveFinish=null;\n      rejectFinish=null;\n      onError?.(error);\n    });\n    bind(mediaRecorder,"stop",()=>{\n      clearLimit();\n      const settings=trackSettings(activeStream);\n      releaseStream();\n      if(discard){\n        lastResult=null;\n        status="idle";\n        resolveFinish?.(null);\n      }else{\n        const mimeType=mediaRecorder?.mimeType||selectedMime||chunks.find(chunk=>chunk?.type)?.type||"";\n        const blob=new BlobClass(chunks,mimeType?{type:mimeType}:undefined);\n        lastResult={blob,mimeType:blob.type||mimeType,size:blob.size,settings,limitReached};\n        status="complete";\n        resolveFinish?.(lastResult);\n      }\n      resolveFinish=null;\n      rejectFinish=null;\n    });',
  '    bind(mediaRecorder,"error",event=>{\n      if(finishSettled) return;\n      clearLimit();\n      const error=recorderError("runtime-error","録音中にエラーが発生しました。",event?.error);\n      status="failed";\n      lastResult=null;\n      releaseStream();\n      settleFinish("reject",error);\n      onError?.(error);\n    });\n    bind(mediaRecorder,"stop",()=>{\n      clearLimit();\n      // Some implementations dispatch stop after error. The runtime failure is\n      // terminal for this recording; never overwrite it with a false success.\n      if(finishSettled) return;\n      const settings=trackSettings(activeStream);\n      releaseStream();\n      if(discard){\n        lastResult=null;\n        status="idle";\n        settleFinish("resolve",null);\n      }else{\n        const mimeType=mediaRecorder?.mimeType||selectedMime||chunks.find(chunk=>chunk?.type)?.type||"";\n        const blob=new BlobClass(chunks,mimeType?{type:mimeType}:undefined);\n        lastResult={blob,mimeType:blob.type||mimeType,size:blob.size,settings,limitReached};\n        status="complete";\n        settleFinish("resolve",lastResult);\n      }\n    });'
);

await replaceOnce(
  "core/recorder.js",
  '    try{\n      mediaRecorder.start();\n    }catch(error){\n      releaseStream();\n      resetRecorder();\n      status="failed";\n      throw recorderError("start-failed","録音を開始できませんでした。",error);\n    }',
  '    try{\n      mediaRecorder.start();\n    }catch(error){\n      releaseStream();\n      const failure=recorderError("start-failed","録音を開始できませんでした。",error);\n      settleFinish("reject",failure);\n      resetRecorder();\n      status="failed";\n      throw failure;\n    }'
);

await replaceOnce(
  "core/recorder.js",
  '  function stop(){\n    requestToken+=1;\n    clearLimit();\n    if(status==="stopping") return finishPromise??Promise.resolve(lastResult);\n    if(status!=="recording"){\n      releaseStream();\n      return Promise.resolve(lastResult);\n    }\n    status="stopping";\n    try{\n      mediaRecorder.stop();\n    }catch(error){\n      releaseStream();\n      status="failed";\n      const failure=recorderError("stop-failed","録音を終了できませんでした。",error);\n      rejectFinish?.(failure);\n      onError?.(failure);\n    }\n    return finishPromise??Promise.resolve(null);\n  }',
  '  function stop(){\n    requestToken+=1;\n    clearLimit();\n    if(status==="requesting"){\n      status="idle";\n      releaseStream();\n      return Promise.resolve(null);\n    }\n    if(status==="stopping") return finishPromise??Promise.resolve(lastResult);\n    if(status==="failed"&&finishPromise) return finishPromise;\n    if(status!=="recording"){\n      releaseStream();\n      return Promise.resolve(lastResult);\n    }\n    status="stopping";\n    try{\n      mediaRecorder.stop();\n    }catch(error){\n      releaseStream();\n      status="failed";\n      lastResult=null;\n      const failure=recorderError("stop-failed","録音を終了できませんでした。",error);\n      settleFinish("reject",failure);\n      onError?.(failure);\n    }\n    return finishPromise??Promise.resolve(null);\n  }'
);

await replaceOnce(
  "core/recorder.js",
  '      try{mediaRecorder.stop();}catch{\n        releaseStream();\n        status="idle";\n        resolveFinish?.(null);\n      }',
  '      try{mediaRecorder.stop();}catch{\n        releaseStream();\n        status="idle";\n        settleFinish("resolve",null);\n      }'
);

await replaceOnce(
  "core/recorder.js",
  '    releaseStream();\n    status="idle";\n    return Promise.resolve(null);\n  }\n\n  return {',
  '    releaseStream();\n    status="idle";\n    resetRecorder();\n    return Promise.resolve(null);\n  }\n\n  return {'
);

const recorderTests = `\n\ntest("runtime error remains terminal even if a later stop event arrives",async()=>{\n  const env=fakeEnvironment();\n  const errors=[];\n  const recorder=createRecorder({mediaDevices:env.mediaDevices,MediaRecorderClass:env.FakeMediaRecorder,onError:error=>errors.push(error)});\n  await recorder.start();\n  const instance=env.FakeMediaRecorder.instances[0];\n  instance.fail();\n  await assert.rejects(recorder.stop(),error=>error.code==="runtime-error");\n  instance.emit("stop");\n  await new Promise(resolve=>queueMicrotask(resolve));\n  assert.equal(recorder.state,"failed");\n  assert.equal(recorder.result,null);\n  assert.equal(env.track.stopped,1);\n  assert.equal(errors.length,1);\n});\n\ntest("stop during microphone request cancels acquisition and returns to idle",async()=>{\n  const env=fakeEnvironment();\n  let resolveAcquire;\n  const mediaDevices={getUserMedia(){return new Promise(resolve=>{resolveAcquire=resolve;});}};\n  const recorder=createRecorder({mediaDevices,MediaRecorderClass:env.FakeMediaRecorder});\n  const starting=recorder.start();\n  assert.equal(recorder.state,"requesting");\n  assert.equal(await recorder.stop(),null);\n  assert.equal(recorder.state,"idle");\n  resolveAcquire(env.stream);\n  await assert.rejects(starting,error=>error.code==="cancelled");\n  assert.equal(recorder.state,"idle");\n  assert.equal(env.track.stopped,1);\n});\n\ntest("repeated cancel during microphone request stays idle and releases the acquired track once",async()=>{\n  const env=fakeEnvironment();\n  let resolveAcquire;\n  const mediaDevices={getUserMedia(){return new Promise(resolve=>{resolveAcquire=resolve;});}};\n  const recorder=createRecorder({mediaDevices,MediaRecorderClass:env.FakeMediaRecorder});\n  const starting=recorder.start();\n  await recorder.cancel();\n  await recorder.cancel();\n  assert.equal(recorder.state,"idle");\n  resolveAcquire(env.stream);\n  await assert.rejects(starting,error=>error.code==="cancelled");\n  assert.equal(recorder.state,"idle");\n  assert.equal(env.track.stopped,1);\n});\n\ntest("synchronous recorder stop failure settles the finish promise exactly once",async()=>{\n  const env=fakeEnvironment();\n  const errors=[];\n  const recorder=createRecorder({mediaDevices:env.mediaDevices,MediaRecorderClass:env.FakeMediaRecorder,onError:error=>errors.push(error)});\n  await recorder.start();\n  const instance=env.FakeMediaRecorder.instances[0];\n  instance.stop=()=>{throw new Error("stop failed");};\n  await assert.rejects(recorder.stop(),error=>error.code==="stop-failed");\n  await assert.rejects(recorder.stop(),error=>error.code==="stop-failed");\n  assert.equal(recorder.state,"failed");\n  assert.equal(recorder.result,null);\n  assert.equal(env.track.stopped,1);\n  assert.equal(errors.length,1);\n});\n`;
const testPath="tests/unit/recorder.test.mjs";
const testSource=await readFile(testPath,"utf8");
if(testSource.includes('runtime error remains terminal even if a later stop event arrives')) throw new Error("recorder tests already patched");
await writeFile(testPath,testSource.trimEnd()+recorderTests+"\n");

for (const path of [
  ".github/workflows/e2e-diagnostic.yml",
  ".github/workflows/apply-phase3-recorder-fix.yml",
  "scripts/apply-phase3-recorder-fix.mjs"
]) {
  try { await unlink(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
