import { bendLabel, vexDuration, writtenVexKey } from "./music.js";

const SVG_NS="http://www.w3.org/2000/svg";
const SCORE_WIDTH=480;
const SCORE_HEIGHT=330;
const STAFF_Y=38;
const TAB_Y=142;
const STAVE_X=8;
const STAVE_WIDTH=454;

const TYPE_LABELS=Object.freeze({
  whole:"全音符",
  half:"2分音符",
  quarter:"4分音符",
  eighth:"8分音符",
  "16th":"16分音符",
  "32nd":"32分音符"
});

const NOTATION_LABELS=Object.freeze({
  tuplet:"連符",
  tie:"タイ",
  slur:"スラー",
  "hammer-on":"ハンマリング・オン",
  "pull-off":"プリング・オフ",
  slide:"スライド",
  bend:"ベンド",
  harmonic:"ハーモニクス",
  "palm-mute":"パームミュート",
  vibrato:"ビブラート"
});

function svgEl(documentRef,name,attrs={},text){
  const element=documentRef.createElementNS(SVG_NS,name);
  for(const [key,value] of Object.entries(attrs)) element.setAttribute(key,String(value));
  if(text!==undefined) element.textContent=text;
  return element;
}

function dotsFor(note){
  return Number(note.notated?.dots??0);
}

function typeFor(note){
  if(note.notated?.type) return note.notated.type;
  const beats=Number(note.beats);
  if(Math.abs(beats-4)<1e-9) return "whole";
  if(Math.abs(beats-2)<1e-9) return "half";
  if(Math.abs(beats-1)<1e-9) return "quarter";
  if(Math.abs(beats-.5)<1e-9) return "eighth";
  if(Math.abs(beats-.25)<1e-9) return "16th";
  return "eighth";
}

function accidentalCode(glyph){
  return glyph==="♯"?"#":glyph==="♭"?"b":glyph==="♮"?"n":null;
}

function notationTouches(notation,note){
  if(!note.id) return false;
  return [notation.note,notation.from,notation.to]
    .some(reference=>reference!==undefined&&reference===note.id);
}

function noteNotationLabels(model,note){
  const labels=[];
  for(const notation of model.notations){
    if(!notationTouches(notation,note)) continue;
    let label=NOTATION_LABELS[notation.type]??notation.type;
    if(notation.type==="bend") label+=" "+(notation.label||bendLabel(notation.bendAlter));
    if(!labels.includes(label)) labels.push(label);
  }
  for(const tuplet of model.tuplets){
    const first=model.noteById.get(tuplet.from);
    const last=model.noteById.get(tuplet.to);
    if(first&&last&&note.globalIndex>=first.globalIndex&&note.globalIndex<=last.globalIndex){
      labels.push(tuplet.actualNotes+"連符");
    }
  }
  return labels;
}

function durationLabel(note){
  const type=TYPE_LABELS[typeFor(note)]??"音符";
  const dots=dotsFor(note);
  const dotted=dots===1?"付点":dots>1?dots+"重付点":"";
  const modification=note.timeModification;
  const tuplet=modification?" "+modification.actualNotes+"連符":"";
  return dotted+type+tuplet;
}

function addNoteMetadata(documentRef,svg,model,note,staffNote,onSelectNote){
  const x=staffNote.getAbsoluteX();
  const y=staffNote.getYs()[0];
  const measure=note.measureIndex;
  const labels=noteNotationLabels(model,note);
  const aria=[
    "M"+(measure+1),
    (note.globalIndex+1)+"音目",
    note.name,
    durationLabel(note),
    note.string+"弦"+note.fret+"フレット",
    "右手"+(note.finger||"—"),
    ...labels
  ].join(" ");
  const group=svgEl(documentRef,"g",{
    class:"note-symbol notation-hit-target",
    "data-note-index":note.globalIndex,
    "data-note-name":note.name,
    role:"button",
    tabindex:"0",
    "aria-label":aria
  });
  group.appendChild(svgEl(documentRef,"title",{},aria));
  group.appendChild(svgEl(documentRef,"ellipse",{
    cx:x,cy:y,rx:11,ry:9,
    class:"note-head"+(["whole","half"].includes(typeFor(note))?" open":"")
  }));
  group.appendChild(svgEl(documentRef,"text",{
    x,y:294,class:"note-name-text","text-anchor":"middle"
  },note.name));
  group.appendChild(svgEl(documentRef,"text",{
    x,y:314,class:"finger-text","text-anchor":"middle"
  },note.finger||""));

  const select=()=>onSelectNote?.(note.globalIndex);
  group.addEventListener("click",select);
  group.addEventListener("keydown",event=>{
    if(event.key!=="Enter"&&event.key!==" ") return;
    event.preventDefault();
    select();
  });
  svg.appendChild(group);
}

