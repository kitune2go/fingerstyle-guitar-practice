export const RECORDING_MIME_CANDIDATES=Object.freeze([
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm"
]);

export function selectRecordingMime(MediaRecorderClass,candidates=RECORDING_MIME_CANDIDATES){
  if(typeof MediaRecorderClass?.isTypeSupported!=="function") return null;
  return candidates.find(type=>MediaRecorderClass.isTypeSupported(type))??null;
}

function recorderError(code,message,cause){
  const error=new Error(message,{cause});
  error.code=code;
  return error;
}

function classifyMediaError(error){
  if(["NotAllowedError","PermissionDeniedError","SecurityError"].includes(error?.name)){
    return recorderError("denied","マイクの利用が許可されませんでした。",error);
  }
  if(["NotFoundError","DevicesNotFoundError"].includes(error?.name)){
    return recorderError("no-device","利用できるマイクが見つかりませんでした。",error);
  }
  return recorderError("failed","マイクを開始できませんでした。",error);
}

function trackSettings(stream){
  const track=stream?.getAudioTracks?.()[0]??stream?.getTracks?.()[0];
  if(!track||typeof track.getSettings!=="function") return {};
  const settings=track.getSettings()??{};
  const result={};
  for(const key of ["sampleRate","channelCount","echoCancellation","noiseSuppression","autoGainControl"]){
    if(settings[key]!==undefined) result[key]=settings[key];
  }
  return result;
}

export function createRecorder({
  mediaDevices,
  MediaRecorderClass,
  BlobClass=Blob,
  setTimer=setTimeout,
  clearTimer=clearTimeout,
  maxDurationMs=600_000,
  onLimit=null
}={}){
  let status="idle";
  let stream=null;
  let mediaRecorder=null;
  let chunks=[];
  let selectedMime=null;
  let finishPromise=null;
  let resolveFinish=null;
  let rejectFinish=null;
  let limitTimer=null;
  let discard=false;
  let limitReached=false;
  let requestToken=0;
  let lastResult=null;

  const stopTracks=target=>{
    for(const track of target?.getTracks?.()??[]){
      try{track.stop();}catch{}
    }
  };

  const clearLimit=()=>{
    if(limitTimer!==null) clearTimer(limitTimer);
    limitTimer=null;
  };

  const resetRecorder=()=>{
    mediaRecorder=null;
    chunks=[];
    selectedMime=null;
    finishPromise=null;
    resolveFinish=null;
    rejectFinish=null;
    discard=false;
    limitReached=false;
  };

  const releaseStream=()=>{
    stopTracks(stream);
    stream=null;
  };

  async function request(){
    if(!MediaRecorderClass){
      status="unsupported";
      throw recorderError("unsupported","このブラウザは録音に対応していません。");
    }
    if(!mediaDevices?.getUserMedia){
      status="unsupported";
      throw recorderError("media-devices-unsupported","このブラウザではマイクを利用できません。");
    }
    if(stream) return stream;

    const token=++requestToken;
    status="requesting";
    try{
      const acquired=await mediaDevices.getUserMedia({audio:{
        echoCancellation:false,
        noiseSuppression:false,
        autoGainControl:false
      }});
      if(token!==requestToken){
        stopTracks(acquired);
        throw recorderError("cancelled","マイク取得を中止しました。");
      }
      stream=acquired;
      status="ready";
      return stream;
    }catch(error){
      if(error?.code==="cancelled") throw error;
      status=["NotAllowedError","PermissionDeniedError","SecurityError"].includes(error?.name)?"denied"
        :["NotFoundError","DevicesNotFoundError"].includes(error?.name)?"no-device":"failed";
      throw classifyMediaError(error);
    }
  }

  function bind(target,type,handler){
    if(typeof target.addEventListener==="function") target.addEventListener(type,handler);
    else target["on"+type]=handler;
  }

  async function start(){
    if(["recording","stopping","requesting"].includes(status)){
      throw recorderError("busy","録音処理はすでに実行中です。");
    }
    lastResult=null;
    const activeStream=await request();
    selectedMime=selectRecordingMime(MediaRecorderClass);
    try{
      mediaRecorder=selectedMime
        ?new MediaRecorderClass(activeStream,{mimeType:selectedMime})
        :new MediaRecorderClass(activeStream);
    }catch(error){
      releaseStream();
      status="failed";
      throw recorderError("start-failed","録音を開始できませんでした。",error);
    }

    chunks=[];
    discard=false;
    limitReached=false;
    finishPromise=new Promise((resolve,reject)=>{
      resolveFinish=resolve;
      rejectFinish=reject;
    });

    bind(mediaRecorder,"dataavailable",event=>{
      if(event?.data?.size>0) chunks.push(event.data);
    });
    bind(mediaRecorder,"error",event=>{
      clearLimit();
      const error=recorderError("runtime-error","録音中にエラーが発生しました。",event?.error);
      status="failed";
      releaseStream();
      rejectFinish?.(error);
      resolveFinish=null;
      rejectFinish=null;
    });
    bind(mediaRecorder,"stop",()=>{
      clearLimit();
      const settings=trackSettings(activeStream);
      releaseStream();
      if(discard){
        lastResult=null;
        status="idle";
        resolveFinish?.(null);
      }else{
        const mimeType=mediaRecorder?.mimeType||selectedMime||chunks.find(chunk=>chunk?.type)?.type||"";
        const blob=new BlobClass(chunks,mimeType?{type:mimeType}:undefined);
        lastResult={blob,mimeType:blob.type||mimeType,size:blob.size,settings,limitReached};
        status="complete";
        resolveFinish?.(lastResult);
      }
      resolveFinish=null;
      rejectFinish=null;
    });

    try{
      mediaRecorder.start();
    }catch(error){
      releaseStream();
      resetRecorder();
      status="failed";
      throw recorderError("start-failed","録音を開始できませんでした。",error);
    }
    status="recording";
    if(Number.isFinite(maxDurationMs)&&maxDurationMs>0){
      limitTimer=setTimer(()=>{
        if(status!=="recording") return;
        limitReached=true;
        void stop().then(result=>onLimit?.(result)).catch(()=>{});
      },maxDurationMs);
    }
    return {mimeType:selectedMime??mediaRecorder.mimeType??"",settings:trackSettings(activeStream)};
  }

  function stop(){
    requestToken+=1;
    clearLimit();
    if(status==="stopping") return finishPromise??Promise.resolve(lastResult);
    if(status!=="recording"){
      releaseStream();
      return Promise.resolve(lastResult);
    }
    status="stopping";
    try{
      mediaRecorder.stop();
    }catch(error){
      releaseStream();
      status="failed";
      rejectFinish?.(recorderError("stop-failed","録音を終了できませんでした。",error));
    }
    return finishPromise??Promise.resolve(null);
  }

  function cancel(){
    requestToken+=1;
    clearLimit();
    discard=true;
    lastResult=null;
    if(status==="recording"){
      status="stopping";
      try{mediaRecorder.stop();}catch{
        releaseStream();
        status="idle";
        resolveFinish?.(null);
      }
      return finishPromise??Promise.resolve(null);
    }
    if(status==="stopping") return finishPromise??Promise.resolve(null);
    releaseStream();
    status="idle";
    return Promise.resolve(null);
  }

  return {
    request,start,stop,cancel,
    get state(){return status;},
    get running(){return status==="recording"||status==="stopping";},
    get result(){return lastResult;}
  };
}
