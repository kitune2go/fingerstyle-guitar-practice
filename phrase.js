(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = {
    data:null, phrase:null, index:0, noteIndex:0,
    audio:null, noiseBuffer:null,
    running:false, loop:false,
    backing:{ chords:true, bass:true, drums:true },
    scheduler:null, raf:null,
    nextGrid:0, nextGridTime:0, finished:false,
    visualQueue:[], noteStarts:new Map(), measures:[]
  };

  const pitchClass = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 };
  const diatonicLetter = { C:0,D:1,E:2,F:3,G:4,A:5,B:6 };
  const stringLabels = ["e","B","G","D","A","E"];
  const grooveLabels = { straight8:"Straight 8", rock8:"Rock 8" };
  const rootBaseMidi = { C:48,"C#":49,Db:49,D:50,"D#":51,Eb:51,E:52,F:53,"F#":54,Gb:54,G:43,"G#":44,Ab:44,A:45,"A#":46,Bb:46,B:47 };

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
    const writtenOctave=p.octave+1;
    const index=writtenOctave*7+diatonicLetter[p.letter];
    const bottomE4=4*7+diatonicLetter.E;
    return 114-(index-bottomE4)*6;
  }

  async function loadData(){
    const response=await fetch("./data/phrases.json",{cache:"no-store"});
    if(!response.ok) throw new Error("フレーズ教材を読み込めませんでした。");
    state.data=await response.json();
  }

  function buildSelect(){
    $("phrase-select").innerHTML=state.data.phrases
      .map((p,i)=>'<option value="'+i+'">'+(i+1)+". "+p.title+"</option>").join("");
  }

  function splitMeasures(){
    const result=[];
    let current=[], beats=0, globalIndex=0;
    for(const note of state.phrase.notes){
      if(beats===4){ result.push(current); current=[]; beats=0; }
      current.push({...note, globalIndex, startBeat:beats});
      beats+=Number(note.beats);
      globalIndex+=1;
      if(Math.abs(beats-4)<1e-9){ result.push(current); current=[]; beats=0; }
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
      .map((chord,i)=>'<div class="chord-chip" data-chord-measure="'+i+'"><small>M'+(i+1)+'</small><strong>'+chord+'</strong></div>')
      .join("");
  }

  function buildTab(){
    const blocks=state.measures.map((measure,mIndex)=>{
      const lines=stringLabels.map((label,idx)=>{
        const stringNo=idx+1;
        let line=label+"|";
        for(const note of measure){
          const cell=note.string===stringNo?("-"+note.fret).padEnd(4,"-"):"----";
          line+=cell;
        }
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
        svg.appendChild(svgEl("line",{x1:x-11,y1:ly,x2:x+11,y2:ly,class:"ledger"}));
      }
    }
    if(y>114){
      for(let ly=126;ly<=y+1;ly+=12){
        svg.appendChild(svgEl("line",{x1:x-11,y1:ly,x2:x+11,y2:ly,class:"ledger"}));
      }
    }
  }

  function addNoteSymbol(svg,note,x,index){
    const y=staffY(note.name);
    addLedgerLines(svg,x,y);

    const group=svgEl("g",{class:"note-symbol","data-note-index":index});
    const head=svgEl("ellipse",{
      cx:x,cy:y,rx:8,ry:5.6,
      class:"note-head"+(note.beats>=2?" open":""),
      transform:"rotate(-18 "+x+" "+y+")"
    });
    group.appendChild(head);

    if(note.beats<4){
      group.appendChild(svgEl("line",{x1:x+7,y1:y,x2:x+7,y2:y-34,class:"note-stem"}));
      if(note.beats<=0.5){
        group.appendChild(svgEl("path",{d:"M "+(x+7)+" "+(y-34)+" q 18 8 6 23",class:"note-flag"}));
      }
    }

    const parts=noteParts(note.name);
    if(parts.accidental){
      group.appendChild(svgEl("text",{x:x-20,y:y+7,class:"accidental"},parts.accidental==="#"?"♯":"♭"));
    }
    group.appendChild(svgEl("text",{x:x-4,y:151,class:"finger-text"},note.finger||""));
    group.addEventListener("click",()=>{
      state.noteIndex=index;
      renderCurrentNote();
      highlightNote(index);
    });
    svg.appendChild(group);
  }

  function buildStaff(){
    const host=$("staff");
    host.innerHTML="";
    state.measures.forEach((measure,mIndex)=>{
      const svg=svgEl("svg",{viewBox:"0 0 360 170",class:"staff-system","data-measure":mIndex});
      [66,78,90,102,114].forEach(y=>svg.appendChild(svgEl("line",{x1:48,y1:y,x2:346,y2:y,class:"staff-line"})));
      svg.appendChild(svgEl("line",{x1:346,y1:66,x2:346,y2:114,class:"bar-line"}));
      svg.appendChild(svgEl("text",{x:8,y:111,class:"clef"},"𝄞"));
      svg.appendChild(svgEl("text",{x:306,y:20,class:"measure-no"},"M"+(mIndex+1)));
      svg.appendChild(svgEl("text",{x:62,y:25,class:"chord-symbol"},state.phrase.chords[mIndex]));

      if(mIndex===0){
        svg.appendChild(svgEl("text",{x:42,y:84,class:"time-sig"},"4"));
        svg.appendChild(svgEl("text",{x:42,y:105,class:"time-sig"},"4"));
        if(state.phrase.key==="G"){
          svg.appendChild(svgEl("text",{x:61,y:72,class:"key-signature"},"♯"));
        }
      }

      measure.forEach((note)=>{
        const x=82+(note.startBeat/4)*244;
        addNoteSymbol(svg,note,x,note.globalIndex);
      });
      host.appendChild(svg);
    });
  }

  function renderPhrase(){
    stop();
    state.phrase=state.data.phrases[state.index];
    state.noteIndex=0;
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

  function updateProgress(value){
    $("progress-bar").style.width=Math.max(0,Math.min(100,value))+"%";
  }

  async function ensureAudio(){
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext) throw new Error("このブラウザはWeb Audioに対応していません。");
    if(!state.audio) state.audio=new AudioContext({latencyHint:"interactive"});
    if(state.audio.state==="suspended") await state.audio.resume();
    if(!state.noiseBuffer){
      const length=Math.floor(state.audio.sampleRate*.12);
      state.noiseBuffer=state.audio.createBuffer(1,length,state.audio.sampleRate);
      const data=state.noiseBuffer.getChannelData(0);
      for(let i=0;i<length;i++) data[i]=Math.random()*2-1;
    }
  }

  function envelopeGain(time,peak,decay){
    const gain=state.audio.createGain();
    gain.gain.setValueAtTime(.0001,time);
    gain.gain.exponentialRampToValueAtTime(peak,time+.006);
    gain.gain.exponentialRampToValueAtTime(.0001,time+decay);
    gain.connect(state.audio.destination);
    return gain;
  }

  function scheduleMelody(note,time,durationSec){
    const freq=noteToFrequency(note.name);
    const gain=envelopeGain(time,.18,Math.max(.18,Math.min(1.6,durationSec*.92+.12)));
    const osc=state.audio.createOscillator();
    const harmonic=state.audio.createOscillator();
    const hg=state.audio.createGain();
    osc.type="triangle"; harmonic.type="sine";
    osc.frequency.setValueAtTime(freq,time);
    harmonic.frequency.setValueAtTime(freq*2,time);
    hg.gain.setValueAtTime(.08,time);
    hg.gain.exponentialRampToValueAtTime(.0001,time+.16);
    osc.connect(gain); harmonic.connect(hg); hg.connect(gain);
    osc.start(time); harmonic.start(time);
    osc.stop(time+Math.max(.22,durationSec+.25)); harmonic.stop(time+.2);
  }

  function chordInfo(name){
    const match=/^([A-G](?:#|b)?)(m?)(7?)$/.exec(name);
    if(!match) return {root:48,intervals:[0,4,7]};
    const root=rootBaseMidi[match[1]]??48;
    const minor=match[2]==="m";
    const seventh=match[3]==="7";
    return {root,intervals:seventh?(minor?[0,3,7,10]:[0,4,7,10]):(minor?[0,3,7]:[0,4,7])};
  }

  function scheduleChord(name,time,durationSec,accent=1){
    const info=chordInfo(name);
    info.intervals.forEach((interval,i)=>{
      const osc=state.audio.createOscillator();
      const gain=state.audio.createGain();
      const freq=midiToFrequency(info.root+interval+12);
      osc.type=i===0?"triangle":"sine";
      osc.frequency.setValueAtTime(freq,time+i*.012);
      gain.gain.setValueAtTime(.0001,time);
      gain.gain.exponentialRampToValueAtTime(.025*accent,time+.02+i*.012);
      gain.gain.exponentialRampToValueAtTime(.0001,time+durationSec);
      osc.connect(gain); gain.connect(state.audio.destination);
      osc.start(time+i*.012); osc.stop(time+durationSec+.05);
    });
  }

  function scheduleBass(name,time){
    const info=chordInfo(name);
    const osc=state.audio.createOscillator();
    const gain=envelopeGain(time,.075,.34);
    osc.type="sine";
    osc.frequency.setValueAtTime(midiToFrequency(info.root),time);
    osc.connect(gain); osc.start(time); osc.stop(time+.38);
  }

  function scheduleKick(time){
    const osc=state.audio.createOscillator();
    const gain=state.audio.createGain();
    osc.type="sine";
    osc.frequency.setValueAtTime(120,time);
    osc.frequency.exponentialRampToValueAtTime(48,time+.11);
    gain.gain.setValueAtTime(.11,time);
    gain.gain.exponentialRampToValueAtTime(.0001,time+.13);
    osc.connect(gain); gain.connect(state.audio.destination);
    osc.start(time); osc.stop(time+.14);
  }

  function scheduleNoise(time,peak,decay,highpass){
    const source=state.audio.createBufferSource();
    source.buffer=state.noiseBuffer;
    const filter=state.audio.createBiquadFilter();
    filter.type="highpass"; filter.frequency.value=highpass;
    const gain=state.audio.createGain();
    gain.gain.setValueAtTime(peak,time);
    gain.gain.exponentialRampToValueAtTime(.0001,time+decay);
    source.connect(filter); filter.connect(gain); gain.connect(state.audio.destination);
    source.start(time); source.stop(time+decay+.02);
  }

  function secondsPerBeat(){
    return 60/Number($("tempo").value);
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

    if(state.backing.chords){
      if(inBar===0) scheduleChord(chord,time,spb*1.65,1);
      if(inBar===3) scheduleChord(chord,time,spb*.75,.72);
      if(inBar===6) scheduleChord(chord,time,spb*.7,.8);
    }

    if(state.backing.bass && (inBar===0||inBar===4)) scheduleBass(chord,time);

    if(state.backing.drums){
      scheduleNoise(time,.018,.035,5000);
      if(inBar===0||inBar===4) scheduleKick(time);
      if(inBar===2||inBar===6) scheduleNoise(time,.07,.09,900);
    }
  }

  function schedulerTick(){
    if(!state.running||!state.audio) return;
    const ahead=state.audio.currentTime+.14;
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
      updateProgress((event.grid/(state.phrase.measures*8))*100);
      const system=document.querySelector('[data-measure="'+event.measure+'"]');
      if(system && system.getBoundingClientRect().top<80) system.scrollIntoView({behavior:"smooth",block:"center"});
    }

    if(state.finished&&state.visualQueue.length===0&&now>state.nextGridTime){
      updateProgress(100);
      stop(false);
      return;
    }
    state.raf=requestAnimationFrame(visualLoop);
  }

  async function play(){
    if(state.running) return;
    await ensureAudio();
    state.running=true;
    state.nextGrid=0;
    state.nextGridTime=state.audio.currentTime+.08;
    state.visualQueue.length=0;
    state.finished=false;
    $("play").disabled=true;
    $("stop").disabled=false;
    schedulerTick();
    state.scheduler=setInterval(schedulerTick,25);
    state.raf=requestAnimationFrame(visualLoop);
  }

  function stop(resetProgress=true){
    state.running=false;
    if(state.scheduler) clearInterval(state.scheduler);
    if(state.raf) cancelAnimationFrame(state.raf);
    state.scheduler=null; state.raf=null;
    state.visualQueue.length=0;
    state.finished=false;
    $("play").disabled=false;
    $("stop").disabled=true;
    if(resetProgress) updateProgress(0);
  }

  async function playOne(){
    await ensureAudio();
    const note=state.phrase.notes[state.noteIndex];
    scheduleMelody(note,state.audio.currentTime+.02,Number(note.beats)*secondsPerBeat());
    highlightNote(state.noteIndex);
  }

  function moveNote(amount){
    const length=state.phrase.notes.length;
    state.noteIndex=(state.noteIndex+amount+length)%length;
    renderCurrentNote();
    highlightNote(state.noteIndex);
    const measure=measureForNote(state.noteIndex);
    highlightMeasure(measure);
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
      await loadData();
      buildSelect();
      renderPhrase();

      $("phrase-select").addEventListener("change",(e)=>{
        state.index=Number(e.target.value);
        renderPhrase();
      });
      $("tempo").addEventListener("input",(e)=>$("tempo-label").textContent=e.target.value);
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
      $("backing-chords").addEventListener("click",()=>toggleBacking("chords"));
      $("backing-bass").addEventListener("click",()=>toggleBacking("bass"));
      $("backing-drums").addEventListener("click",()=>toggleBacking("drums"));

      if("serviceWorker" in navigator){
        window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
      }
    }catch(error){
      document.body.insertAdjacentHTML("beforeend",'<p style="padding:16px;color:#9e3f2f">'+error.message+"</p>");
    }
  }

  bootstrap();
})();