function addDomContract(documentRef,svg,model,measureIndex){
  [70,80,90,100,110].forEach((y,lineIndex)=>{
    svg.appendChild(svgEl(documentRef,"line",{
      x1:STAVE_X,y1:y,x2:STAVE_X+STAVE_WIDTH,y2:y,
      class:"staff-line notation-contract",
      "data-staff-line":lineIndex,
      "aria-hidden":"true",
      opacity:"0"
    }));
  });
  [STAVE_X,STAVE_X+STAVE_WIDTH].forEach(x=>{
    svg.appendChild(svgEl(documentRef,"line",{
      x1:x,y1:70,x2:x,y2:110,class:"bar-line notation-contract",
      "aria-hidden":"true",opacity:"0"
    }));
  });
  svg.appendChild(svgEl(documentRef,"g",{
    class:"clef notation-contract","aria-hidden":"true",opacity:"0"
  }));
  model.signature.glyphs.forEach(({glyph})=>{
    svg.appendChild(svgEl(documentRef,"text",{
      class:"key-signature notation-contract","aria-hidden":"true",opacity:"0"
    },glyph));
  });
  if(measureIndex===0){
    svg.appendChild(svgEl(documentRef,"g",{
      class:"time-sig notation-contract","aria-hidden":"true",opacity:"0"
    }));
  }
  svg.appendChild(svgEl(documentRef,"text",{
    x:466,y:18,class:"measure-no","text-anchor":"end"
  },"M"+(measureIndex+1)));
  svg.appendChild(svgEl(documentRef,"text",{
    x:126,y:24,class:"chord-symbol"
  },model.phrase.chords[measureIndex]));
}

function noteRange(model,collection,from,to){
  const first=model.noteById.get(from);
  const last=model.noteById.get(to);
  if(!first||!last||first.measureIndex!==last.measureIndex) return [];
  return collection.slice(first.localIndex,last.localIndex+1);
}

function tupletOptions(V,tuplet){
  const options={
    numNotes:Number(tuplet.actualNotes),
    notesOccupied:Number(tuplet.normalNotes),
    ratioed:tuplet.showNumber==="both",
    location:tuplet.placement==="below"?V.Tuplet.LOCATION_BOTTOM:V.Tuplet.LOCATION_TOP
  };
  if(typeof tuplet.bracket==="boolean") options.bracketed=tuplet.bracket;
  return options;
}

function bendForNote(model,note){
  return model.notations.find(notation=>notation.type==="bend"&&notation.note===note.id)??null;
}

function harmonicForNote(model,note){
  return model.notations.find(notation=>notation.type==="harmonic"&&notation.note===note.id)??null;
}

function vibratoForNote(model,note){
  return model.notations.find(notation=>
    notation.type==="vibrato"&&(notation.note===note.id||notation.from===note.id)
  )??null;
}

function drawAcrossSystems(V,notation,fromRef,toRef,create){
  if(!fromRef||!toRef) return;
  if(fromRef.measureIndex===toRef.measureIndex){
    const element=create(fromRef,toRef);
    element?.setContext(fromRef.context).draw();
    return;
  }
  const first=create(fromRef,null);
  first?.setContext(fromRef.context).draw();
  const last=create(null,toRef);
  last?.setContext(toRef.context).draw();
}

