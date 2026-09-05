import test from "node:test";
import assert from "node:assert/strict";
import { createRecorder, selectRecordingMime } from "../../core/recorder.js";

function fakeEnvironment({denied=false,supported=["audio/webm;codecs=opus"],defaultType="audio/fake"}={}){
  const track={
    stopped:0,
    stop(){this.stopped+=1;},
    getSettings(){return {sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false};}
  };
  const stream={
    getTracks(){return [track];},
    getAudioTracks(){return [track];}
  };
  const calls=[];
  const mediaDevices={
    async getUserMedia(constraints){
      calls.push(constraints);
      if(denied){
        const error=new Error("denied");
        error.name="NotAllowedError";
        throw error;
      }
      return stream;
    }
  };

  class FakeMediaRecorder{
    static instances=[];
    static isTypeSupported(type){return supported.includes(type);}
    constructor(input,options={}){
      this.stream=input;
      this.options=options;
      this.mimeType=options.mimeType??defaultType;
      this.state="inactive";
      this.listeners=new Map();
      FakeMediaRecorder.instances.push(this);
    }
    addEventListener(type,listener){
      if(!this.listeners.has(type)) this.listeners.set(type,[]);
      this.listeners.get(type).push(listener);
    }
    emit(type,event={}){
      for(const listener of this.listeners.get(type)??[]) listener(event);
    }
    start(){this.state="recording";}
    stop(){
      if(this.state!=="recording") throw new Error("inactive");
      this.state="inactive";
      this.emit("dataavailable",{data:new Blob(["guitar"],{type:this.mimeType})});
      this.emit("stop");
    }
    fail(){
      const error=new Error("recorder failed");
      this.emit("error",{error});
    }
  }
  return {track,stream,calls,mediaDevices,FakeMediaRecorder};
}

test("recorder module imports in Node without browser globals",()=>{
  assert.equal(typeof globalThis.window,"undefined");
  assert.equal(typeof globalThis.document,"undefined");
  assert.equal(typeof createRecorder,"function");
});

test("unsupported browser APIs are reported without requesting a microphone",async()=>{
  const noRecorder=createRecorder({mediaDevices:{getUserMedia:async()=>{throw new Error("must not run");}}});
  await assert.rejects(noRecorder.start(),error=>error.code==="unsupported");
  const noMedia=createRecorder({MediaRecorderClass:class {}});
  await assert.rejects(noMedia.start(),error=>error.code==="media-devices-unsupported");
});

test("MIME type is feature-detected and falls back to browser default",async()=>{
  const preferred=fakeEnvironment({supported:["audio/mp4","audio/webm"]});
  assert.equal(selectRecordingMime(preferred.FakeMediaRecorder),"audio/mp4");
  const recorder=createRecorder({mediaDevices:preferred.mediaDevices,MediaRecorderClass:preferred.FakeMediaRecorder});
  await recorder.start();
  assert.deepEqual(preferred.FakeMediaRecorder.instances[0].options,{mimeType:"audio/mp4"});
  await recorder.cancel();

  const fallback=fakeEnvironment({supported:[],defaultType:"audio/browser-default"});
  const defaultRecorder=createRecorder({mediaDevices:fallback.mediaDevices,MediaRecorderClass:fallback.FakeMediaRecorder});
  await defaultRecorder.start();
  assert.deepEqual(fallback.FakeMediaRecorder.instances[0].options,{});
  assert.equal(fallback.FakeMediaRecorder.instances[0].mimeType,"audio/browser-default");
  await defaultRecorder.cancel();
});

test("explicit start requests raw microphone constraints and creates a Blob on stop",async()=>{
  const env=fakeEnvironment();
  const recorder=createRecorder({mediaDevices:env.mediaDevices,MediaRecorderClass:env.FakeMediaRecorder});
  assert.equal(env.calls.length,0);
  const started=await recorder.start();
  assert.equal(env.calls.length,1);
  assert.deepEqual(env.calls[0],{audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  assert.equal(recorder.state,"recording");
  assert.equal(started.settings.sampleRate,48000);
  const result=await recorder.stop();
  assert.equal(result.blob instanceof Blob,true);
  assert.equal(result.blob.size,6);
  assert.equal(result.mimeType,"audio/webm;codecs=opus");
  assert.deepEqual(result.settings,{sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false});
  assert.equal(env.track.stopped,1);
  assert.equal(recorder.state,"complete");
});

test("stop is safe when called repeatedly and never leaves a track alive",async()=>{
  const env=fakeEnvironment();
  const recorder=createRecorder({mediaDevices:env.mediaDevices,MediaRecorderClass:env.FakeMediaRecorder});
  await recorder.start();
  const first=await recorder.stop();
  const second=await recorder.stop();
  const third=await recorder.stop();
  assert.equal(first,second);
  assert.equal(second,third);
  assert.equal(env.track.stopped,1);
});

test("permission denial is a normal recorder state and releases no phantom stream",async()=>{
  const env=fakeEnvironment({denied:true});
  const recorder=createRecorder({mediaDevices:env.mediaDevices,MediaRecorderClass:env.FakeMediaRecorder});
  await assert.rejects(recorder.start(),error=>error.code==="denied"&&/許可/.test(error.message));
  assert.equal(recorder.state,"denied");
  assert.equal(env.track.stopped,0);
});

test("runtime recorder errors release tracks and report the failure",async()=>{
  const env=fakeEnvironment();
  const errors=[];
  const recorder=createRecorder({mediaDevices:env.mediaDevices,MediaRecorderClass:env.FakeMediaRecorder,onError:error=>errors.push(error)});
  await recorder.start();
  env.FakeMediaRecorder.instances[0].fail();
  await new Promise(resolve=>queueMicrotask(resolve));
  assert.equal(env.track.stopped,1);
  assert.equal(recorder.state,"failed");
  assert.equal(errors[0].code,"runtime-error");
});

test("cancel discards chunks and is idempotent",async()=>{
  const env=fakeEnvironment();
  const recorder=createRecorder({mediaDevices:env.mediaDevices,MediaRecorderClass:env.FakeMediaRecorder});
  await recorder.start();
  assert.equal(await recorder.cancel(),null);
  assert.equal(await recorder.cancel(),null);
  assert.equal(recorder.result,null);
  assert.equal(env.track.stopped,1);
  assert.equal(recorder.state,"idle");
});

test("duration limit is driven by injected timers rather than real sleep",async()=>{
  const env=fakeEnvironment();
  let timerCallback=null;
  let cleared=0;
  const limited=[];
  const recorder=createRecorder({
    mediaDevices:env.mediaDevices,
    MediaRecorderClass:env.FakeMediaRecorder,
    maxDurationMs:600000,
    setTimer(callback,ms){assert.equal(ms,600000);timerCallback=callback;return 7;},
    clearTimer(id){assert.equal(id,7);cleared+=1;},
    onLimit:result=>limited.push(result)
  });
  await recorder.start();
  assert.equal(typeof timerCallback,"function");
  timerCallback();
  await new Promise(resolve=>queueMicrotask(resolve));
  assert.equal(limited.length,1);
  assert.equal(limited[0].limitReached,true);
  assert.equal(env.track.stopped,1);
  assert.ok(cleared>=1);
});
