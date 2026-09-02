import { createSamplePlayer } from "./core/sample-player.js";

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SOUND_MODE_KEY="fingerstyle-sound-mode";
  const state = {
    data:null, phrase:null, index:0, noteIndex:0,
    audio:null, noiseBuffer:null, mix:null, samplePlayer:null, sampleLoad:null,
    running:false, starting:false, loop:false, follow:true,
    soundMode:readSoundMode(),
    backing:{ chords:true, bass:true, drums:true },
    scheduler:null, raf:null, previewTimer:null,
    nextGrid:0, nextGridTime:0, finished:false,
    followedMeasure:-1,
    visualQueue:[], noteStarts:new Map(), measures:[],
    layout:null
  };

  const MASTER_LEVEL=.78;
  const PHRASE_SAMPLES=["nylonGuitar","electricBass","kick","snare","closedHat"];
  const MIDDLE_LINE_Y=90;
  const STEM_LENGTH=35;

  const pitchClass = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 };
  const diatonicLetter = { C:0,D:1,E:2,F:3,G:4,A:5,B:6 };
  const stringLabels = ["e","B","G","D","A","E"];
  const grooveLabels = { straight8:"Straight 8", rock8:"Rock 8" };
  const rootBaseMidi = {
    C:48,"C#":49,Db:49,D:50,"D#":51,Eb:51,E:52,F:53,"F#":54,Gb:54,
    G:55,"G#":56,Ab:56,A:57,"A#":58,Bb:58,B:59
  };

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
    if(!real) status="idle";
    const labels={
      idle:real?"音色：リアル":"音色：合成",
      loading:"音色：読込中…",
      partial:"音色：リアル（一部）",
      failed:"音源失敗：合成"
    };
    const notes={
      idle:real?"ナイロンギター・エレキベース・生ドラム":"通信不要の軽量な合成音",
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

  async function prepareRealSamples(){
    if(state.soundMode!=="samples"||!state.audio) return;
    if(!state.samplePlayer){
      state.samplePlayer=createSamplePlayer({context:state.audio,fetchArrayBuffer});
    }
    if(!state.sampleLoad){
      renderSoundMode("loading");
      state.sampleLoad=state.samplePlayer.load(PHRASE_SAMPLES).finally(()=>{
        state.sampleLoad=null;
      });
    }
    const result=await state.sampleLoad;
    renderSoundMode(result.failed.length===0?"idle":result.loaded.length?"partial":"failed");
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

  // Order in which sharps and flats appear in a key signature, with the treble
  // staff Y each glyph sits on (same coordinate space as staffY()).
  const sharpOrder=[["F",66],["C",84],["G",60],["D",78],["A",96],["E",72],["B",90]];
  const flatOrder=[["B",90],["E",72],["A",96],["D",78],["G",102],["C",84],["F",108]];

  // Accidental count per key: positive = sharps, negative = flats.
  const keyFifths={
    C:0,Am:0,
    G:1,Em:1, D:2,Bm:2, A:3,"F#m":3, E:4,"C#m":4, B:5,"G#m":5,
    F:-1,Dm:-1, Bb:-2,Gm:-2, Eb:-3,Cm:-3, Ab:-4,Fm:-4, Db:-5,Bbm:-5
  };

  function noteParts(name){
    const match=/^([A-G])([#b]?)(-?\d+)$/.exec(name);
    if(!match) throw new Error("Invalid note: "+name);
    return {letter:match[1], accidental:match[2], octave:Number(match[3])};
  }

  function noteToMidi(name){
    const p=noteParts(name);
    const accidental=p.accidental==="#"?1:p.accidental==="b"?-1:0;
    return (p.octave+1)*12+pitchClass[p.letter]+accidental;
  }

  function midiToFrequency(midi){
    return 440*Math.pow(2,(midi-69)/12);
  }

  function noteToFrequency(name){
    return midiToFrequency(noteToMidi(name));
  }

  function staffY(name){
    const p=noteParts(name);
    // Guitar notation sounds one octave below written pitch.
    const writtenOctave=p.octave+1;
    const index=writtenOctave*7+diatonicLetter[p.letter];
    const bottomE4=4*7+diatonicLetter.E;
    return 114-(index-bottomE4)*6;
  }

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  // Returns the glyphs a key signature prints, plus the alteration each letter
  // carries by default, so notes covered by the signature stop printing a
  // redundant accidental of their own.
  function keySignature(key){
    const fifths=keyFifths[key];
    if(fifths===undefined){
      console.warn("[phrase] unknown key, drawing no key signature:",key);
      return {glyphs:[], alterByLetter:{}};
    }
    const glyph=fifths>0?"\u266f":"\u266d";
    const alter=fifths>0?1:-1;
    const source=fifths>0?sharpOrder:flatOrder;
    const used=source.slice(0,Math.abs(fifths));
    const alterByLetter={};
    used.forEach(([letter])=>{ alterByLetter[letter]=alter; });
    return {glyphs:used.map(([letter,y])=>({letter,y,glyph})), alterByLetter};
  }

  function alterationOf(name){
    const accidental=noteParts(name).accidental;
    return accidental==="#"?1:accidental==="b"?-1:0;
  }

  // Standard practice: print an accidental only when the pitch differs from what
  // the key signature (or an earlier accidental in the same bar) already implies.
  function annotateAccidentals(){
    const signature=keySignature(state.phrase.key);
    state.signature=signature;
    for(const measure of state.measures){
      const activeInBar=new Map();
      for(const note of measure){
        const parts=noteParts(note.name);
        const slot=parts.letter+parts.octave;
        const expected=activeInBar.has(slot)
          ? activeInBar.get(slot)
          : (signature.alterByLetter[parts.letter] ?? 0);
        const actual=alterationOf(note.name);
        if(actual===expected){
          note.accidentalGlyph=null;
        }else{
          note.accidentalGlyph=actual===1?"\u266f":actual===-1?"\u266d":"\u266e";
          activeInBar.set(slot,actual);
        }
      }
    }
  }

  // Note heads for low bass strings sit below the staff, where the pitch-name and
  // fingering rows used to be fixed. Size every system from the actual range so
  // the two never collide.
  function computeLayout(){
    let highest=66;
    let lowest=114;
    for(const note of state.phrase.notes){
      const y=staffY(note.name);
      highest=Math.min(highest,y);
      lowest=Math.max(lowest,y);
    }
    // Leave room for a stem and flag above the highest note, and for the ledger
    // lines and text rows below the lowest one.
    const top=Math.min(0,highest-STEM_LENGTH-14);
    const nameY=lowest+26;
    const fingerY=nameY+14;
    const bottom=fingerY+11;
    state.layout={top, height:bottom-top, nameY, fingerY};
  }

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
    const result=[];
    let current=[], beats=0, globalIndex=0;
    for(const note of state.phrase.notes){
      current.push({...note, globalIndex, startBeat:beats});
      beats+=Number(note.beats);
      globalIndex+=1;
      if(Math.abs(beats-4)<1e-9){
        result.push(current);
        current=[];
        beats=0;
      }
    }
    if(current.length) result.push(current);
    state.measures=result;
  }

  function buildNoteStarts(){
    state.noteStarts=new Map();
    let grid=0;
    state.phrase.notes.forEach((note,index)=>{
      if(!state.noteStarts.has(grid)) state.noteStarts.set(grid,[]);
      state.noteStarts.get(grid).push({note,index});
      grid+=Math.round(Number(note.beats)*2);
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

  function svgEl(name,attrs={},text){
    const el=document.createElementNS("http://www.w3.org/2000/svg",name);
    for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,String(value));
    if(text!==undefined) el.textContent=text;
    return el;
  }

  function addLedgerLines(svg,x,y){
    if(y<66){
      for(let ly=54;ly>=y-1;ly-=12){
        svg.appendChild(svgEl("line",{x1:x-12,y1:ly,x2:x+12,y2:ly,class:"ledger"}));
      }
    }
    if(y>114){
      for(let ly=126;ly<=y+1;ly+=12){
        svg.appendChild(svgEl("line",{x1:x-12,y1:ly,x2:x+12,y2:ly,class:"ledger"}));
      }
    }
  }

  function addNoteSymbol(svg,note,x,index){
    const y=staffY(note.name);
    addLedgerLines(svg,x,y);

    const measure=measureForNote(index);
    const group=svgEl("g",{
      class:"note-symbol",
      "data-note-index":index,
      "data-note-name":note.name,
      role:"button",
      tabindex:"0",
      "aria-label":"M"+(measure+1)+" "+(index+1)+"音目 "+note.name
        +" "+note.string+"弦"+note.fret+"フレット 右手"+(note.finger||"—")
    });

    const head=svgEl("ellipse",{
      cx:x,cy:y,rx:8.5,ry:6,
      class:"note-head"+(note.beats>=2?" open":""),
      transform:"rotate(-18 "+x+" "+y+")"
    });
    group.appendChild(head);

    if(note.beats<4){
      // Stems flip at the middle line, as engraved music does; without this the
      // high notes grew stems that ran off the top of the system.
      const stemUp=y>MIDDLE_LINE_Y;
      const stemX=stemUp?x+7.5:x-7.5;
      const stemEnd=stemUp?y-STEM_LENGTH:y+STEM_LENGTH;
      group.appendChild(svgEl("line",{x1:stemX,y1:y,x2:stemX,y2:stemEnd,class:"note-stem"}));
      if(note.beats<=0.5){
        group.appendChild(svgEl("path",{
          d:"M "+stemX+" "+stemEnd+(stemUp?" q 18 8 6 23":" q 18 -8 6 -23"),
          class:"note-flag"
        }));
      }
    }

    if(note.accidentalGlyph){
      group.appendChild(svgEl("text",{x:x-22,y:y+7,class:"accidental"},note.accidentalGlyph));
    }
    group.appendChild(svgEl("text",{x:x,y:state.layout.nameY,class:"note-name-text","text-anchor":"middle"},note.name));
    group.appendChild(svgEl("text",{x:x,y:state.layout.fingerY,class:"finger-text","text-anchor":"middle"},note.finger||""));

    const select=()=>{
      state.noteIndex=index;
      renderCurrentNote();
      highlightNote(index);
      highlightMeasure(measureForNote(index));
    };
    group.addEventListener("click",select);
    group.addEventListener("keydown",(event)=>{
      if(event.key!=="Enter"&&event.key!==" ") return;
      event.preventDefault();
      select();
    });
    svg.appendChild(group);
  }

  function buildStaff(){
    const host=$("staff");
    host.innerHTML="";

    // Reserve the clef / key / time header on every system so the beat grid
    // lines up vertically across all measures.
    const keySigX=54;
    const timeSigX=keySigX+state.signature.glyphs.length*9+4;
    const noteStartX=timeSigX+30;
    const noteSpan=336-noteStartX;
    const {top,height}=state.layout;

    state.measures.forEach((measure,mIndex)=>{
      const svg=svgEl("svg",{
        viewBox:"0 "+top+" 360 "+height,
        class:"staff-system",
        "data-measure":mIndex,
        "aria-label":"第"+(mIndex+1)+"小節 "+state.phrase.chords[mIndex],
        role:"group",
        preserveAspectRatio:"xMidYMid meet"
      });
      svg.style.aspectRatio="360 / "+height;

      [66,78,90,102,114].forEach((y,lineIndex)=>{
        svg.appendChild(svgEl("line",{
          x1:48,y1:y,x2:346,y2:y,
          class:"staff-line",
          "data-staff-line":lineIndex
        }));
      });
      svg.appendChild(svgEl("line",{x1:48,y1:66,x2:48,y2:114,class:"bar-line"}));
      svg.appendChild(svgEl("line",{x1:346,y1:66,x2:346,y2:114,class:"bar-line"}));
      svg.appendChild(svgEl("text",{x:8,y:111,class:"clef"},"𝄞"));
      svg.appendChild(svgEl("text",{x:306,y:20,class:"measure-no"},"M"+(mIndex+1)));
      svg.appendChild(svgEl("text",{x:noteStartX-16,y:25,class:"chord-symbol"},state.phrase.chords[mIndex]));

      // Every measure is its own system here, so the key signature repeats on
      // each one exactly as printed music does.
      state.signature.glyphs.forEach((entry,i)=>{
        svg.appendChild(svgEl("text",{x:keySigX+i*9,y:entry.y+6,class:"key-signature"},entry.glyph));
      });
      if(mIndex===0){
        svg.appendChild(svgEl("text",{x:timeSigX,y:84,class:"time-sig"},"4"));
        svg.appendChild(svgEl("text",{x:timeSigX,y:105,class:"time-sig"},"4"));
      }

      measure.forEach((note)=>{
        const x=noteStartX+(note.startBeat/4)*noteSpan;
        addNoteSymbol(svg,note,x,note.globalIndex);
      });
      host.appendChild(svg);
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
    annotateAccidentals();
    computeLayout();
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
    const note=state.phrase.notes[state.noteIndex];
    const measure=measureForNote(state.noteIndex);
    $("note-name").textContent=note.name;
    $("note-position").textContent=note.string+"弦 "+note.fret+"フレット";
    $("note-finger").textContent="右手 "+(note.finger||"—");
    $("note-measure").textContent="M"+(measure+1)+" / "+state.phrase.chords[measure];
    $("position-label").textContent="M"+(measure+1)+" / "+(state.noteIndex+1)+" of "+state.phrase.notes.length;
  }

  function highlightNote(index){
    document.querySelectorAll(".note-symbol").forEach(el=>{
      el.classList.toggle("active",Number(el.dataset.noteIndex)===index);
    });
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

    const system=document.querySelector('.staff-system[data-measure="'+index+'"]');
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

  async function ensureAudio(){
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

    if(state.soundMode==="samples") await prepareRealSamples();
  }

  function envelopeGain(time,peak,decay,bus){
    const gain=state.audio.createGain();
    gain.gain.setValueAtTime(.0001,time);
    gain.gain.exponentialRampToValueAtTime(peak,time+.006);
    gain.gain.exponentialRampToValueAtTime(.0001,time+decay);
    gain.connect(bus);
    return gain;
  }

  function scheduleMelody(note,time,durationSec){
    const sampleDuration=Math.max(.16,Math.min(1.8,durationSec*.92+.08));
    const sampled=state.soundMode==="samples"&&state.samplePlayer?.schedule("nylonGuitar",{
      time,
      destination:state.mix.melody,
      midi:noteToMidi(note.name),
      gain:.44,
      duration:sampleDuration,
      release:.07
    });
    if(sampled) return;

    const freq=noteToFrequency(note.name);
    const gain=envelopeGain(time,.19,Math.max(.18,Math.min(1.6,durationSec*.92+.12)),state.mix.melody);
    const osc=state.audio.createOscillator();
    const harmonic=state.audio.createOscillator();
    const hg=state.audio.createGain();

    osc.type="triangle";
    harmonic.type="sine";
    osc.frequency.setValueAtTime(freq,time);
    harmonic.frequency.setValueAtTime(freq*2,time);
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
    info.intervals.forEach((interval,i)=>{
      const midi=info.root+12+interval;
      const attack=time+i*.018;
      const sampled=state.soundMode==="samples"&&state.samplePlayer?.schedule("nylonGuitar",{
        time:attack,
        destination:state.mix.chords,
        midi,
        gain:.15*accent,
        duration:Math.max(.2,durationSec),
        release:.08
      });
      if(sampled) return;

      const osc=state.audio.createOscillator();
      const gain=state.audio.createGain();
      const freq=midiToFrequency(midi);

      osc.type=i===0?"triangle":"sine";
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
      midi:info.root,
      gain:.32,
      duration:.38,
      release:.07
    });
    if(sampled) return;

    const fundamental=state.audio.createOscillator();
    const harmonic=state.audio.createOscillator();
    const gain=envelopeGain(time,.095,.34,state.mix.bass);
    const harmonicGain=state.audio.createGain();

    fundamental.type="triangle";
    harmonic.type="sine";
    fundamental.frequency.setValueAtTime(midiToFrequency(info.root),time);
    harmonic.frequency.setValueAtTime(midiToFrequency(info.root+12),time);
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
      duration:Math.max(decay+.02,sampleName === "snare" ? .18 : .07),
      release:.04
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
      scheduleNoise(time,.028,.045,5200,"closedHat",.14);
      // Kick on beats 1 and 3.
      if(inBar===0||inBar===4) scheduleKick(time);
      // Snare on beats 2 and 4.
      if(inBar===2||inBar===6) scheduleNoise(time,.095,.105,850,"snare",.26);
    }
  }

  function scheduleGrid(grid,time){
    const spb=secondsPerBeat();
    const measure=Math.floor(grid/8);
    const inBar=grid%8;
    const chord=state.phrase.chords[measure];

    const starts=state.noteStarts.get(grid)||[];
    starts.forEach(({note,index})=>{
      scheduleMelody(note,time,Number(note.beats)*spb);
      state.visualQueue.push({time,index,measure,grid});
    });

    scheduleBackingGrid(inBar,time,chord);
  }

  function schedulerTick(){
    if(!state.running||!state.audio) return;
    const ahead=state.audio.currentTime+.16;

    while(!state.finished && state.nextGridTime<ahead){
      scheduleGrid(state.nextGrid,state.nextGridTime);
      state.nextGridTime+=secondsPerBeat()/2;
      state.nextGrid+=1;

      if(state.nextGrid>=state.phrase.measures*8){
        if(state.loop){
          state.nextGrid=0;
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
      updateProgress((event.grid/(state.phrase.measures*8))*100);
    }

    if(state.finished&&state.visualQueue.length===0&&now>state.nextGridTime){
      updateProgress(100);
      stop(false);
      return;
    }
    state.raf=requestAnimationFrame(visualLoop);
  }

  async function play(){
    if(state.running||state.starting) return;
    state.starting=true;
    $("play").disabled=true;
    try{
      await ensureAudio();
      restoreMaster();

      state.running=true;
      state.nextGrid=0;
      state.nextGridTime=state.audio.currentTime+.08;
      state.visualQueue.length=0;
      state.finished=false;
      state.followedMeasure=-1;

      $("stop").disabled=false;

      schedulerTick();
      state.scheduler=setInterval(schedulerTick,25);
      state.raf=requestAnimationFrame(visualLoop);
    }finally{
      state.starting=false;
      if(!state.running) $("play").disabled=false;
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

    $("play").disabled=false;
    $("stop").disabled=true;
    if(resetProgress) updateProgress(0);
  }

  async function playOne(){
    await ensureAudio();
    restoreMaster();
    const note=state.phrase.notes[state.noteIndex];
    scheduleMelody(note,state.audio.currentTime+.02,Number(note.beats)*secondsPerBeat());
    highlightNote(state.noteIndex);
  }

  async function previewBacking(){
    await ensureAudio();
    restoreMaster();
    const measure=measureForNote(state.noteIndex);
    const chord=state.phrase.chords[measure];
    const start=state.audio.currentTime+.05;
    const step=secondsPerBeat()/2;

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
  }

  function moveNote(amount){
    const length=state.phrase.notes.length;
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
