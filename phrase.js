import { createSamplePlayer } from "./core/sample-player.js";
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
  const state = {
    data:null, phrase:null, model:null, index:0, noteIndex:0,
    audio:null, noiseBuffer:null, mix:null, samplePlayer:null,
    running:false, starting:false, loop:false, follow:true,
    soundMode:readSoundMode(),
    backing:{ chords:true, bass:true, drums:true },
    scheduler:null, raf:null, previewTimer:null,
    nextTick:0, nextTickTime:0, finished:false,
    followedMeasure:-1,
    chordStroke:0,
    visualQueue:[], noteStarts:new Map(), measures:[]
  };

  const MASTER_LEVEL=.78;
  const PHRASE_SAMPLES=["nylonGuitar","electricBass","kick","snare","closedHat","openHat"];
  const TICKS_PER_BEAT=12;
  const EIGHTH_TICKS=TICKS_PER_BEAT/2;

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

  function buildNoteStarts(){
    state.noteStarts=new Map();
    const ties=state.model.notations.filter(notation=>notation.type==="tie");
    const tieFrom=new Map(ties.map(tie=>[tie.from,tie.to]));
    const tieTargets=new Set(ties.map(tie=>tie.to));
    const tiedDuration=(note)=>{
      let beats=Number(note.beats);
      let nextId=tieFrom.get(note.id);
      const visited=new Set();
      while(nextId&&!visited.has(nextId)){
        visited.add(nextId);
        const next=state.model.noteById.get(nextId);
        if(!next) break;
        beats+=Number(next.beats);
        nextId=tieFrom.get(next.id);
      }
      return beats;
    };

    let tick=0;
    state.model.notes.forEach((note,index)=>{
      if(!state.noteStarts.has(tick)) state.noteStarts.set(tick,[]);
      state.noteStarts.get(tick).push({
        note,index,attack:!tieTargets.has(note.id),durationBeats:tiedDuration(note)
      });
      const durationTicks=Number(note.beats)*TICKS_PER_BEAT;
      if(Math.abs(durationTicks-Math.round(durationTicks))>1e-9){
        throw new Error("この音価は再生解像度に対応していません: "+note.beats);
      }
      tick+=Math.round(durationTicks);
    });
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
    renderScore(host,state.model,{
      engraver:window.VexFlow,
      onSelectNote(index){
        state.noteIndex=index;
        renderCurrentNote();
        highlightNote(index);
        highlightMeasure(measureForNote(index));
      }
    });
  }

  function renderPhrase(){
    stop();
    state.phrase=state.data.phrases[state.index];
    state.noteIndex=0;
    state.followedMeasure=-1;
    $("phrase-select").value=String(state.index);
    $("phrase-title").textContent=state.phrase.title;
    $("phrase-subtitle").textContent=state.phrase.subtitle;
    $("phrase-objective").textContent=state.phrase.objective;
    $("tempo").value=state.phrase.bpm;
    $("tempo-label").textContent=state.phrase.bpm;
    $("right-hand").textContent=state.phrase.rightHand;
    splitMeasures();
    buildNoteStarts();
    buildMeta();
    buildStaff();
    buildTab();
    renderCurrentNote();
    highlightNote(0);
    highlightMeasure(0);
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
    if(!state.follow) return;
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

  function setAudioEntriesPending(pending){
    const playButton=$("play");
    const noteButton=$("play-note");
    const backingButton=$("preview-backing");
    if(playButton) playButton.disabled=pending||state.running;
    if(noteButton) noteButton.disabled=pending;
    if(backingButton) backingButton.disabled=pending;
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
    osc.start(time);
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
      if(sampled) return;

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
    if(sampled) return;

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
    fundamental.start(time);
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
    if(sampled) return;

    const osc=state.audio.createOscillator();
    const gain=state.audio.createGain();

    osc.type="sine";
    osc.frequency.setValueAtTime(145,time);
    osc.frequency.exponentialRampToValueAtTime(52,time+.12);
    gain.gain.setValueAtTime(.15,time);
    gain.gain.exponentialRampToValueAtTime(.0001,time+.14);

    osc.connect(gain);
    gain.connect(state.mix.drums);
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
    if(sampled) return;

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

  function scheduleBackingGrid(inBar,time,chord){
    const spb=secondsPerBeat();
    const chordHits=chordPattern(state.phrase.groove);

    if(state.backing.chords && chordHits.has(inBar)){
      scheduleChord(chord,time,spb*.82,chordHits.get(inBar));
    }

    if(state.backing.bass && (inBar===0||inBar===4)){
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

  function totalPhraseTicks(){
    return Math.round(state.phrase.measures*state.model.beatsPerBar*TICKS_PER_BEAT);
  }

  function scheduleTick(tick,time){
    const spb=secondsPerBeat();
    const ticksPerBar=state.model.beatsPerBar*TICKS_PER_BEAT;
    const measure=Math.floor(tick/ticksPerBar);
    const inBarTick=tick%ticksPerBar;
    const chord=state.phrase.chords[measure];

    const starts=state.noteStarts.get(tick)||[];
    starts.forEach(({note,index,attack,durationBeats})=>{
      if(attack) scheduleMelody(note,time,durationBeats*spb);
      state.visualQueue.push({time,index,measure,tick});
    });

    if(inBarTick%EIGHTH_TICKS===0){
      scheduleBackingGrid(inBarTick/EIGHTH_TICKS,time,chord);
    }
  }

  function schedulerTick(){
    if(!state.running||!state.audio) return;
    const ahead=state.audio.currentTime+.16;

    while(!state.finished && state.nextTickTime<ahead){
      scheduleTick(state.nextTick,state.nextTickTime);
      state.nextTickTime+=secondsPerBeat()/TICKS_PER_BEAT;
      state.nextTick+=1;

      if(state.nextTick>=totalPhraseTicks()){
        if(state.loop){
          state.nextTick=0;
        }else{
          state.finished=true;
        }
      }
    }
  }

  function visualLoop(){
    if(!state.running||!state.audio) return;
    const now=state.audio.currentTime;

    while(state.visualQueue.length&&state.visualQueue[0].time<=now){
      const event=state.visualQueue.shift();
      state.noteIndex=event.index;
      renderCurrentNote();
      highlightNote(event.index);
      highlightMeasure(event.measure);
      followScore(event.measure);
      updateProgress((event.tick/totalPhraseTicks())*100);
    }

    if(state.finished&&state.visualQueue.length===0&&now>state.nextTickTime){
      updateProgress(100);
      stop(false);
      return;
    }
    state.raf=requestAnimationFrame(visualLoop);
  }

  async function play(){
    if(state.running||state.starting) return;
    state.starting=true;
    setAudioEntriesPending(true);
    try{
      await ensureAudio(["nylonGuitar",...backingSampleNames()]);
      restoreMaster();

      state.running=true;
      state.nextTick=0;
      state.nextTickTime=state.audio.currentTime+.08;
      state.visualQueue.length=0;
      state.finished=false;
      state.followedMeasure=-1;
      state.chordStroke=0;

      $("stop").disabled=false;

      schedulerTick();
      state.scheduler=setInterval(schedulerTick,25);
      state.raf=requestAnimationFrame(visualLoop);
    }finally{
      state.starting=false;
      setAudioEntriesPending(false);
    }
  }

  // stop() ducks the master bus for ~120ms to swallow the tail of notes already
  // handed to the audio clock. Anything started inside that window would be
  // swallowed with them, so every entry point that schedules audio clears the
  // duck first. Measured before this existed: a note started 60-103ms after a
  // stop played through a master gain of 0.0001, i.e. was silent.
  function restoreMaster(){
    if(!state.mix||!state.audio) return;
    const gain=state.mix.master.gain;
    const now=state.audio.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(MASTER_LEVEL,now);
  }

  // Notes are handed to the audio clock up to a lookahead ahead of time and
  // cannot be un-scheduled, so duck the master bus briefly instead of letting
  // them ring on after the stop button.
  function silenceTail(){
    if(!state.mix||!state.audio) return;
    const gain=state.mix.master.gain;
    const now=state.audio.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value,now);
    gain.linearRampToValueAtTime(.0001,now+.06);
    gain.setValueAtTime(MASTER_LEVEL,now+.12);
  }

  function stop(resetProgress=true){
    if(state.running) silenceTail();
    state.running=false;
    if(state.scheduler) clearInterval(state.scheduler);
    if(state.raf) cancelAnimationFrame(state.raf);
    state.scheduler=null;
    state.raf=null;
    state.visualQueue.length=0;
    state.finished=false;
    state.followedMeasure=-1;

    setAudioEntriesPending(false);
    $("stop").disabled=true;
    if(resetProgress) updateProgress(0);
  }

  async function playOne(){
    if(state.starting) return;
    state.starting=true;
    setAudioEntriesPending(true);
    try{
      await ensureAudio(["nylonGuitar"]);
      restoreMaster();
      const note=state.model.notes[state.noteIndex];
      scheduleMelody(note,state.audio.currentTime+.02,Number(note.beats)*secondsPerBeat());
      highlightNote(state.noteIndex);
    }finally{
      state.starting=false;
      setAudioEntriesPending(false);
    }
  }

  async function previewBacking(){
    if(state.starting) return;
    state.starting=true;
    setAudioEntriesPending(true);
    try{
      await ensureAudio(backingSampleNames());
      restoreMaster();
      const measure=measureForNote(state.noteIndex);
      const chord=state.phrase.chords[measure];
      const start=state.audio.currentTime+.05;
      const step=secondsPerBeat()/2;
      state.chordStroke=0;

      for(let inBar=0;inBar<8;inBar++){
        scheduleBackingGrid(inBar,start+inBar*step,chord);
      }

      const button=$("preview-backing");
      if(button){
        button.textContent="♪ M"+(measure+1)+" "+chord+" 再生中";
        if(state.previewTimer) window.clearTimeout(state.previewTimer);
        state.previewTimer=window.setTimeout(()=>{
          button.textContent="▶ 伴奏だけ1小節";
          state.previewTimer=null;
        },Math.ceil(step*8*1000)+150);
      }
    }finally{
      state.starting=false;
      setAudioEntriesPending(false);
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
    state.backing[type]=!state.backing[type];
    const id=type==="chords"?"backing-chords":type==="bass"?"backing-bass":"backing-drums";
    const labels={chords:"♬ コード",bass:"● ベース",drums:"◉ ドラム"};
    const button=$(id);

    button.classList.toggle("active",state.backing[type]);
    button.setAttribute("aria-pressed",String(state.backing[type]));
    button.textContent=labels[type]+" "+(state.backing[type]?"ON":"OFF");
  }

  async function bootstrap(){
    try{
      renderSoundMode();
      await loadData();
      buildSelect();
      renderPhrase();

      $("phrase-select").addEventListener("change",(e)=>{
        state.index=Number(e.target.value);
        renderPhrase();
      });
      $("tempo").addEventListener("input",(e)=>$("tempo-label").textContent=e.target.value);
      $("sound-mode-toggle").addEventListener("click",toggleSoundMode);
      $("play").addEventListener("click",()=>play().catch(alert));
      $("stop").addEventListener("click",()=>stop());
      $("loop").addEventListener("click",()=>{
        state.loop=!state.loop;
        $("loop").setAttribute("aria-pressed",String(state.loop));
        $("loop").textContent=state.loop?"↻ ループON":"↻ ループOFF";
      });
      $("play-note").addEventListener("click",()=>playOne().catch(alert));
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
      $("preview-backing")?.addEventListener("click",()=>previewBacking().catch(alert));
    }catch(error){
      document.body.insertAdjacentHTML("beforeend",'<p style="padding:16px;color:#9e3f2f">'+escapeHtml(error.message)+"</p>");
    }
  }

  bootstrap();
})();
