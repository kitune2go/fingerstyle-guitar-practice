import { createScheduler } from "./core/clock.js";
import { createRecorder } from "./core/recorder.js";
import { createSamplePlayer } from "./core/sample-player.js";
import { ASSIST_LABELS, FOCUS_MODES, FOCUS_SUCCESS_LABELS, SELF_REVIEW_KEYS, buildPracticeTimeline, focusMelodyLabel, focusResultLabel, practiceAdvice, practiceFocusDiagnosis, practiceHistoryCompletionLabel, practiceRange, parsePracticeBackup, validateAttempt } from "./core/practice.js";
import { createPracticeStore } from "./core/practice-store.js";
import {
  SIGN_CONVENTION,
  MIN_CALIBRATION_SAMPLES,
  MAX_CALIBRATION_SPREAD_MS,
  validateCalibrationRecord,
  extractSampleOffsetMs,
  calibrationApplies,
  invalidateCalibration
} from "./core/calibration.js";
import { validateMeasurementResult } from "./core/measurement.js";
import {
  UNKNOWN_ROUTE,
  isKnownRoute,
  resolveInputRoute,
  resolveOutputRoute,
  inspectTrackProcessing,
  createRouteTarget
} from "./core/audio-route.js";
import { runAcousticCalibrationCollector } from "./core/calibration-collector.js";
import {
  buildPhraseModel,
  midiToFrequency,
  noteToFrequency,
  noteToMidi,
} from "./core/music.js";
import {
  notationLabelsForNote,
  renderScore,
  setActiveNote,
  systemElement,
} from "./core/notation.js";

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SOUND_MODE_KEY="fingerstyle-sound-mode";
  const PRACTICE_KEY="fingerstyle-phrase-preferences";
  const state = {
    data:null, ready:null, phrase:null, model:null, index:0, noteIndex:0,
    audio:null, noiseBuffer:null, mix:null, samplePlayer:null,
    running:false, starting:false, loop:false, follow:true,
    soundMode:readSoundMode(),
    backing:{ chords:true, bass:true, drums:true },
    scheduler:null, raf:null, previewTimer:null,
    eventIndex:0, finished:false, generation:0,
    sources:new Set(), events:[], repeatIndex:0, timeline:null,
    range:{start:1,end:1}, assist:"full", melody:true, countIn:0, focusMode:"integrated", readingSession:null,
    run:null, pending:null, attempts:[], store:null, saving:false, preferences:{},
    activeCalibration:null, calibrationState:"uncalibrated", calibrationMessage:"", calibrating:false, calibrationRunId:0,
    currentInputRoute:null, currentOutputRoute:null, currentInputProcessing:null,
    recorder:null, recordingRunId:null, recordingFinalizing:false, recordingResult:null,
    pendingRecording:null, recordings:new Map(), pendingRecordingUrl:null, historyRecordingUrls:[],
    followedMeasure:-1,
    chordStroke:0,
    visualQueue:[], measures:[]
  };

  const MASTER_LEVEL=.78;
  const PHRASE_SAMPLES=["nylonGuitar","electricBass","kick","snare","closedHat","openHat"];

  const stringLabels = ["e","B","G","D","A","E"];
  const grooveLabels = { straight8:"Straight 8", rock8:"Rock 8" };
  const rootBaseMidi = {
    C:48,"C#":49,Db:49,D:50,"D#":51,Eb:51,E:52,F:53,"F#":54,Gb:54,
    G:55,"G#":56,Ab:56,A:57,"A#":58,Bb:58,B:59
  };
  const guitarChordVoicings = Object.freeze({
    C:[48,52,55,60,64],
    Am:[45,52,57,60,64],
    F:[41,48,53,57,60,65],
    G:[43,47,50,55,59,67],
    D:[50,57,62,66],
    D7:[50,57,60,66],
    Em:[40,47,52,55,59,64],
    E:[40,47,52,56,59,64],
    E7:[40,47,50,52,56,64],
    A7:[45,52,55,61,64]
  });

  function readSoundMode(){
    try{
      return localStorage.getItem(SOUND_MODE_KEY)==="synth"?"synth":"samples";
    }catch{
      return "samples";
    }
  }

  function saveSoundMode(){
    try{
      localStorage.setItem(SOUND_MODE_KEY,state.soundMode);
    }catch(error){
      console.warn("[phrase] could not save sound mode:",error);
    }
  }

  function renderSoundMode(status="idle"){
    const button=$("sound-mode-toggle");
    const note=$("sound-mode-note");
    if(!button||!note) return;

    const real=state.soundMode==="samples";
    if(!real&&status!=="failed") status="idle";
    const labels={
      idle:real?"音色：リアル":"音色：合成",
      loading:"音色：読込中…",
      partial:"音色：リアル（一部）",
      failed:"音源失敗：合成"
    };
    const notes={
      idle:real?"多音程ナイロンギター・低音ベース・生ドラム":"通信不要の軽量な合成音",
      loading:"サンプル音源を読み込んでいます",
      partial:"読めない音だけ合成音で補います",
      failed:"サンプルを読めないため合成音で再生します"
    };
    button.textContent=labels[status]||labels.idle;
    note.textContent=notes[status]||notes.idle;
    button.setAttribute("aria-pressed",String(real));
    button.setAttribute("aria-busy",String(status==="loading"));
    button.setAttribute("aria-label",real?"リアル音源を使用中。合成音に切り替える":"合成音を使用中。リアル音源に切り替える");
  }

  async function fetchArrayBuffer(url){
    const response=await fetch(url,{cache:"force-cache"});
    if(!response.ok) throw new Error(response.status+" "+response.statusText);
    return response.arrayBuffer();
  }

  async function prepareRealSamples(names=PHRASE_SAMPLES){
    if(state.soundMode!=="samples"||!state.audio) return;
    if(!names.length) return {requested:[],loaded:[],failed:[]};
    if(!state.samplePlayer){
      state.samplePlayer=createSamplePlayer({context:state.audio,fetchArrayBuffer});
    }
    renderSoundMode("loading");
    const result=await state.samplePlayer.load(names);
    if(state.soundMode!=="samples") return result;
    if(result.loaded.length===0){
      // Keep the saved preference untouched so a reload retries a transient
      // failure, while the current session and assistive state tell the truth.
      state.soundMode="synth";
      renderSoundMode("failed");
    }else{
      renderSoundMode(result.failed.length===0?"idle":"partial");
    }
    return result;
  }

  function toggleSoundMode(){
    state.soundMode=state.soundMode==="samples"?"synth":"samples";
    saveSoundMode();
    renderSoundMode();
    if(state.soundMode==="samples"&&state.audio){
      void prepareRealSamples().catch(error=>{
        console.warn("[phrase] sample load failed; using synthesis:",error);
        renderSoundMode("failed");
      });
    }
  }

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  async function loadData(){
    const response=await fetch("./data/phrases.json",{cache:"no-store"});
    if(!response.ok) throw new Error("フレーズ教材を読み込めませんでした。");
    state.data=await response.json();
  }

  function buildSelect(){
    $("phrase-select").innerHTML=state.data.phrases
      .map((p,i)=>'<option value="'+i+'">'+(i+1)+". "+escapeHtml(p.title)+"</option>").join("");
  }

  function splitMeasures(){
    state.model=buildPhraseModel(state.phrase);
    state.measures=state.model.measures;
  }

  function buildMeta(){
    $("key-label").textContent=state.phrase.keyLabel;
    $("time-label").textContent=state.phrase.timeSignature;
    $("bar-label").textContent=state.phrase.measures+" BARS";
    $("groove-label").textContent=grooveLabels[state.phrase.groove]||state.phrase.groove;
    $("chord-progression").innerHTML=state.phrase.chords
      .map((chord,i)=>'<div class="chord-chip" data-chord-measure="'+i+'"><small>M'+(i+1)+'</small><strong>'+escapeHtml(chord)+'</strong></div>')
      .join("");
  }

  // 4 characters per beat, so an eighth note is visibly half the width of a
  // quarter and the TAB lines up with the proportionally spaced staff above it.
  // Two-digit frets widen their own column on every string, keeping the six
  // lines in step.
  function tabCellWidth(note){
    return Math.max(Math.round(Number(note.beats)*4), String(note.fret).length+1);
  }

  function buildTab(){
    const blocks=state.measures.map((measure,mIndex)=>{
      const widths=measure.map(tabCellWidth);
      const lines=stringLabels.map((label,idx)=>{
        const stringNo=idx+1;
        let line=label+"|";
        measure.forEach((note,noteIndex)=>{
          const width=widths[noteIndex];
          line+=note.string===stringNo
            ? ("-"+note.fret).padEnd(width,"-")
            : "-".repeat(width);
        });
        return line+"|";
      });
      return "M"+(mIndex+1)+"  "+state.phrase.chords[mIndex]+"\n"+lines.join("\n");
    });
    $("tab").textContent=blocks.join("\n\n");
  }

  function buildStaff(){
    const host=$("staff");
    const focusAssist=state.focusMode==="reading"||state.focusMode==="rhythm"
      ?"staff"
      :state.focusMode==="execution"&&state.assist==="full"?"no-names":state.assist;
    renderScore(host,state.model,{
      engraver:window.VexFlow,
      assist:focusAssist,
      onSelectNote(index){
        state.noteIndex=index;
        renderCurrentNote();
        highlightNote(index);
        highlightMeasure(measureForNote(index));
      }
    });
  }

  function renderPhrase(){
    if(state.phrase) stop();
    state.phrase=state.data.phrases[state.index];
    state.noteIndex=0;
    state.readingSession=null;
    state.followedMeasure=-1;
    $("phrase-select").value=String(state.index);
    $("phrase-title").textContent=state.phrase.title;
    $("phrase-subtitle").textContent=state.phrase.subtitle;
    $("phrase-objective").textContent=state.phrase.objective;
    $("tempo").value=state.phrase.bpm;
    $("tempo-label").textContent=state.phrase.bpm;
    $("right-hand").textContent=state.phrase.rightHand;
    splitMeasures();
    restorePracticePreferences();
    buildMeta();
    buildStaff();
    buildTab();
    renderCurrentNote();
    highlightNote(0);
    highlightMeasure(0);
    renderPracticeControls();
    renderRecords();
    updateProgress(0);
  }

  function measureForNote(index){
    let cursor=0;
    for(let m=0;m<state.measures.length;m++){
      const next=cursor+state.measures[m].length;
      if(index<next) return m;
      cursor=next;
    }
    return 0;
  }

  function renderCurrentNote(){
    const note=state.model.notes[state.noteIndex];
    const measure=measureForNote(state.noteIndex);
    const notation=notationLabelsForNote(state.model,note);
    $("note-name").textContent=note.name;
    $("note-position").textContent=note.string+"弦 "+note.fret+"フレット";
    $("note-finger").textContent="右手 "+(note.finger||"—")
      +(notation.length?" / "+notation.join("・"):"");
    $("note-measure").textContent="M"+(measure+1)+" / "+state.phrase.chords[measure];
    $("position-label").textContent="M"+(measure+1)+" / "+(state.noteIndex+1)+" of "+state.model.notes.length;
  }

  function highlightNote(index){
    setActiveNote($("staff"),index);
  }

  function highlightMeasure(index){
    document.querySelectorAll("[data-chord-measure]").forEach(el=>{
      el.classList.toggle("active",Number(el.dataset.chordMeasure)===index);
    });
  }

  // force=true is used when the player steps notes by hand: the score should
  // follow the selection even though the transport is stopped.
  function followScore(index,force=false){
    if(!state.follow||state.assist==="memory") return;
    if(!force && !state.running) return;
    if(state.followedMeasure===index) return;

    const system=systemElement($("staff"),index);
    if(!system) return;

    state.followedMeasure=index;
    system.scrollIntoView({
      behavior:"smooth",
      block:"center",
      inline:"nearest"
    });
  }

  function updateProgress(value){
    $("progress-bar").style.width=Math.max(0,Math.min(100,value))+"%";
  }

  function createBus(level){
    const gain=state.audio.createGain();
    gain.gain.value=level;
    return gain;
  }

  function buildMixer(){
    if(state.mix) return;

    const master=createBus(MASTER_LEVEL);
    const melody=createBus(.95);
    const chords=createBus(1.0);
    const bass=createBus(.92);
    const drums=createBus(.95);
    const compressor=state.audio.createDynamicsCompressor();

    compressor.threshold.value=-18;
    compressor.knee.value=18;
    compressor.ratio.value=4;
    compressor.attack.value=.004;
    compressor.release.value=.18;

    melody.connect(master);
    chords.connect(master);
    bass.connect(master);
    drums.connect(master);
    master.connect(compressor);
    compressor.connect(state.audio.destination);

    state.mix={master,melody,chords,bass,drums,compressor};
  }

  function backingSampleNames(){
    const names=[];
    if(state.backing.chords) names.push("nylonGuitar");
    if(state.backing.bass) names.push("electricBass");
    if(state.backing.drums) names.push("kick","snare","closedHat","openHat");
    return names;
  }

  function pauseMediaPlayback(){
    const mediaElements=document.querySelectorAll("audio, video");
    for(const media of mediaElements){
      try{
        if(!media.paused) media.pause();
      }catch{}
    }
  }

  function setAudioEntriesPending(pending){
    const blocked=pending||state.calibrating;
    const playButton=$("play");
    const recordButton=$("record-play");
    const noteButton=$("play-note");
    const backingButton=$("preview-backing");
    if(playButton) playButton.disabled=blocked||state.running||state.focusMode==="reading";
    if(recordButton) recordButton.disabled=blocked||state.running||state.focusMode==="reading"||state.focusMode==="rhythm";
    if(noteButton) noteButton.disabled=blocked;
    if(backingButton) backingButton.disabled=blocked||state.focusMode==="reading"||state.focusMode==="rhythm";
    $("stop").disabled=!(pending||state.running||state.sources.size);

    const configBlocked=state.calibrating;
    const rhythmFocus=state.focusMode==="rhythm";
    if($("phrase-select")) $("phrase-select").disabled=configBlocked;
    if($("tempo")) $("tempo").disabled=configBlocked;
    if($("sound-mode-toggle")) $("sound-mode-toggle").disabled=configBlocked;
    if($("loop")) $("loop").disabled=configBlocked;
    if($("focus-mode")) $("focus-mode").disabled=configBlocked;
    if($("range-start")) $("range-start").disabled=configBlocked;
    if($("range-end")) $("range-end").disabled=configBlocked;
    if($("range-one")) $("range-one").disabled=configBlocked;
    if($("range-two")) $("range-two").disabled=configBlocked;
    if($("range-all")) $("range-all").disabled=configBlocked;
    if($("range-previous")) $("range-previous").disabled=configBlocked||state.range.start===1;
    if($("range-next")) $("range-next").disabled=configBlocked||state.range.end===(state.phrase?.measures??1);
    if($("count-in")) $("count-in").disabled=configBlocked;
    if($("assist-mode")) $("assist-mode").disabled=configBlocked;
    if($("reveal-score")) $("reveal-score").disabled=configBlocked;
    if($("melody-toggle")) $("melody-toggle").disabled=configBlocked;
    if($("backing-chords")) $("backing-chords").disabled=configBlocked||rhythmFocus;
    if($("backing-bass")) $("backing-bass").disabled=configBlocked||rhythmFocus;
    if($("backing-drums")) $("backing-drums").disabled=configBlocked;

    const mediaElements=document.querySelectorAll("audio, video");
    for(const media of mediaElements){
      if(configBlocked){
        try{ if(!media.paused) media.pause(); }catch{}
        media.style.pointerEvents="none";
        media.setAttribute("aria-disabled","true");
      }else{
        media.style.pointerEvents="";
        media.removeAttribute("aria-disabled");
      }
    }
    if($("delete-recording")) $("delete-recording").disabled=configBlocked;
    if($("retry-recording")) $("retry-recording").disabled=configBlocked;
    document.querySelectorAll("#attempt-list button").forEach(b=>{ b.disabled=configBlocked; });
  }

  async function ensureAudio(requiredSamples=PHRASE_SAMPLES){
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext) throw new Error("このブラウザはWeb Audioに対応していません。");
    if(!state.audio) state.audio=new AudioContext({latencyHint:"interactive"});
    if(state.audio.state==="suspended") await state.audio.resume();

    buildMixer();

    if(!state.noiseBuffer){
      const length=Math.floor(state.audio.sampleRate*.16);
      state.noiseBuffer=state.audio.createBuffer(1,length,state.audio.sampleRate);
      const data=state.noiseBuffer.getChannelData(0);
      for(let i=0;i<length;i++) data[i]=Math.random()*2-1;
    }

    if(state.soundMode==="samples") await prepareRealSamples(requiredSamples);
  }

  function envelopeGain(time,peak,decay,bus){
    const gain=state.audio.createGain();
    gain.gain.setValueAtTime(.0001,time);
    gain.gain.exponentialRampToValueAtTime(peak,time+.006);
    gain.gain.exponentialRampToValueAtTime(.0001,time+decay);
    gain.connect(bus);
    return gain;
  }

  function bendFor(note){
    return state.model.notations.find(notation=>
      notation.type==="bend"&&notation.note===note.id
    )??null;
  }

  function scheduleBend(parameter,baseValue,bend,time,durationSec){
    if(!bend) return;
    const target=baseValue*Math.pow(2,Number(bend.bendAlter)/12);
    const bendStart=time+Math.min(.12,durationSec*.28);
    const bendEnd=time+Math.min(.46,durationSec*.72);
    parameter.setValueAtTime(baseValue,bendStart);
    parameter.linearRampToValueAtTime(target,bendEnd);
  }

  function scheduleMelody(note,time,durationSec){
    const bend=bendFor(note);
    const sampleDuration=Math.max(.16,Math.min(1.8,durationSec*.92+.08));
    const sampled=state.soundMode==="samples"&&state.samplePlayer?.schedule("nylonGuitar",{
      time,
      destination:state.mix.melody,
      midi:noteToMidi(note.name),
      gain:.44,
      duration:sampleDuration,
      attack:.001,
      release:.09,
      pan:(3.5-Number(note.string||3.5))*.055
    });
    if(sampled){
      trackSource(sampled.source);
      scheduleBend(sampled.source.playbackRate,sampled.rate,bend,time,sampleDuration);
      return;
    }

    const freq=noteToFrequency(note.name);
    const gain=envelopeGain(time,.19,Math.max(.18,Math.min(1.6,durationSec*.92+.12)),state.mix.melody);
    const osc=state.audio.createOscillator();
    const harmonic=state.audio.createOscillator();
    const hg=state.audio.createGain();

    osc.type="triangle";
    harmonic.type="sine";
    osc.frequency.setValueAtTime(freq,time);
    harmonic.frequency.setValueAtTime(freq*2,time);
    scheduleBend(osc.frequency,freq,bend,time,durationSec);
    scheduleBend(harmonic.frequency,freq*2,bend,time,durationSec);
    hg.gain.setValueAtTime(.07,time);
    hg.gain.exponentialRampToValueAtTime(.0001,time+.16);

    osc.connect(gain);
    harmonic.connect(hg);
    hg.connect(gain);
    trackSource(osc);
    osc.start(time);
    trackSource(harmonic);
    harmonic.start(time);
    osc.stop(time+Math.max(.22,durationSec+.25));
    harmonic.stop(time+.2);
  }

  function chordInfo(name){
    const match=/^([A-G](?:#|b)?)(m?)(7?)$/.exec(name);
    if(!match) return {root:48,intervals:[0,4,7]};
    const root=rootBaseMidi[match[1]]??48;
    const minor=match[2]==="m";
    const seventh=match[3]==="7";
    return {
      root,
      intervals:seventh
        ? (minor?[0,3,7,10]:[0,4,7,10])
        : (minor?[0,3,7]:[0,4,7])
    };
  }

  function scheduleChord(name,time,durationSec,accent=1){
    const info=chordInfo(name);
    const voicing=guitarChordVoicings[name]
      ||[info.root,info.root+7,info.root+12,info.root+12+info.intervals[1]];
    const strings=voicing.map((midi,index)=>({
      midi,
      pan:voicing.length===1?0:-.18+(index/(voicing.length-1))*.36
    }));
    const upstroke=state.chordStroke%2===1;
    state.chordStroke+=1;
    const stroke=upstroke?strings.slice(-4).reverse():strings;

    stroke.forEach(({midi,pan},i)=>{
      const attack=time+i*(upstroke ? .012 : .014);
      const sampled=state.soundMode==="samples"&&state.samplePlayer?.schedule("nylonGuitar",{
        time:attack,
        destination:state.mix.chords,
        midi,
        gain:(upstroke ? .082 : .092)*accent,
        duration:Math.max(.24,durationSec*(upstroke ? .76 : 1)),
        attack:.001,
        release:.11,
        pan
      });
      if(sampled){trackSource(sampled.source);return;}

      const osc=state.audio.createOscillator();
      const gain=state.audio.createGain();
      const freq=midiToFrequency(midi);

      osc.type=midi===voicing[0]?"triangle":"sine";
      osc.frequency.setValueAtTime(freq,attack);
      gain.gain.setValueAtTime(.0001,attack);
      gain.gain.exponentialRampToValueAtTime(.052*accent,attack+.018);
      gain.gain.exponentialRampToValueAtTime(.0001,attack+durationSec);

      osc.connect(gain);
      gain.connect(state.mix.chords);
      trackSource(osc);
      osc.start(attack);
      osc.stop(attack+durationSec+.06);
    });
  }

  function scheduleBass(name,time){
    const info=chordInfo(name);
    const sampled=state.soundMode==="samples"&&state.samplePlayer?.schedule("electricBass",{
      time,
      destination:state.mix.bass,
      midi:info.root-12,
      gain:.34,
      duration:.46,
      attack:.002,
      release:.11
    });
    if(sampled){trackSource(sampled.source);return;}

    const fundamental=state.audio.createOscillator();
    const harmonic=state.audio.createOscillator();
    const gain=envelopeGain(time,.095,.34,state.mix.bass);
    const harmonicGain=state.audio.createGain();

    fundamental.type="triangle";
    harmonic.type="sine";
    fundamental.frequency.setValueAtTime(midiToFrequency(info.root-12),time);
    harmonic.frequency.setValueAtTime(midiToFrequency(info.root),time);
    harmonicGain.gain.setValueAtTime(.18,time);
    harmonicGain.gain.exponentialRampToValueAtTime(.0001,time+.24);

    fundamental.connect(gain);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(gain);
    trackSource(fundamental);
    fundamental.start(time);
    trackSource(harmonic);
    harmonic.start(time);
    fundamental.stop(time+.38);
    harmonic.stop(time+.28);
  }

  function scheduleKick(time){
    const sampled=state.soundMode==="samples"&&state.samplePlayer?.schedule("kick",{
      time,
      destination:state.mix.drums,
      gain:.32,
      duration:.22,
      release:.06
    });
    if(sampled){trackSource(sampled.source);return;}

    const osc=state.audio.createOscillator();
    const gain=state.audio.createGain();

    osc.type="sine";
    osc.frequency.setValueAtTime(145,time);
    osc.frequency.exponentialRampToValueAtTime(52,time+.12);
    gain.gain.setValueAtTime(.15,time);
    gain.gain.exponentialRampToValueAtTime(.0001,time+.14);

    osc.connect(gain);
    gain.connect(state.mix.drums);
    trackSource(osc);
    osc.start(time);
    osc.stop(time+.15);
  }

  function scheduleNoise(time,peak,decay,highpass,sampleName,sampleGain){
    const sampled=state.soundMode==="samples"&&state.samplePlayer?.schedule(sampleName,{
      time,
      destination:state.mix.drums,
      gain:sampleGain,
      duration:Math.max(decay+.02,sampleName === "snare" ? .18 : sampleName === "openHat" ? .22 : .07),
      release:.04,
      pan:sampleName === "snare" ? .14 : -.22
    });
    if(sampled){trackSource(sampled.source);return;}

    const source=state.audio.createBufferSource();
    source.buffer=state.noiseBuffer;

    const filter=state.audio.createBiquadFilter();
    filter.type="highpass";
    filter.frequency.value=highpass;

    const gain=state.audio.createGain();
    gain.gain.setValueAtTime(peak,time);
    gain.gain.exponentialRampToValueAtTime(.0001,time+decay);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(state.mix.drums);
    trackSource(source);
    source.start(time);
    source.stop(time+decay+.02);
  }

  function secondsPerBeat(){
    return 60/Number($("tempo").value);
  }

  function chordPattern(groove){
    return groove==="rock8"
      ? new Map([[0,1.0],[2,.72],[4,.88],[6,.76]])
      : new Map([[0,1.0],[3,.62],[4,.84],[7,.66]]);
  }

  function scheduleBackingGrid(inBar,time,chord,{pitched=true}={}){
    const spb=secondsPerBeat();
    const chordHits=chordPattern(state.phrase.groove);

    if(pitched&&state.backing.chords&&chordHits.has(inBar)){
      scheduleChord(chord,time,spb*.82,chordHits.get(inBar));
    }

    if(pitched&&state.backing.bass&&(inBar===0||inBar===4)){
      scheduleBass(chord,time);
    }

    if(state.backing.drums){
      // Closed hat on every eighth.
      const hat=inBar===7&&state.phrase.groove==="rock8"?"openHat":"closedHat";
      scheduleNoise(time,.028,.045,5200,hat,hat==="openHat" ? .11 : .14);
      // Kick on beats 1 and 3.
      if(inBar===0||inBar===4) scheduleKick(time);
      // Snare on beats 2 and 4.
      if(inBar===2||inBar===6) scheduleNoise(time,.095,.105,850,"snare",.26);
    }
  }

  function trackSource(source){
    state.sources.add(source);
    source.addEventListener("ended",()=>{
      state.sources.delete(source);
      source.disconnect();
      if(!state.running&&!state.starting&&!state.sources.size) $("stop").disabled=true;
    },{once:true});
  }

  function scheduleCountIn(time,beat){
    const osc=state.audio.createOscillator();
    const gain=envelopeGain(time,.12,.07,state.mix.drums);
    osc.frequency.setValueAtTime(beat===1?1000:750,time);
    osc.connect(gain);
    trackSource(osc);
    osc.start(time);
    osc.stop(time+.08);
  }

  function scheduleRhythmGuide(time,durationSec,accent=false){
    const neutralDuration=Math.max(.055,Math.min(1.2,durationSec*.86));
    const osc=state.audio.createOscillator();
    const gain=envelopeGain(time,accent?.12:.08,neutralDuration,state.mix.melody);
    osc.type="square";
    osc.frequency.setValueAtTime(880,time);
    osc.connect(gain);
    trackSource(osc);
    osc.start(time);
    osc.stop(time+neutralDuration+.015);
  }

  function scheduleEvent(event,time){
    if(event.countIn){
      scheduleCountIn(time,event.countIn);
      state.visualQueue.push({time,countIn:event.countIn});
      return;
    }
    if(event.complete){
      state.visualQueue.push({time,complete:true});
      return;
    }
    const spb=state.run.spb;
    const rhythmFocus=state.run.conditions.focusMode==="rhythm";
    if(rhythmFocus&&state.run.conditions.melody&&event.notes.some(item=>item.attack)){
      const durationBeats=Math.max(...event.notes.filter(item=>item.attack).map(item=>item.durationBeats));
      scheduleRhythmGuide(time,durationBeats*spb,Math.abs(event.beat%state.model.beatsPerBar)<1e-9);
    }
    event.notes.forEach(({note,index,attack,durationBeats})=>{
      if(!rhythmFocus&&attack&&state.run.conditions.melody) scheduleMelody(note,time,durationBeats*spb);
      state.visualQueue.push({time,index,measure:note.measureIndex,beat:event.beat});
    });
    if(event.backing){
      const {eighth,measure}=event.backing;
      scheduleBackingGrid(eighth,time,state.phrase.chords[measure],{pitched:!rhythmFocus});
    }
  }

  function schedulePhraseSlot(time){
    if(!state.running||!state.audio||!state.run) return null;
    if(time<state.audio.currentTime-.25){
      stop();
      $("practice-status").textContent="再生処理が遅れたため停止しました。もう一度再生してください。";
      return null;
    }

    const spb=secondsPerBeat();
    state.run.spb=spb;
    while(!state.finished){
      const event=state.events[state.eventIndex];
      const beat=event.beat;
      scheduleEvent(event,time);
      state.eventIndex+=1;

      if(state.eventIndex===state.events.length){
        if(!state.loop){
          state.finished=true;
          return null;
        }
        state.eventIndex=state.repeatIndex;
        const deltaBeats=state.timeline.lengthBeats+state.events[state.eventIndex].beat-beat;
        if(deltaBeats>0) return deltaBeats*spb;
        if(deltaBeats<0) throw new RangeError("フレーズイベントの時刻順が不正です。");
        continue;
      }

      const deltaBeats=state.events[state.eventIndex].beat-beat;
      if(deltaBeats>0) return deltaBeats*spb;
      if(deltaBeats<0) throw new RangeError("フレーズイベントの時刻順が不正です。");
    }
    return null;
  }

  function consumeVisualEvents(render=true){
    const now=state.audio.currentTime;
    while(state.visualQueue.length&&state.visualQueue[0].time<=now){
      const event=state.visualQueue.shift();
      if(event.complete){
        if(state.run) state.run.completedLoops+=1;
        if(render) $("practice-status").textContent=rangeLabel()+" / "+state.run.completedLoops+"回再生完了";
      }else if(event.countIn){
        if(render) $("practice-status").textContent="予備拍 "+event.countIn+" / "+state.model.beatsPerBar;
      }else if(render){
        state.noteIndex=event.index;
        renderCurrentNote();
        highlightNote(event.index);
        highlightMeasure(event.measure);
        followScore(event.measure);
        updateProgress(event.beat/state.timeline.lengthBeats*100);
        $("practice-status").textContent=rangeLabel()+" / "+(state.run.completedLoops+1)+"回目・M"+(event.measure+1);
      }
    }
  }

  function visualLoop(){
    if(!state.running||!state.audio) return;
    consumeVisualEvents();
    if(state.finished&&state.visualQueue.length===0){
      updateProgress(100);
      stop(false);
      return;
    }
    state.raf=requestAnimationFrame(visualLoop);
  }

  function clearPendingRecordingUrl(){
    if(state.pendingRecordingUrl){
      URL.revokeObjectURL(state.pendingRecordingUrl);
      state.pendingRecordingUrl=null;
    }
    const player=$("recording-player");
    if(player){
      player.removeAttribute("src");
      player.load();
    }
  }

  function clearHistoryRecordingUrls(){
    for(const url of state.historyRecordingUrls) URL.revokeObjectURL(url);
    state.historyRecordingUrls.length=0;
  }

  function resetSelfReview(){
    for(const key of SELF_REVIEW_KEYS){
      const select=$("review-"+key);
      if(select) select.value="";
    }
  }

  function clearPendingRecording(){
    clearPendingRecordingUrl();
    state.pendingRecording=null;
    resetSelfReview();
  }

  function readSelfReview(){
    if(!state.pendingRecording) return undefined;
    const entries=SELF_REVIEW_KEYS.map(key=>[key,Number($("review-"+key).value)]);
    if(!entries.every(([,value])=>Number.isInteger(value)&&value>=1&&value<=3)) return null;
    return Object.fromEntries(entries);
  }

  function renderRecordingMonitor(){
    const monitor=$("recording-monitor");
    const player=$("recording-player");
    const recording=state.pendingRecording;
    monitor.hidden=!recording;
    if(!recording){
      clearPendingRecordingUrl();
      return;
    }
    if(!state.pendingRecordingUrl){
      state.pendingRecordingUrl=URL.createObjectURL(recording.blob);
      player.src=state.pendingRecordingUrl;
    }
  }

  function recordingMessage(error){
    const byCode={
      unsupported:"このブラウザは録音に対応していません。",
      "media-devices-unsupported":"このブラウザではマイクを利用できません。",
      denied:"マイクの利用が許可されませんでした。",
      "no-device":"利用できるマイクが見つかりませんでした。",
      "start-failed":"録音を開始できませんでした。",
      "runtime-error":"録音中にエラーが発生しました。",
      "stop-failed":"録音を終了できませんでした。"
    };
    return byCode[error?.code]||error?.message||"録音を利用できませんでした。";
  }

  function handleRecorderError(error){
    if(error?.code==="cancelled") return;
    state.recordingRunId=null;
    state.recordingFinalizing=false;
    state.recordingResult=null;
    $("recording-status").textContent=recordingMessage(error)+" 通常の練習はそのまま利用できます。";
    if(state.phrase) renderRecords();
  }

  function recordingRecord(attemptId,date,result){
    return {
      attemptId,
      createdAt:date,
      mimeType:result.mimeType||result.blob.type||"",
      size:result.blob.size,
      blob:result.blob,
      settings:result.settings??{}
    };
  }

  function attachRecordingResult(runId,result,limited=false){
    if(!runId||!result) return;
    const limitReached=limited||result.limitReached;
    if(state.pending?.id!==runId){
      state.recordingResult={runId,result,limited:limitReached};
      if(limitReached) $("recording-status").textContent="録音は10分で停止しました。練習は続けられます。";
      return;
    }
    clearPendingRecording();
    state.pendingRecording=recordingRecord(runId,state.pending.date,result);
    state.recordingResult=null;
    state.recordingRunId=null;
    state.recordingFinalizing=false;
    $("recording-status").textContent=limitReached
      ?"録音は10分で停止しました。聴き返して自己レビューできます。"
      :"録音が完了しました。聴き返して自己レビューしてください。";
    renderRecords();
  }

  function finalizeRecordingForRun(runId){
    if(!runId||state.pending?.id!==runId) return Promise.resolve();
    const cached=state.recordingResult?.runId===runId?state.recordingResult:null;
    if(cached){
      attachRecordingResult(runId,cached.result,cached.limited);
      return Promise.resolve();
    }
    state.recordingFinalizing=true;
    $("recording-status").textContent="録音を確定しています…";
    renderRecords();
    return state.recorder.stop().then(result=>{
      if(result) attachRecordingResult(runId,result,result.limitReached);
      else{
        state.recordingRunId=null;
        state.recordingFinalizing=false;
        renderRecords();
      }
    }).catch(handleRecorderError);
  }

  async function play(withRecording=false){
    if(state.calibrating||state.running||state.starting||withRecording&&(state.focusMode==="reading"||state.focusMode==="rhythm")) return;
    stop();
    const generation=state.generation;
    state.starting=true;
    setAudioEntriesPending(true);
    try{
      await state.ready;
      if(generation!==state.generation) return;
      const requiredSamples=state.focusMode==="rhythm"
        ?(state.backing.drums?["kick","snare","closedHat","openHat"]:[])
        :[...(state.melody?["nylonGuitar"]:[]),...backingSampleNames()];
      await ensureAudio(requiredSamples);
      if(generation!==state.generation) return;
      restoreMaster();
      const runId=crypto.randomUUID();
      if(withRecording){
        state.recordingRunId=runId;
        $("recording-status").textContent="マイクを準備しています…";
        try{
          await state.recorder.start();
          const track = state.recorder.activeTrack?.();
          if (track) {
            const inRoute = resolveInputRoute(track);
            const outRoute = resolveOutputRoute(state.audio);
            state.currentInputProcessing = inspectTrackProcessing(track);
            if (inRoute !== UNKNOWN_ROUTE) state.currentInputRoute = inRoute;
            if (outRoute !== UNKNOWN_ROUTE) state.currentOutputRoute = outRoute;
            void loadCalibrations();
          }
        }catch(error){
          if(generation===state.generation) handleRecorderError(error);
          return;
        }
        if(generation!==state.generation){
          state.recordingRunId=null;
          await state.recorder.cancel();
          return;
        }
      }else{
        state.recordingRunId=null;
      }
      state.recordingResult=null;
      state.recordingFinalizing=false;
      state.pending=null;
      clearPendingRecording();
      state.timeline=buildPracticeTimeline(state.model,state.range);
      const countBeats=state.countIn*state.model.beatsPerBar;
      const spb=secondsPerBeat();
      const firstTime=state.audio.currentTime+.08;
      state.run={
        id:runId,phraseId:state.phrase.id,date:new Date().toISOString(),conditions:practiceConditions(),
        startedAt:firstTime+countBeats*spb,spb,completedLoops:0
      };
      if(withRecording) $("recording-status").textContent="録音中です。マイク音はスピーカーへ返しません。";
      else $("recording-status").textContent="通常練習中です。マイクは使用していません。";
      const intro=Array.from({length:countBeats},(_,i)=>({beat:i-countBeats,countIn:i%state.model.beatsPerBar+1}));
      state.events=[...intro,...state.timeline.events,{beat:state.timeline.lengthBeats,complete:true}];
      state.repeatIndex=intro.length;
      state.eventIndex=0;
      state.running=true;
      state.visualQueue.length=0;
      state.finished=false;
      state.followedMeasure=-1;
      state.chordStroke=0;
      renderRecords();
      state.scheduler=createScheduler({context:state.audio});
      state.scheduler.start(firstTime,schedulePhraseSlot);
      state.raf=requestAnimationFrame(visualLoop);
    }finally{
      if(generation===state.generation){
        state.starting=false;
        setAudioEntriesPending(false);
      }
    }
  }

  function restoreMaster(){
    if(!state.mix||!state.audio) return;
    const gain=state.mix.master.gain;
    const now=state.audio.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(MASTER_LEVEL,now);
  }

  // Cancel sources themselves: restoring a ducked master used to revive long
  // notes and even future strums after Stop. New playback can now start at once.
  function silenceTail(){
    if(!state.mix||!state.audio) return;
    const gain=state.mix.master.gain;
    const now=state.audio.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(.0001,now);
    for(const source of state.sources){
      try{source.stop(now);}catch{}
      source.disconnect();
    }
    state.sources.clear();
  }

  function stop(resetProgress=true){
    pauseMediaPlayback();
    state.generation+=1;
    state.starting=false;
    const run=state.run;
    const recordingRunId=state.recordingRunId;
    let recordingPromise=null;
    if(run){
      consumeVisualEvents(false);
      const elapsedSec=Math.max(0,state.audio.currentTime-run.startedAt);
      if(run.conditions.focusMode!=="reading"){
        state.pending=elapsedSec>0?{
          id:run.id,phraseId:run.phraseId,date:run.date,conditions:run.conditions,
          observed:{transportCompleted:run.completedLoops>0,completedLoops:run.completedLoops,elapsedSec:Math.round(elapsedSec*100)/100}
        }:null;
      }
      $("practice-status").textContent=rangeLabel()+" / "+run.completedLoops+"回再生完了";
      state.run=null;
    }else if(recordingRunId&&state.recorder){
      state.recordingRunId=null;
      state.recordingResult=null;
      state.recordingFinalizing=false;
      recordingPromise=state.recorder.cancel().catch(handleRecorderError);
    }
    silenceTail();
    state.running=false;
    state.scheduler?.stop();
    if(state.raf) cancelAnimationFrame(state.raf);
    if(state.previewTimer) clearTimeout(state.previewTimer);
    state.scheduler=null;
    state.raf=null;
    state.previewTimer=null;
    $("preview-backing").textContent="▶ 伴奏だけ1小節";
    state.visualQueue.length=0;
    state.finished=false;
    state.followedMeasure=-1;
    setAudioEntriesPending(false);
    $("stop").disabled=true;
    if(resetProgress) updateProgress(0);
    if(run&&recordingRunId){
      if(state.pending?.id===recordingRunId) recordingPromise=finalizeRecordingForRun(recordingRunId);
      else{
        state.recordingRunId=null;
        state.recordingResult=null;
        state.recordingFinalizing=false;
        recordingPromise=state.recorder.cancel().catch(handleRecorderError);
      }
    }
    if(state.phrase) renderRecords();
    return recordingPromise||Promise.resolve();
  }

  async function playOne(){
    if(state.calibrating||state.starting) return;
    stop();
    const generation=state.generation;
    state.starting=true;
    setAudioEntriesPending(true);
    try{
      await state.ready;
      if(generation!==state.generation) return;
      await ensureAudio(["nylonGuitar"]);
      if(generation!==state.generation) return;
      restoreMaster();
      const note=state.model.notes[state.noteIndex];
      scheduleMelody(note,state.audio.currentTime+.02,Number(note.beats)*secondsPerBeat());
      highlightNote(state.noteIndex);
    }finally{
      if(generation===state.generation){
        state.starting=false;
        setAudioEntriesPending(false);
      }
    }
  }

  async function previewBacking(){
    if(state.calibrating||state.starting) return;
    stop();
    const generation=state.generation;
    state.starting=true;
    setAudioEntriesPending(true);
    try{
      await state.ready;
      if(generation!==state.generation) return;
      await ensureAudio(backingSampleNames());
      if(generation!==state.generation) return;
      restoreMaster();
      const measure=measureForNote(state.noteIndex);
      const chord=state.phrase.chords[measure];
      const start=state.audio.currentTime+.05;
      const step=secondsPerBeat()/2;
      state.chordStroke=0;
      for(let inBar=0;inBar<8;inBar++) scheduleBackingGrid(inBar,start+inBar*step,chord);
      $("preview-backing").textContent="♪ M"+(measure+1)+" "+chord+" 再生中";
      state.previewTimer=setTimeout(()=>{
        $("preview-backing").textContent="▶ 伴奏だけ1小節";
        state.previewTimer=null;
      },Math.ceil(step*8*1000)+150);
    }finally{
      if(generation===state.generation){
        state.starting=false;
        setAudioEntriesPending(false);
      }
    }
  }

  function moveNote(amount){
    const length=state.model.notes.length;
    state.noteIndex=(state.noteIndex+amount+length)%length;
    renderCurrentNote();
    highlightNote(state.noteIndex);

    const measure=measureForNote(state.noteIndex);
    highlightMeasure(measure);
    followScore(measure,true);
    updateProgress((state.noteIndex/Math.max(1,length-1))*100);
  }

  function toggleBacking(type){
    if(state.calibrating) return;
    stop();
    state.backing[type]=!state.backing[type];
    const id=type==="chords"?"backing-chords":type==="bass"?"backing-bass":"backing-drums";
    const labels={chords:"♬ コード",bass:"● ベース",drums:"◉ ドラム"};
    const button=$(id);

    button.classList.toggle("active",state.backing[type]);
    button.setAttribute("aria-pressed",String(state.backing[type]));
    button.textContent=labels[type]+" "+(state.backing[type]?"ON":"OFF");
    savePracticePreferences();
    renderRecords();
  }

  function rangeLabel(conditions=state.range){
    return "M"+conditions.start+(conditions.end===conditions.start?"":"–M"+conditions.end);
  }

  function practiceConditions(){
    return {
      ...state.range,tempo:Number($("tempo").value),assist:state.assist,
      melody:state.melody,countIn:state.countIn,
      backing:Object.keys(state.backing).filter(part=>state.backing[part]&&(state.focusMode!=="rhythm"||part==="drums")),focusMode:state.focusMode
    };
  }

  function restorePracticePreferences(){
    const saved=state.preferences.phrases?.[state.phrase.id]??{};
    state.range=practiceRange(state.phrase.measures,saved.start??1,saved.end??state.phrase.measures);
    state.assist=Object.hasOwn(ASSIST_LABELS,saved.assist)?saved.assist:"full";
    state.countIn=[0,1,2].includes(saved.countIn)?saved.countIn:0;
    state.melody=typeof saved.melody==="boolean"?saved.melody:true;
    state.focusMode=Object.hasOwn(FOCUS_MODES,saved.focusMode)?saved.focusMode:"integrated";
    if(Array.isArray(saved.backing)){
      for(const part of Object.keys(state.backing)) state.backing[part]=saved.backing.includes(part);
    }else{
      state.backing={chords:true,bass:true,drums:true};
    }
    const labels={chords:"♬ コード",bass:"● ベース",drums:"◉ ドラム"};
    for(const part of Object.keys(state.backing)){
      const button=$("backing-"+part);
      button.classList.toggle("active",state.backing[part]);
      button.setAttribute("aria-pressed",String(state.backing[part]));
      button.textContent=labels[part]+" "+(state.backing[part]?"ON":"OFF");
    }
    if(Number.isInteger(saved.tempo)&&saved.tempo>=40&&saved.tempo<=160){
      $("tempo").value=String(saved.tempo);
      $("tempo-label").textContent=String(saved.tempo);
    }
    const options=Array.from({length:state.phrase.measures},(_,i)=>'<option value="'+(i+1)+'">M'+(i+1)+'</option>').join("");
    $("range-start").innerHTML=options;
    $("range-end").innerHTML=options;
    state.noteIndex=state.measures[state.range.start-1][0].globalIndex;
  }

  function savePracticePreferences(){
    try{
      const phrases=state.preferences.phrases&&typeof state.preferences.phrases==="object"?state.preferences.phrases:{};
      state.preferences={selected:state.phrase.id,phrases:{...phrases,[state.phrase.id]:practiceConditions()}};
      localStorage.setItem(PRACTICE_KEY,JSON.stringify(state.preferences));
    }catch{
      $("record-status").textContent="練習設定を保存できませんでした。練習は続けられます。";
    }
  }


  const FOCUS_DESCRIPTIONS=Object.freeze({
    reading:"譜面の音を見て、音名・度数・指板位置を先に考えてから答えを確認します。通常transport完遂は譜読み成功の根拠にしません。",
    rhythm:"同じ音価・onsetを固定の中立音で鳴らし、拍・細分・アクセントへ集中します。正しい音高は使わず、録音も行いません。",
    execution:"音名表示を減らし、TAB・運指・弦移動・左右同期・発音品質へ集中します。録音と自己レビューを利用できます。",
    integrated:"譜面・音高・リズム・運指・奏法・音色を同時に成立させる通常の統合練習です。"
  });

  function selectedRangeNotes(){
    return state.model.notes.filter(note=>note.measureIndex>=state.range.start-1&&note.measureIndex<state.range.end);
  }

  function resetReadingSession(){
    state.readingSession=null;
    const answer=$("reading-answer");
    if(answer){answer.hidden=true;answer.textContent="";}
  }

  function ensureReadingSession(){
    if(state.focusMode!=="reading"||!state.model) return null;
    const key=state.phrase.id+":"+state.range.start+":"+state.range.end;
    if(!state.readingSession||state.readingSession.key!==key){
      const notes=selectedRangeNotes().map(note=>note.globalIndex);
      state.readingSession={key,notes,position:0,revealed:false,completed:false,startedAt:Date.now()};
    }
    return state.readingSession;
  }

  function renderReadingFocus(){
    const panel=$("reading-focus");
    if(!panel) return;
    panel.hidden=state.focusMode!=="reading";
    if(panel.hidden) return;
    const session=ensureReadingSession();
    const reveal=$("reading-reveal");
    const next=$("reading-next");
    const answer=$("reading-answer");
    if(!session||!session.notes.length){
      $("reading-prompt").textContent="この区間には確認できる音符がありません。";
      reveal.disabled=true;next.disabled=true;answer.hidden=true;
      return;
    }
    if(session.completed){
      $("reading-prompt").textContent="譜読み確認完了。結果を自己評価として記録できます。";
      reveal.disabled=true;next.disabled=true;answer.hidden=true;
      return;
    }
    const index=session.notes[session.position];
    const note=state.model.notes[index];
    state.noteIndex=index;
    renderCurrentNote();
    highlightNote(index);
    highlightMeasure(note.measureIndex);
    $("reading-prompt").textContent="M"+(note.measureIndex+1)+" / "+(session.position+1)+" of "+session.notes.length+"：譜面を見て音名・度数・指板位置を考えてください。";
    answer.hidden=!session.revealed;
    const degreeLetters={C:0,D:1,E:2,F:3,G:4,A:5,B:6};
    const tonic=String(state.phrase.key||"C").replace(/m$/,"" )[0]||"C";
    const degree=((degreeLetters[note.name[0]]-degreeLetters[tonic]+7)%7)+1;
    answer.textContent=session.revealed?note.name+" / "+degree+"度 / "+note.string+"弦 "+note.fret+"フレット / 右手 "+(note.finger||"—"):"";
    reveal.disabled=session.revealed;
    next.disabled=!session.revealed;
    next.textContent=session.position===session.notes.length-1?"確認を完了":"次の音 →";
  }

  function revealReadingAnswer(){
    const session=ensureReadingSession();
    if(!session||session.completed) return;
    session.revealed=true;
    renderReadingFocus();
  }

  function advanceReadingFocus(){
    const session=ensureReadingSession();
    if(!session||session.completed||!session.revealed) return;
    if(session.position<session.notes.length-1){
      session.position+=1;session.revealed=false;renderReadingFocus();return;
    }
    session.completed=true;
    const elapsedSec=Math.max(.01,(Date.now()-session.startedAt)/1000);
    state.pending={
      id:crypto.randomUUID(),phraseId:state.phrase.id,date:new Date().toISOString(),conditions:practiceConditions(),
      observed:{transportCompleted:false,completedLoops:0,elapsedSec:Math.round(elapsedSec*100)/100}
    };
    $("practice-status").textContent=rangeLabel()+" / 譜読み確認完了";
    renderReadingFocus();
    renderRecords();
  }

  function changeFocus(focusMode){
    if(state.calibrating) return;
    if(!Object.hasOwn(FOCUS_MODES,focusMode)||focusMode===state.focusMode) return;
    stop();
    state.pending=null;
    state.recordingRunId=null;
    state.recordingResult=null;
    state.recordingFinalizing=false;
    clearPendingRecording();
    state.focusMode=focusMode;
    resetReadingSession();
    buildStaff();
    renderPracticeControls();
    // stop() ran while the previous focus was active. Recompute the audio
    // entry buttons after state.focusMode has changed so reading cannot expose
    // the normal phrase transport as a primary action.
    setAudioEntriesPending(false);
    savePracticePreferences();
    renderRecords();
  }

  function renderFocusDiagnosis(attempts){
    const view=practiceFocusDiagnosis(attempts,{
      phraseId:state.phrase.id,start:state.range.start,end:state.range.end,tempo:Number($("tempo").value)
    });
    const list=$("focus-status-list");
    list.replaceChildren();
    for(const [focusMode,label] of Object.entries(FOCUS_MODES)){
      const status=view.statuses[focusMode].status;
      const item=document.createElement("li");
      item.dataset.focusStatus=focusMode;
      item.textContent=label+"："+(status==="success"?"達成（自己評価）":status==="fail"?"要復習（自己評価）":"未記録");
      list.append(item);
    }
    $("focus-diagnosis-text").textContent=view.message;
  }

  function renderPracticeControls(){
    $("range-start").value=String(state.range.start);
    $("focus-mode").value=state.focusMode;
    $("focus-description").textContent=FOCUS_DESCRIPTIONS[state.focusMode];
    $("record-clean").textContent=FOCUS_SUCCESS_LABELS[state.focusMode];
    const resultHints={
      reading:"自己評価の記録です。譜読み確認を終えると達成を記録できます。演奏音の自動採点は行いません。",
      rhythm:"自己評価の記録です。中立音に拍・細分を合わせた結果を記録します。正しい音高は成功条件にしません。",
      execution:"自己評価の記録です。動作・発音の再現を記録します。録音時は聴き返しレビューを行えます。",
      integrated:"自己評価の記録です。演奏音の自動採点は行いません。「統合して弾けた」は選択区間を最後まで再生した後に記録できます。"
    };
    $("record-hint").textContent=resultHints[state.focusMode];
    document.body.dataset.focus=state.focusMode;
    const rhythmFocus=state.focusMode==="rhythm";
    $("backing-chords").disabled=state.calibrating||rhythmFocus;
    $("backing-bass").disabled=state.calibrating||rhythmFocus;
    $("range-end").value=String(state.range.end);
    $("range-previous").disabled=state.calibrating||state.range.start===1;
    $("range-next").disabled=state.calibrating||state.range.end===state.phrase.measures;
    $("count-in").value=String(state.countIn);
    $("assist-mode").value=state.assist;
    $("melody-toggle").textContent=(state.focusMode==="rhythm"?"♪ リズムガイド ":"♪ お手本メロディ ")+(state.melody?"ON":"OFF");
    $("melody-toggle").setAttribute("aria-pressed",String(state.melody));
    $("melody-toggle").classList.toggle("active",state.melody);
    document.body.dataset.assist=state.assist;
    const focusNotation=state.focusMode==="reading"||state.focusMode==="rhythm";
    const memory=state.assist==="memory"&&!focusNotation;
    $("staff").hidden=memory;
    $("memory-cover").hidden=!memory;
    $("tab-panel").hidden=focusNotation||memory||state.assist==="staff";
    document.querySelector(".note-trainer").hidden=focusNotation||memory||state.assist==="staff";
    $("chord-progression").hidden=memory;
    $("staff").querySelectorAll(".staff-system").forEach(svg=>{
      const measure=Number(svg.dataset.measure)+1;
      const inside=measure>=state.range.start&&measure<=state.range.end;
      svg.parentElement.classList.toggle("in-range",inside);
      svg.parentElement.classList.toggle("outside-range",!inside);
    });
    highlightNote(state.noteIndex);
    highlightMeasure(measureForNote(state.noteIndex));
    $("practice-status").textContent=rangeLabel()+"を練習 / "+FOCUS_MODES[state.focusMode]+" / "+ASSIST_LABELS[state.assist];
    renderReadingFocus();
    // Keep one source of truth for focus-specific audio entry availability.
    // This prevents range/assist redraws from re-enabling recording in rhythm.
    setAudioEntriesPending(state.starting);
  }

  function changeRange(start,end){
    if(state.calibrating) return;
    stop();
    state.range=practiceRange(state.phrase.measures,start,end);
    resetReadingSession();
    state.noteIndex=state.measures[state.range.start-1][0].globalIndex;
    renderCurrentNote();
    renderPracticeControls();
    savePracticePreferences();
    renderRecords();
  }

  function shiftRange(direction){
    const width=state.range.end-state.range.start+1;
    const start=Math.max(1,Math.min(state.phrase.measures-width+1,state.range.start+direction*width));
    changeRange(start,start+width-1);
  }

  function changeAssist(assist){
    if(state.calibrating) return;
    stop();
    state.assist=assist;
    if(assist==="memory") state.melody=false;
    buildStaff();
    renderPracticeControls();
    savePracticePreferences();
    renderRecords();
  }

  function conditionsLabel(c){
    const focusMode=c.focusMode??"integrated";
    return FOCUS_MODES[focusMode]+"・"+rangeLabel(c)+"・"+c.tempo+" BPM・"+ASSIST_LABELS[c.assist]+"・"+focusMelodyLabel(focusMode,c.melody);
  }

  function renderRecords(){
    if(!state.phrase) return;
    const pending=state.pending?.phraseId===state.phrase.id?state.pending:null;
    renderRecordingMonitor();
    $("attempt-summary").textContent=state.running?"練習中です。停止後に結果を記録できます。":pending
      ?conditionsLabel(pending.conditions)+" / "+(pending.conditions.focusMode==="reading"?"譜読み確認完了":pending.observed.completedLoops+"回再生完了")+(state.recordingFinalizing?" / 録音確定中":"")
      :state.focusMode==="reading"?"答えを見る→次の音、で譜読み確認を終えると自己評価を記録できます。":"再生して練習すると、条件と結果を記録できます。";
    const reviewReady=!state.pendingRecording||Boolean(readSelfReview());
    const cleanReady=pending&&(pending.conditions.focusMode==="reading"||pending.observed.transportCompleted);
    $("record-clean").disabled=state.saving||state.running||state.recordingFinalizing||!reviewReady||!cleanReady;
    $("record-repeat").disabled=state.saving||state.running||state.recordingFinalizing||!reviewReady||!pending;
    const attempts=state.attempts.filter(item=>item.phraseId===state.phrase.id);
    $("practice-advice").textContent=practiceAdvice(attempts,practiceConditions());
    renderFocusDiagnosis(attempts);
    const recent=[...attempts].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,10);
    clearHistoryRecordingUrls();
    $("attempt-list").replaceChildren();
    if(!recent.length){
      const item=document.createElement("li");
      item.textContent="このフレーズの記録はまだありません。";
      $("attempt-list").append(item);
    }
    for(const attempt of recent){
      const item=document.createElement("li");
      item.textContent=new Date(attempt.date).toLocaleString("ja-JP")+" — "+focusResultLabel(attempt.conditions.focusMode,attempt.reported.clean);
      const detail=document.createElement("small");
      detail.textContent=conditionsLabel(attempt.conditions)+" / "+practiceHistoryCompletionLabel(attempt);
      item.append(detail);
      const recording=state.recordings.get(attempt.id);
      if(recording){
        const audio=document.createElement("audio");
        const url=URL.createObjectURL(recording.blob);
        state.historyRecordingUrls.push(url);
        audio.controls=true;
        audio.preload="metadata";
        audio.src=url;
        audio.setAttribute("aria-label","この練習の録音");
        item.append(audio);
        const remove=document.createElement("button");
        remove.type="button";
        remove.textContent="この録音を削除";
        remove.addEventListener("click",()=>void deleteSavedRecording(attempt.id));
        item.append(remove);
      }
      $("attempt-list").append(item);
    }
  }

  async function deleteSavedRecording(attemptId){
    if(state.calibrating) return;
    try{
      await state.store.deleteRecording(attemptId);
      state.recordings.delete(attemptId);
      $("record-status").textContent="録音をこの端末から削除しました。練習記録は残しています。";
      renderRecords();
    }catch{
      $("record-status").textContent="録音を削除できませんでした。もう一度お試しください。";
    }
  }

  function deletePendingRecording(){
    if(!state.pendingRecording||state.calibrating) return;
    clearPendingRecording();
    $("recording-status").textContent="今回の録音を削除しました。練習結果はそのまま記録できます。";
    renderRecords();
  }

  function retryRecording(){
    if(state.running||state.starting||state.saving||state.recordingFinalizing||state.calibrating) return;
    state.pending=null;
    clearPendingRecording();
    renderRecords();
    void play(true);
  }

  async function saveRecord(clean){
    const pending=state.pending;
    if(state.saving||state.running||state.recordingFinalizing||state.calibrating||!pending||pending.phraseId!==state.phrase.id) return;
    const review=readSelfReview();
    if(state.pendingRecording&&review===null){
      $("record-status").textContent="録音を聴き返し、4項目の自己レビューを選んでください。";
      return;
    }
    state.saving=true;
    renderRecords();
    try{
      const reported=review?{clean,review}:{clean};
      const record=validateAttempt({...pending,reported});
      const recording=state.pendingRecording?.attemptId===pending.id?state.pendingRecording:null;
      await state.store.saveAttempt(record,recording);
      if(recording) state.recordings.set(recording.attemptId,recording);
      state.attempts=await state.store.all();
      if(state.pending?.id===pending.id){
        state.pending=null;
        clearPendingRecording();
        if(record.conditions.focusMode==="reading"){resetReadingSession();renderReadingFocus();}
      }
      $("record-status").textContent=recording
        ?"練習記録と録音をこの端末へ保存しました（自己評価）。"
        :"練習記録を保存しました（自己評価）。";
    }catch(error){
      const quota=error?.name==="QuotaExceededError"||error?.cause?.name==="QuotaExceededError";
      $("record-status").textContent=quota
        ?"端末の保存容量が不足しているため保存できませんでした。記録と録音は保存していません。今回の結果は残してありますので、不要な録音を削除して再試行してください。"
        :"記録を保存できませんでした。記録と録音は保存していません。今回の結果は残してありますので、もう一度お試しください。";
    }finally{
      state.saving=false;
      renderRecords();
    }
  }

  async function exportPractice(){
    try{
      const attempts=(await state.store.all()).map(validateAttempt);
      const blob=new Blob([JSON.stringify({format:"guitar-phrase-practice",version:1,attempts},null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");
      link.href=url;
      link.download="guitar-practice-"+new Date().toISOString().slice(0,10)+".json";
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      $("record-status").textContent=attempts.length+"件の記録を書き出しました。録音音声は含まれていません。";
    }catch{
      $("record-status").textContent="記録を書き出せませんでした。もう一度お試しください。";
    }
  }

  async function importPractice(file){
    if(!file) return;
    try{
      if(file.size>5_000_000) throw new Error("バックアップは5MB以下にしてください。");
      const attempts=parsePracticeBackup(await file.text());
      await state.store.addMany(attempts);
      state.attempts=await state.store.all();
      renderRecords();
      $("record-status").textContent="記録を読み込みました。重複を除き全"+state.attempts.length+"件です。端末内の録音は変更していません。";
    }catch(error){
      $("record-status").textContent="読み込めませんでした。既存の記録は保持しています。"+(error instanceof SyntaxError?"JSON形式を確認してください。":error.message);
    }finally{
      $("practice-file").value="";
    }
  }

  function getCurrentCalibrationTarget(inputRoute=state.currentInputRoute, outputRoute=state.currentOutputRoute, processing=state.currentInputProcessing){
    const resolvedInput=inputRoute||UNKNOWN_ROUTE;
    const resolvedOutput=outputRoute||resolveOutputRoute(state.audio);

    return createRouteTarget({
      pathKind:"roundTrip",
      inputRoute:resolvedInput,
      outputRoute:resolvedOutput,
      processing,
      timebase:{reference:"audio-context",observed:"audio-context"}
    });
  }

  function computeCalibrationStats(samples){
    if(!Array.isArray(samples)||samples.length===0){
      throw new TypeError("測定サンプルがありません。");
    }
    const diffs=samples.map(extractSampleOffsetMs);
    const sampleCount=diffs.length;
    const mean=diffs.reduce((sum,d)=>sum+d,0)/sampleCount;
    const variance=sampleCount>1
      ?diffs.reduce((sum,d)=>sum+(d-mean)**2,0)/(sampleCount-1)
      :0;
    const spreadMs=Math.sqrt(variance);
    return {
      sampleCount,
      offsetMs:Math.round(mean*10)/10,
      spreadMs:Math.round(spreadMs*10)/10
    };
  }

  function renderCalibration(){
    const badge=$("calibration-badge");
    const stateText=$("calibration-state-text");
    const offsetEl=$("calibration-offset");
    const spreadEl=$("calibration-spread");
    const messageEl=$("calibration-message");
    const resetBtn=$("reset-calibration");
    const startBtn=$("start-calibration");
    if(!badge||!stateText||!offsetEl||!spreadEl||!resetBtn) return;

    if(startBtn){
      startBtn.disabled=state.calibrating;
      startBtn.textContent=state.calibrating?"測定中…":"校正を測定";
    }

    if(state.calibrationState==="calibrated"&&state.activeCalibration){
      badge.textContent="校正済み";
      badge.className="calibration-badge calibrated";
      stateText.textContent="校正済み";
      const sign=state.activeCalibration.offsetMs>=0?"+":"";
      offsetEl.textContent=sign+state.activeCalibration.offsetMs.toFixed(1)+" ms";
      spreadEl.textContent=state.activeCalibration.precision.spreadMs.toFixed(1)+" ms";
      messageEl.textContent=state.calibrationMessage||"入出力レイテンシ校正済みです。";
      resetBtn.disabled=state.calibrating;
    }else if(state.calibrationState==="unmeasurable"){
      badge.textContent="測定不能";
      badge.className="calibration-badge unmeasurable";
      stateText.textContent="測定不能";
      offsetEl.textContent="—";
      spreadEl.textContent="—";
      messageEl.textContent=state.calibrationMessage||"測定に必要な信号が検出されませんでした。";
      resetBtn.disabled=true;
    }else{
      badge.textContent="未校正";
      badge.className="calibration-badge uncalibrated";
      stateText.textContent="未校正";
      offsetEl.textContent="—";
      spreadEl.textContent="—";
      messageEl.textContent=state.calibrationMessage||"";
      resetBtn.disabled=true;
    }
    setAudioEntriesPending(state.starting);
  }

  async function findApplicableStoredCalibration(target=getCurrentCalibrationTarget()){
    if(state.store){
      try{
        const all=await state.store.allCalibrations();
        const applicable=all.filter(r=>calibrationApplies(r,target));
        applicable.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
        if(applicable.length>0) return applicable[0];
      }catch(err){
        console.warn("[phrase] could not read calibrations from store:",err);
      }
    }
    if(state.activeCalibration&&calibrationApplies(state.activeCalibration,target)){
      return state.activeCalibration;
    }
    return null;
  }

  async function handleCalibrationUnmeasurable(reason, target=getCurrentCalibrationTarget()){
    const preserved=await findApplicableStoredCalibration(target);
    if(preserved){
      state.activeCalibration=preserved;
      state.calibrationState="calibrated";
      state.calibrationMessage=reason+"（前回の校正値を維持しています）";
      validateMeasurementResult({
        metric:"roundTrip-latency",
        state:"measured",
        value:preserved.offsetMs,
        unit:"ms",
        calibrationId:preserved.id,
        reason:null
      });
    }else{
      state.activeCalibration=null;
      state.calibrationState="unmeasurable";
      state.calibrationMessage=reason;
      validateMeasurementResult({
        metric:"roundTrip-latency",
        state:"unmeasurable",
        value:null,
        unit:"ms",
        calibrationId:null,
        reason
      });
    }
  }

  async function runCalibration(){
    if(state.calibrating) return;
    pauseMediaPlayback();
    await stop();
    if(state.recorder?.running){
      try{ await state.recorder.cancel(); }catch{}
    }
    state.calibrating=true;
    const calibrationRunId=++state.calibrationRunId;
    renderCalibration();

    try{
      await ensureAudio();
      if(calibrationRunId!==state.calibrationRunId) return;
      restoreMaster();
      let collectorResult;
      if(typeof window.__calibrationCollector==="function"){
        collectorResult=await window.__calibrationCollector();
      }else{
        collectorResult=await runAcousticCalibrationCollector({
          audioContext:state.audio,
          mediaDevices:navigator.mediaDevices,
          outputDestination:state.mix?.master||state.audio.destination,
          AudioWorkletNodeClass:window.AudioWorkletNode
        });
      }
      if(calibrationRunId!==state.calibrationRunId) return;

      const isTestMode=typeof window.__calibrationCollector==="function";
      const resolvedOutput=resolveOutputRoute(state.audio);
      const detectedInput=collectorResult?.route?.inputRoute||collectorResult?.inputRoute;
      const detectedOutput=collectorResult?.route?.outputRoute||collectorResult?.outputRoute;
      const detectedProcessing=collectorResult?.route?.processing||collectorResult?.processing||(isTestMode?{
        echoCancellation:false,
        noiseSuppression:false,
        autoGainControl:false,
        rawCaptureVerified:true
      }:null);
      const inputRoute=detectedInput||state.currentInputRoute||(isTestMode?"test-mic":UNKNOWN_ROUTE);
      const outputRoute=detectedOutput||state.currentOutputRoute||(isTestMode?"test-speaker":resolvedOutput);
      if(inputRoute!==UNKNOWN_ROUTE) state.currentInputRoute=inputRoute;
      if(outputRoute!==UNKNOWN_ROUTE) state.currentOutputRoute=outputRoute;
      if(detectedProcessing) state.currentInputProcessing=detectedProcessing;
      const currentTarget=getCurrentCalibrationTarget(state.currentInputRoute,state.currentOutputRoute,state.currentInputProcessing);

      if(collectorResult?.error){
        const errReason=typeof collectorResult.error==="string"
          ?collectorResult.error
          :(collectorResult.error?.message||"校正処理中にエラーが発生しました。");
        await handleCalibrationUnmeasurable(errReason, currentTarget);
        return;
      }

      if(collectorResult?.unmeasurable){
        const unmeasurableReason=collectorResult.reason||"測定に必要な信号が検出されませんでした。";
        await handleCalibrationUnmeasurable(unmeasurableReason, currentTarget);
        return;
      }

      if(!collectorResult?.samples||!Array.isArray(collectorResult.samples)||collectorResult.samples.length===0){
        await handleCalibrationUnmeasurable("測定サンプルが取得できませんでした。", currentTarget);
        return;
      }

      const {sampleCount,offsetMs,spreadMs}=computeCalibrationStats(collectorResult.samples);
      const hasKnownRoutes=isKnownRoute(inputRoute)&&isKnownRoute(outputRoute);
      const isCalibrated=hasKnownRoutes&&sampleCount>=MIN_CALIBRATION_SAMPLES&&spreadMs<=MAX_CALIBRATION_SPREAD_MS;
      const status=isCalibrated?"calibrated":"uncalibrated";

      const record=validateCalibrationRecord({
        id:"cal-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),
        createdAt:new Date().toISOString(),
        pathKind:"roundTrip",
        timebase:{
          reference:"audio-context",
          observed:"audio-context"
        },
        offsetMs,
        signConvention:SIGN_CONVENTION,
        sampleCount,
        precision:{
          spreadMs,
          method:"stddev"
        },
        environment:{
          inputRoute,
          outputRoute,
          ...(state.currentInputProcessing?{processing:state.currentInputProcessing}:{})
        },
        status,
        validity:{
          invalidatedAt:null,
          reason:null
        }
      });

      if(state.store){
        if(isCalibrated){
          let superseded=[];
          try{
            const existing=await state.store.allCalibrations();
            const previous=existing.filter(r=>calibrationApplies(r,currentTarget));
            superseded=previous.map(prev=>invalidateCalibration(prev,{
              at:record.createdAt,
              reason:"新しい校正による更新"
            }));
          }catch(err){
            console.warn("[phrase] could not query older calibrations:",err);
          }
          if(typeof state.store.replaceCalibration==="function"){
            await state.store.replaceCalibration(record,superseded);
          }else{
            await state.store.saveCalibration(record);
            for(const s of superseded){
              try{ await state.store.saveCalibration(s); }catch{}
            }
          }
        }else{
          await state.store.saveCalibration(record);
        }
      }

      if(calibrationRunId!==state.calibrationRunId) return;

      if(isCalibrated){
        state.activeCalibration=record;
        state.calibrationState="calibrated";
        state.calibrationMessage="校正完了: オフセット "+(offsetMs>=0?"+":"")+offsetMs.toFixed(1)+" ms, ばらつき "+spreadMs.toFixed(1)+" ms ("+sampleCount+"回測定)";
        validateMeasurementResult({
          metric:"roundTrip-latency",
          state:"measured",
          value:offsetMs,
          unit:"ms",
          calibrationId:record.id,
          reason:null
        });
      }else{
        let explanation="";
        if(!hasKnownRoutes){
          explanation="入出力オーディオルートが特定できないため校正を確定できませんでした。マイクとスピーカーのデバイス接続を確認してください。";
        }else if(sampleCount<MIN_CALIBRATION_SAMPLES){
          explanation="サンプル数が不足しているため校正できませんでした（"+sampleCount+" / 最低 "+MIN_CALIBRATION_SAMPLES+"回）。";
        }else{
          explanation="ばらつきが許容値（"+MAX_CALIBRATION_SPREAD_MS+" ms）を超えているため校正できませんでした（ばらつき: "+spreadMs.toFixed(1)+" ms）。静かな環境で再試行してください。";
        }
        const preserved=await findApplicableStoredCalibration(currentTarget);
        if(preserved){
          state.activeCalibration=preserved;
          state.calibrationState="calibrated";
          state.calibrationMessage=explanation+"（前回の校正値を維持しています）";
          validateMeasurementResult({
            metric:"roundTrip-latency",
            state:"measured",
            value:preserved.offsetMs,
            unit:"ms",
            calibrationId:preserved.id,
            reason:null
          });
        }else{
          state.activeCalibration=null;
          state.calibrationState="uncalibrated";
          state.calibrationMessage=explanation;
          validateMeasurementResult({
            metric:"roundTrip-latency",
            state:"uncalibrated",
            value:offsetMs,
            unit:"ms",
            calibrationId:null,
            reason:explanation
          });
        }
      }
    }catch(err){
      if(calibrationRunId===state.calibrationRunId){
        await handleCalibrationUnmeasurable("校正中にエラーが発生しました。静かな環境で再試行してください。", getCurrentCalibrationTarget());
      }
    }finally{
      if(calibrationRunId===state.calibrationRunId){
        state.calibrating=false;
        renderCalibration();
      }
    }
  }

  async function resetCalibration(){
    state.calibrationRunId++;
    state.calibrating=false;
    const target=getCurrentCalibrationTarget();
    if(state.store){
      try{
        const all=await state.store.allCalibrations();
        const applicable=all.filter(r=>calibrationApplies(r,target));
        const invalidated=applicable.map(r=>invalidateCalibration(r,{
          at:new Date().toISOString(),
          reason:"ユーザー操作によるリセット"
        }));
        if(typeof state.store.saveCalibrations==="function"){
          await state.store.saveCalibrations(invalidated);
        }else{
          for(const inv of invalidated){
            await state.store.saveCalibration(inv);
          }
        }
      }catch(err){
        console.warn("[phrase] could not persist calibration invalidation:",err);
        state.calibrationMessage="校正をリセットできませんでした。もう一度お試しください。";
        renderCalibration();
        return;
      }
    }
    state.currentInputRoute=null;
    state.currentOutputRoute=null;
    state.currentInputProcessing=null;
    state.activeCalibration=null;
    state.calibrationState="uncalibrated";
    state.calibrationMessage="校正をリセットしました。";
    renderCalibration();
  }

  async function loadCalibrations(){
    if(!state.store) return;
    try{
      const target=getCurrentCalibrationTarget();
      const applicable=await findApplicableStoredCalibration(target);
      if(applicable){
        state.activeCalibration=applicable;
        state.calibrationState="calibrated";
        state.calibrationMessage="";
      }else{
        state.activeCalibration=null;
        state.calibrationState="uncalibrated";
      }
    }catch(err){
      console.warn("[phrase] could not load calibrations:",err);
      state.activeCalibration=null;
      state.calibrationState="uncalibrated";
    }
    renderCalibration();
  }

  function bindPracticeEvents(){
    $("focus-mode").addEventListener("change",event=>changeFocus(event.target.value));
    $("reading-reveal").addEventListener("click",revealReadingAnswer);
    $("reading-next").addEventListener("click",advanceReadingFocus);
    $("range-start").addEventListener("change",event=>changeRange(event.target.value,state.range.end));
    $("range-end").addEventListener("change",event=>changeRange(Math.min(state.range.start,Number(event.target.value)),event.target.value));
    $("range-one").addEventListener("click",()=>changeRange(state.range.start,state.range.start));
    $("range-two").addEventListener("click",()=>changeRange(state.range.start,state.range.start+1));
    $("range-all").addEventListener("click",()=>changeRange(1,state.phrase.measures));
    $("range-previous").addEventListener("click",()=>shiftRange(-1));
    $("range-next").addEventListener("click",()=>shiftRange(1));
    $("assist-mode").addEventListener("change",event=>changeAssist(event.target.value));
    $("reveal-score").addEventListener("click",()=>changeAssist("full"));
    $("count-in").addEventListener("change",event=>{
      if(state.calibrating) return;
      stop();state.countIn=Number(event.target.value);savePracticePreferences();renderRecords();
    });
    $("melody-toggle").addEventListener("click",()=>{
      if(state.calibrating) return;
      stop();state.melody=!state.melody;renderPracticeControls();savePracticePreferences();renderRecords();
    });
    for(const key of SELF_REVIEW_KEYS) $("review-"+key).addEventListener("change",renderRecords);
    $("delete-recording").addEventListener("click",deletePendingRecording);
    $("retry-recording").addEventListener("click",retryRecording);
    $("record-clean").addEventListener("click",()=>void saveRecord(true));
    $("record-repeat").addEventListener("click",()=>void saveRecord(false));
    $("export-practice").addEventListener("click",()=>void exportPractice());
    $("import-practice").addEventListener("click",()=>$("practice-file").click());
    $("practice-file").addEventListener("change",event=>void importPractice(event.target.files[0]));
    $("start-calibration").addEventListener("click",()=>void runCalibration());
    $("reset-calibration").addEventListener("click",()=>void resetCalibration());
    document.addEventListener("play",event=>{
      if(state.calibrating&&event.target&&typeof event.target.pause==="function"){
        try{ event.target.pause(); }catch{}
      }
    },true);
    document.addEventListener("visibilitychange",()=>{
      if(document.hidden) stop();
    });
    window.addEventListener("pagehide",()=>stop());
  }

  async function bootstrap(){
    try{
      renderSoundMode();
      state.recorder=createRecorder({
        mediaDevices:navigator.mediaDevices,
        MediaRecorderClass:window.MediaRecorder,
        onLimit:result=>attachRecordingResult(state.recordingRunId,result,true),
        onError:handleRecorderError
      });
      // A load event does not guarantee that the asynchronous lesson fetch has
      // finished. Accept audio actions now and let them await the same data.
      state.ready=loadData();
      $("play").addEventListener("click",()=>play().catch(alert));
      $("record-play").addEventListener("click",()=>void play(true));
      $("stop").addEventListener("click",()=>stop());
      $("play-note").addEventListener("click",()=>playOne().catch(alert));
      $("preview-backing").addEventListener("click",()=>previewBacking().catch(alert));
      await state.ready;
      buildSelect();
      try{
        const saved=JSON.parse(localStorage.getItem(PRACTICE_KEY)||"{}");
        if(saved&&typeof saved==="object") state.preferences=saved;
      }catch{}
      state.index=Math.max(0,state.data.phrases.findIndex(phrase=>phrase.id===state.preferences.selected));
      renderPhrase();
      renderCalibration();
      bindPracticeEvents();
      try{
        state.store=createPracticeStore(window.indexedDB);
        void state.store.all().then(attempts=>{
          state.attempts=attempts;renderRecords();
        }).catch(()=>{
          $("record-status").textContent="練習記録を読み込めませんでした。再生は利用できます。";
        });
        void state.store.allRecordings().then(recordings=>{
          state.recordings=new Map(recordings.map(recording=>[recording.attemptId,recording]));
          renderRecords();
        }).catch(()=>{
          $("record-status").textContent="端末内の録音を読み込めませんでした。通常の練習記録と再生は利用できます。";
        });
        void loadCalibrations();
      }catch{
        $("record-status").textContent="練習記録を読み込めませんでした。再生は利用できます。";
        renderCalibration();
      }

      $("phrase-select").addEventListener("change",(e)=>{
        if(state.calibrating) return;
        state.index=Number(e.target.value);
        renderPhrase();
        savePracticePreferences();
      });
      $("tempo").addEventListener("input",(e)=>{
        if(state.calibrating) return;
        stop();$("tempo-label").textContent=e.target.value;savePracticePreferences();renderRecords();
      });
      $("sound-mode-toggle").addEventListener("click",toggleSoundMode);
      $("loop").addEventListener("click",()=>{
        if(state.calibrating) return;
        stop();
        state.loop=!state.loop;
        $("loop").setAttribute("aria-pressed",String(state.loop));
        $("loop").textContent=state.loop?"↻ ループON":"↻ ループOFF";
      });
      $("previous-note").addEventListener("click",()=>moveNote(-1));
      $("next-note").addEventListener("click",()=>moveNote(1));
      $("follow-toggle").addEventListener("click",()=>{
        state.follow=!state.follow;
        $("follow-toggle").setAttribute("aria-pressed",String(state.follow));
        $("follow-toggle").textContent=state.follow?"⇅ 追従ON":"⇅ 追従OFF";
        if(state.follow) followScore(measureForNote(state.noteIndex),true);
      });
      $("backing-chords").addEventListener("click",()=>toggleBacking("chords"));
      $("backing-bass").addEventListener("click",()=>toggleBacking("bass"));
      $("backing-drums").addEventListener("click",()=>toggleBacking("drums"));

      if(navigator.mediaDevices?.addEventListener){
        navigator.mediaDevices.addEventListener("devicechange",()=>{
          // Invalidate active in-memory calibration if physical route identity changes
          state.currentInputRoute=null;
          state.currentOutputRoute=null;
          state.currentInputProcessing=null;
          void loadCalibrations();
        });
      }

      window.addEventListener("fingerstyle:set-input-route",(e)=>{
        state.currentInputRoute=e.detail?.inputRoute||null;
        if(e.detail?.processing!==undefined){
          state.currentInputProcessing=e.detail.processing;
        }else if(state.currentInputRoute==="test-mic"){
          state.currentInputProcessing={
            echoCancellation:false,
            noiseSuppression:false,
            autoGainControl:false,
            rawCaptureVerified:true
          };
        }
        void loadCalibrations();
      });

      window.addEventListener("fingerstyle:set-route",(e)=>{
        state.currentInputRoute=e.detail?.inputRoute||null;
        state.currentOutputRoute=e.detail?.outputRoute||null;
        if(e.detail?.processing!==undefined){
          state.currentInputProcessing=e.detail.processing;
        }else if(state.currentInputRoute==="test-mic"){
          state.currentInputProcessing={
            echoCancellation:false,
            noiseSuppression:false,
            autoGainControl:false,
            rawCaptureVerified:true
          };
        }
        void loadCalibrations();
      });
    }catch(error){
      document.body.insertAdjacentHTML("beforeend",'<p style="padding:16px;color:#9e3f2f">'+escapeHtml(error.message)+"</p>");
    }
  }

  bootstrap();
})();