function drawSpanners(V,model,refsById){
  for(const notation of model.notations){
    if(!notation.from||!notation.to) continue;
    const fromRef=refsById.get(notation.from);
    const toRef=refsById.get(notation.to);
    if(!fromRef||!toRef) continue;

    if(notation.type==="tie"){
      drawAcrossSystems(V,notation,fromRef,toRef,(from,to)=>new V.StaveTie({
        firstNote:from?.staffNote??null,lastNote:to?.staffNote??null,
        firstIndexes:[0],lastIndexes:[0]
      }));
      drawAcrossSystems(V,notation,fromRef,toRef,(from,to)=>new V.TabTie({
        firstNote:from?.tabNote??null,lastNote:to?.tabNote??null,
        firstIndexes:[0],lastIndexes:[0]
      }));
    }else if(notation.type==="slur"){
      drawAcrossSystems(V,notation,fromRef,toRef,(from,to)=>new V.Curve(
        from?.staffNote,to?.staffNote,{
          position:V.Curve.Position.NEAR_TOP,
          positionEnd:V.Curve.Position.NEAR_TOP,
          openingDirection:notation.placement==="below"?"down":"up",
          cps:[{x:0,y:notation.placement==="below"?14:-14},{x:0,y:notation.placement==="below"?14:-14}]
        }
      ));
    }else if(notation.type==="hammer-on"||notation.type==="pull-off"){
      drawAcrossSystems(V,notation,fromRef,toRef,(from,to)=>{
        const notes={
          firstNote:from?.tabNote??null,lastNote:to?.tabNote??null,
          firstIndexes:[0],lastIndexes:[0]
        };
        return notation.type==="hammer-on"
          ? V.TabTie.createHammeron(notes)
          : V.TabTie.createPulloff(notes);
      });
    }else if(notation.type==="slide"){
      drawAcrossSystems(V,notation,fromRef,toRef,(from,to)=>new V.TabSlide({
        firstNote:from?.tabNote??null,lastNote:to?.tabNote??null,
        firstIndexes:[0],lastIndexes:[0]
      },(to?.note.fret??from?.note.fret)>(from?.note.fret??to?.note.fret)
        ? V.TabSlide.SLIDE_UP
        : V.TabSlide.SLIDE_DOWN));
    }else if(notation.type==="palm-mute"&&fromRef.measureIndex===toRef.measureIndex){
      new V.TextBracket({
        start:fromRef.staffNote,stop:toRef.staffNote,text:"P.M.",position:V.TextBracket.Position.TOP
      }).setDashed(true,[4,3]).setContext(fromRef.context).draw();
    }
  }
}

function addNotationMarker(documentRef,ref,notation){
  const marker=svgEl(documentRef,"g",{
    class:"notation-marker notation-"+notation.type,
    "data-notation-type":notation.type,
    "aria-label":NOTATION_LABELS[notation.type]??notation.type
  });
  marker.appendChild(svgEl(documentRef,"title",{},NOTATION_LABELS[notation.type]??notation.type));
  ref.svg.appendChild(marker);
}

export function renderScore(host,model,{engraver,onSelectNote}={}){
  if(!host) throw new TypeError("host is required");
  if(!engraver) throw new TypeError("engraver is required");
  const documentRef=host.ownerDocument;
  const V=engraver;
  const refsById=new Map();
  const refsByIndex=new Map();
  host.replaceChildren();

  model.measures.forEach((measure,measureIndex)=>{
    measure.forEach((note,localIndex)=>{ note.localIndex=localIndex; });
    const mount=documentRef.createElement("div");
    mount.className="staff-system-mount";
    host.appendChild(mount);

    const renderer=new V.Renderer(mount,V.Renderer.Backends.SVG);
    renderer.resize(SCORE_WIDTH,SCORE_HEIGHT);
    const context=renderer.getContext();
    const stave=new V.Stave(STAVE_X,STAFF_Y,STAVE_WIDTH)
      .addClef("treble","default","8vb")
      .addKeySignature(model.phrase.key);
    if(measureIndex===0) stave.addTimeSignature(model.phrase.timeSignature);
    const tabStave=new V.TabStave(STAVE_X,TAB_Y,STAVE_WIDTH).addTabGlyph();
    stave.setContext(context).draw();
    tabStave.setContext(context).draw();
    new V.StaveConnector(stave,tabStave)
      .setType(V.StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
    new V.StaveConnector(stave,tabStave)
      .setType(V.StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();

    const staffNotes=measure.map(note=>{
      const harmonic=harmonicForNote(model,note);
      const staveNote=new V.StaveNote({
        keys:[writtenVexKey(note.name)],
        duration:vexDuration(note),
        dots:dotsFor(note),
        type:harmonic?"d":"n",
        autoStem:true
      });
      const accidental=accidentalCode(note.accidentalGlyph);
      if(accidental) staveNote.addModifier(new V.Accidental(accidental),0);
      if(dotsFor(note)>0) V.Dot.buildAndAttach([staveNote],{all:true});
      if(harmonic){
        staveNote.addModifier(
          new V.Annotation(harmonic.kind==="artificial"?"A.H.":"N.H.")
            .setFont("Arial",8)
            .setVerticalJustification(V.Annotation.VerticalJustify.TOP),0
        );
      }
      return staveNote;
    });

    const tabNotes=measure.map(note=>{
      const harmonic=harmonicForNote(model,note);
      const fret=harmonic?"<"+note.fret+">":String(note.fret);
      const tabNote=new V.TabNote({
        positions:[{str:note.string,fret}],duration:vexDuration(note),dots:dotsFor(note)
      },false);
      if(dotsFor(note)>0) V.Dot.buildAndAttach([tabNote],{all:true});
      const bend=bendForNote(model,note);
      if(bend){
        tabNote.addModifier(new V.Bend([{
          type:V.Bend.UP,text:bend.label||bendLabel(bend.bendAlter)
        }]),0);
      }
      if(vibratoForNote(model,note)) tabNote.addModifier(new V.Vibrato(),0);
      return tabNote;
    });

    const drawnTuplets=[];
    model.tuplets.forEach(tuplet=>{
      const staffRange=noteRange(model,staffNotes,tuplet.from,tuplet.to);
      if(!staffRange.length) return;
      const tabRange=noteRange(model,tabNotes,tuplet.from,tuplet.to);
      drawnTuplets.push({
        element:new V.Tuplet(staffRange,tupletOptions(V,tuplet)),
        specification:tuplet
      });
      // A matching hidden tuplet changes TAB tick durations so both voices stay aligned.
      new V.Tuplet(tabRange,{...tupletOptions(V,tuplet),bracketed:false});
    });

    const staffVoice=new V.Voice({
      numBeats:Number(model.phrase.timeSignature.split("/")[0]),
      beatValue:Number(model.phrase.timeSignature.split("/")[1])
    }).setStrict(false).addTickables(staffNotes);
    const tabVoice=new V.Voice({
      numBeats:Number(model.phrase.timeSignature.split("/")[0]),
      beatValue:Number(model.phrase.timeSignature.split("/")[1])
    }).setStrict(false).addTickables(tabNotes);
    const beams=V.Beam.generateBeams(staffNotes);
    // Beam generation chooses a stem-side tuplet position by default. Restore
    // the explicit display metadata after that automatic engraving pass.
    drawnTuplets.forEach(({element,specification})=>{
      const options=tupletOptions(V,specification);
      element
        .setTupletLocation(options.location)
        .setBracketed(options.bracketed)
        .setRatioed(options.ratioed);
    });
    new V.Formatter().joinVoices([staffVoice]).joinVoices([tabVoice])
      .format([staffVoice,tabVoice],STAVE_WIDTH-118);
    staffVoice.draw(context,stave);
    tabVoice.draw(context,tabStave);
    beams.forEach(beam=>beam.setContext(context).draw());
    drawnTuplets.forEach(({element})=>element.setContext(context).draw());

    const svg=mount.querySelector("svg");
    [...svg.children].forEach(child=>child.setAttribute("aria-hidden","true"));
    svg.classList.add("staff-system");
    svg.setAttribute("viewBox","0 0 "+SCORE_WIDTH+" "+SCORE_HEIGHT);
    svg.style.width="100%";
    svg.style.height="auto";
    svg.dataset.measure=String(measureIndex);
    svg.setAttribute("aria-label","第"+(measureIndex+1)+"小節 "+model.phrase.chords[measureIndex]);
    svg.setAttribute("role","group");
    svg.setAttribute("preserveAspectRatio","xMidYMid meet");
    addDomContract(documentRef,svg,model,measureIndex);

    measure.forEach((note,index)=>{
      const ref={
        note,staffNote:staffNotes[index],tabNote:tabNotes[index],context,svg,measureIndex
      };
      refsByIndex.set(note.globalIndex,ref);
      if(note.id) refsById.set(note.id,ref);
      addNoteMetadata(documentRef,svg,model,note,staffNotes[index],onSelectNote);
    });
    model.tuplets.forEach(tuplet=>{
      const ref=refsById.get(tuplet.from);
      if(ref?.measureIndex===measureIndex){
        addNotationMarker(documentRef,ref,{type:"tuplet"});
      }
    });
  });

  drawSpanners(V,model,refsById);
  model.notations.forEach(notation=>{
    const ref=refsById.get(notation.note||notation.from);
    if(ref) addNotationMarker(documentRef,ref,notation);
  });
  return {refsById,refsByIndex};
}

export function setActiveNote(host,index){
  host.querySelectorAll(".note-symbol").forEach(element=>{
    element.classList.toggle("active",Number(element.dataset.noteIndex)===index);
  });
}

export function systemElement(host,measureIndex){
  return host.querySelector('.staff-system[data-measure="'+measureIndex+'"]');
}

export function notationLabelsForNote(model,note){
  return noteNotationLabels(model,note);
}
