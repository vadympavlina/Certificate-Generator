/* =====================================================
   Certificate Generator — script.js
   ===================================================== */

const $   = id => document.getElementById(id);
const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtDate = d => d.toLocaleDateString('uk-UA', {day:'2-digit',month:'2-digit',year:'numeric'});
const sanitize = s => (s||'cert').replace(/\s+/g,'_').replace(/[^\w]/g,'').slice(0,50)||'cert';

function getN()  { return parseInt(localStorage.getItem('cn')||'1000',10); }
function nextN() { const n=getN()+1; localStorage.setItem('cn',n); return String(n); }

// ── State ─────────────────────────────────────────────
const ST = {
  tplBytes:null, bulkTplBytes:null, excelRows:[],
  placements:{},          // { field: {x,y,size,color,bold,align} }
  canvasW:1, canvasH:1,
  pdfW:842, pdfH:595,
  editorIsBulk:false,
  style:{ ns:28, gs:18, bs:11, color:'#111111' },
};

// ── Fonts ─────────────────────────────────────────────
function waitForFontkit(ms=8000){
  if(typeof fontkit!=='undefined') return Promise.resolve(fontkit);
  return new Promise(res=>{
    const t0=Date.now(), id=setInterval(()=>{
      if(typeof fontkit!=='undefined'){clearInterval(id);res(fontkit);}
      else if(Date.now()-t0>ms){clearInterval(id);res(null);}
    },80);
  });
}
function trl(s){
  const m={'А':'A','Б':'B','В':'V','Г':'H','Ґ':'G','Д':'D','Е':'E','Є':'Ye','Ж':'Zh','З':'Z','И':'Y','І':'I','Ї':'Yi','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ю':'Yu','Я':'Ya','Ь':"'",'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ie','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ю':'yu','я':'ya','ь':"'"};
  return (s||'').split('').map(c=>m[c]??c).join('');
}
async function embedFonts(doc){
  const{StandardFonts}=PDFLib;
  const fk=await waitForFontkit();
  if(fk){try{doc.registerFontkit(fk);return{fontR:await doc.embedFont(getFontR().slice(0)),fontB:await doc.embedFont(getFontB().slice(0)),cyrillic:true};}catch(e){console.warn(e.message);}}
  return{fontR:await doc.embedFont(StandardFonts.Helvetica),fontB:await doc.embedFont(StandardFonts.HelveticaBold),cyrillic:false};
}
function parseHexColor(hex){
  const{rgb}=PDFLib, h=(hex||'#111111').replace('#','');
  return rgb(parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255);
}

// ── Tabs ──────────────────────────────────────────────
document.querySelectorAll('.tb').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tb').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tp').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    $('panel-'+btn.dataset.tab).classList.add('active');
  });
});

// ── Upload helper ─────────────────────────────────────
function mkUpload({dzId,inId,chId,nmId,rmId,onLoad,onClear}){
  const dz=$(dzId),inp=$(inId),ch=$(chId),nm=$(nmId),rm=$(rmId);
  dz.addEventListener('click',()=>inp.click());
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('over');handle(e.dataTransfer.files[0]);});
  inp.addEventListener('change',e=>{handle(e.target.files[0]);inp.value='';});
  rm.addEventListener('click',()=>{ch.style.display='none';dz.style.display='flex';onClear?.();});
  function handle(file){
    if(!file)return;
    nm.textContent=file.name;ch.style.display='flex';dz.style.display='none';
    const fr=new FileReader();
    fr.onload=e=>onLoad(new Uint8Array(e.target.result),file.name);
    fr.readAsArrayBuffer(file);
  }
}
mkUpload({dzId:'dz-tpl',inId:'in-tpl',chId:'ch-tpl',nmId:'ch-tpl-name',rmId:'rm-tpl',
  onLoad:async(bytes,name)=>{ST.tplBytes=bytes;ST.placements={};toast(`Шаблон "${name}" завантажено`,'ok');await openEditor(bytes,false);renderPreview();},
  onClear:()=>{ST.tplBytes=null;ST.placements={};renderPreview();}
});
$('btn-edit-tpl').addEventListener('click',()=>{if(ST.tplBytes)openEditor(ST.tplBytes,false);});
mkUpload({dzId:'dz-bulk-tpl',inId:'in-bulk-tpl',chId:'ch-bulk-tpl',nmId:'ch-bulk-tpl-name',rmId:'rm-bulk-tpl',
  onLoad:async(bytes,name)=>{ST.bulkTplBytes=bytes;toast(`Шаблон "${name}" завантажено`,'ok');await openEditor(bytes,true);},
  onClear:()=>{ST.bulkTplBytes=null;}
});
$('btn-edit-bulk-tpl').addEventListener('click',()=>{if(ST.bulkTplBytes)openEditor(ST.bulkTplBytes,true);});
mkUpload({dzId:'dz-excel',inId:'in-excel',chId:'ch-excel',nmId:'ch-excel-name',rmId:'rm-excel',
  onLoad:(buf)=>parseExcel(buf),
  onClear:()=>{ST.excelRows=[];$('stbox').style.display='none';$('btn-bulk').disabled=true;clearCanvas('bulk-prev-box');}
});

// Style defaults fixed (no sliders — per-field settings in editor)

// ── Live preview + marker text update ─────────────────
['f-name','f-period','f-grade'].forEach(id=>{
  $(id).addEventListener('input',deb(()=>{renderPreview();updateAllMarkerPreviews();},350));
});

// ── Generate single ───────────────────────────────────
$('btn-gen').addEventListener('click',async()=>{
  const name=$('f-name').value.trim(),period=$('f-period').value.trim(),grade=$('f-grade').value.trim();
  if(!validate(name,period,grade))return;
  showProg('Генерація PDF…',10);
  try{
    const num=nextN(),date=fmtDate(new Date());
    const bytes=await buildCert({name,period,grade,num,date,tpl:ST.tplBytes});
    setP(85);await renderToBox(bytes,'prev-box');setP(100);await sleep(200);
    dlPdf(bytes,`cert_${sanitize(name)}_${num}.pdf`);
    toast(`✅ Сертифікат №${num} завантажено!`,'ok');
  }catch(e){console.error(e);toast('❌ '+e.message,'err');}finally{hideProg();}
});

// ── Generate bulk ─────────────────────────────────────
$('btn-bulk').addEventListener('click',async()=>{
  if(!ST.excelRows.length)return;
  const total=ST.excelRows.length;showProg(`Генерація 0 / ${total}…`,0);
  try{
    const zip=new JSZip(),date=fmtDate(new Date());
    for(let i=0;i<total;i++){
      const{name,period,grade}=ST.excelRows[i],num=nextN();
      const bytes=await buildCert({name,period,grade,num,date,tpl:ST.bulkTplBytes});
      zip.file(`${String(i+1).padStart(3,'0')}_${sanitize(name)}.pdf`,bytes);
      setP(Math.round((i+1)/total*88));setMsg(`Генерація ${i+1} / ${total}…`);
      if(i%5===4)await sleep(0);
    }
    setMsg('Пакування ZIP…');setP(94);
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}});
    setP(100);await sleep(200);dlBlob(blob,`certs_${Date.now()}.zip`);
    toast(`✅ ${total} сертифікатів у ZIP!`,'ok');
  }catch(e){console.error(e);toast('❌ '+e.message,'err');}finally{hideProg();}
});

// ── PDF Builder ───────────────────────────────────────
async function buildCert({name,period,grade,num,date,tpl}){
  const{PDFDocument,rgb}=PDFLib;
  let doc;
  if(tpl){doc=await PDFDocument.load(tpl.slice(0));}
  else{doc=await PDFDocument.create();doc.addPage([842,595]);}
  const page=doc.getPages()[0];
  const{width:W,height:H}=page.getSize();
  const{fontR,fontB,cyrillic}=await embedFonts(doc);
  const tx=cyrillic?(s=>s):trl;
  const tName=tx(name),tPeriod=tx(period),tGrade=tx(grade),tDate=tx(date);
  const clr=parseHexColor(ST.style.color);
  const NS=ST.style.ns,GS=ST.style.gs,BS=ST.style.bs;

  // Draw text with alignment: center(default), left, right
  function dtext(txt,x,y,font,size,color,align='center'){
    if(!txt)return;
    const w=font.widthOfTextAtSize(txt,size);
    let dx=x;
    if(align==='center')dx=x-w/2;
    else if(align==='right')dx=x-w;
    page.drawText(txt,{x:dx,y,size,font,color});
  }
  function fit(txt,font,pref,min,maxW){
    let s=pref;while(s>min&&font.widthOfTextAtSize(txt,s)>maxW)s-=0.5;return s;
  }

  if(tpl&&Object.keys(ST.placements).length>0){
    const sx=W/ST.canvasW,sy=H/ST.canvasH;
    const FIELDS={
      name:  {text:tName,     defSize:NS,   defBold:true },
      period:{text:tPeriod,   defSize:BS,   defBold:false},
      grade: {text:tGrade,    defSize:GS,   defBold:true },
      date:  {text:tDate,     defSize:BS-1, defBold:false},
      num:   {text:`№ ${num}`,defSize:BS-2, defBold:false},
    };
    for(const[field,cfg]of Object.entries(FIELDS)){
      const pl=ST.placements[field];if(!pl)continue;
      const bold=pl.bold??cfg.defBold;
      const font=bold?fontB:fontR;
      const sz=fit(cfg.text,font,pl.size??cfg.defSize,6,W*0.9);
      const fieldClr=pl.color?parseHexColor(pl.color):clr;
      const align=pl.align||'center';
      dtext(cfg.text,pl.x*sx,H-(pl.y*sy)-sz*0.3,font,sz,fieldClr,align);
    }
  }else{
    drawDefault({page,W,H,fontR,fontB,rgb,dtext,fit,
      name:tName,period:tPeriod,grade:tGrade,date:tDate,num,NS,GS,BS,clr,cyrillic});
  }
  return doc.save();
}

function drawDefault({page,W,H,fontR,fontB,rgb,dtext,fit,name,period,grade,date,num,NS,GS,BS,clr,cyrillic}){
  const L=cyrillic?{confirms:'Цей сертифікат підтверджує, що',completed:'успішно завершив(ла) курс навчання',period:'Період навчання: ',issued:'Видано: ',certNum:'№ '}
    :{confirms:'Tsiei sertyfikat pidtverdzhuie, shcho',completed:'uspishno zavershyv(la) kurs navchannia',period:'Period navchannia: ',issued:'Vydano: ',certNum:'No '};
  page.drawRectangle({x:0,y:0,width:W,height:H,color:rgb(1,1,1)});
  page.drawRectangle({x:14,y:14,width:W-28,height:H-28,borderColor:rgb(.76,.63,.38),borderWidth:2,color:rgb(1,1,1)});
  page.drawRectangle({x:22,y:22,width:W-44,height:H-44,borderColor:rgb(.86,.76,.56),borderWidth:.5,color:rgb(1,1,1)});
  page.drawRectangle({x:14,y:H-74,width:W-28,height:60,color:rgb(.08,.11,.22)});
  dtext('IT STEP Academy',W/2,H-54,fontB,11,rgb(.86,.72,.40));
  dtext('CERTIFICATE OF COMPLETION',W/2,H-68,fontR,7.5,rgb(.55,.55,.62));
  dtext(L.confirms,W/2,H-108,fontR,BS,rgb(.5,.5,.5));
  page.drawLine({start:{x:W*.15,y:H-127},end:{x:W*.85,y:H-127},thickness:.5,color:rgb(.76,.63,.38)});
  const nSz=fit(name,fontB,NS,12,W*.68);
  dtext(name,W/2,H-172,fontB,nSz,clr);
  page.drawLine({start:{x:W*.15,y:H-189},end:{x:W*.85,y:H-189},thickness:.5,color:rgb(.76,.63,.38)});
  dtext(L.completed,W/2,H-216,fontR,BS,rgb(.45,.45,.45));
  const gSz=fit(grade,fontB,GS,9,W*.65);
  dtext(grade,W/2,H-250,fontB,gSz,rgb(.76,.50,.16));
  page.drawLine({start:{x:W*.28,y:H-264},end:{x:W*.72,y:H-264},thickness:.3,color:rgb(.84,.76,.58)});
  dtext(L.period+period,W/2,H-289,fontR,BS,rgb(.42,.42,.42));
  [[28,28],[W-28,28],[28,H-28],[W-28,H-28]].forEach(([x,y])=>
    page.drawRectangle({x:x-5,y:y-5,width:10,height:10,color:rgb(.76,.63,.38),opacity:.5}));
  dtext(L.certNum+num,W*.22,34,fontR,8,rgb(.55,.55,.55));
  dtext(L.issued+date,W*.78,34,fontR,8,rgb(.55,.55,.55));
}

// ── Preview rendering ─────────────────────────────────
let _rseq=0;
async function renderToBox(pdfBytes,boxId){
  const box=$(boxId);if(!box)return;
  const seq=++_rseq,ph=box.querySelector('.prev-ph');
  try{
    const doc=await pdfjsLib.getDocument({data:pdfBytes.slice(0)}).promise;
    if(seq!==_rseq)return;
    const page=await doc.getPage(1);if(seq!==_rseq)return;
    const W=Math.max((box.clientWidth||520)-20,250);
    const vp0=page.getViewport({scale:1});
    const vp=page.getViewport({scale:Math.min(W/vp0.width,1.4)});
    box.querySelectorAll('canvas').forEach(c=>c.remove());
    const cvs=document.createElement('canvas');
    cvs.width=Math.floor(vp.width);cvs.height=Math.floor(vp.height);
    cvs.style.cssText='display:block;max-width:100%;height:auto;border-radius:3px;box-shadow:0 2px 12px rgba(0,0,0,.12)';
    box.appendChild(cvs);
    if(seq!==_rseq){cvs.remove();return;}
    await page.render({canvasContext:cvs.getContext('2d'),viewport:vp}).promise;
    if(ph)ph.style.display='none';
  }catch(e){if(e?.name!=='RenderingCancelledException')console.error('render:',e);}
}
async function renderPreview(){
  const name=($('f-name').value.trim()||'Олена Петренко'),
        period=($('f-period').value.trim()||'Вересень–Грудень 2024'),
        grade=($('f-grade').value.trim()||'B2');
  try{
    const bytes=await buildCert({name,period,grade,num:'####',date:fmtDate(new Date()),tpl:ST.tplBytes});
    await renderToBox(bytes,'prev-box');
  }catch(e){console.warn('preview:',e);}
}
function clearCanvas(boxId){
  const box=$(boxId);if(!box)return;
  box.querySelectorAll('canvas').forEach(c=>c.remove());
  const ph=box.querySelector('.prev-ph');if(ph)ph.style.display='flex';
}

// ══════════════════════════════════════════════════════
//   EDITOR
// ══════════════════════════════════════════════════════

const FIELD_META={
  name:  {label:'👤 ПІБ',    cls:'m-name',   defSize:28,defBold:true },
  period:{label:'📅 Період', cls:'m-period', defSize:11,defBold:false},
  grade: {label:'🎓 Грейд',  cls:'m-grade',  defSize:18,defBold:true },
  date:  {label:'📆 Дата',   cls:'m-date',   defSize:10,defBold:false},
  num:   {label:'# Номер',   cls:'m-num',    defSize:9, defBold:false},
};
const ALIGN_ICONS={left:'⇤',center:'⊡',right:'⇥'};

// ── Editor state ──────────────────────────────────────
let _selectedField=null;
let _armedField=null;
const _markerEls={};
let _toolbarEl=null;
const _guides={h:null,v:null};
let _dragMeta={field:null,ox:0,oy:0};

// ── Zoom ─────────────────────────────────────────────
let _zoom=1.0;
const ZOOM_STEPS=[0.5,0.67,0.75,1.0,1.25,1.5,2.0];

function setZoom(z){
  _zoom=z;
  const host=$('canvas-host'),wrapper=$('zoom-wrapper');
  if(host){
    host.style.transform=`scale(${z})`;
    host.style.transformOrigin='top left';
  }
  if(wrapper&&host){
    wrapper.style.width =(ST.canvasW*z+40)+'px';
    wrapper.style.height=(ST.canvasH*z+40)+'px';
  }
  const zv=$('zoom-val');
  if(zv)zv.textContent=Math.round(z*100)+'%';
  $('zoom-out').disabled=(z<=ZOOM_STEPS[0]);
  $('zoom-in').disabled=(z>=ZOOM_STEPS[ZOOM_STEPS.length-1]);
  if(_selectedField)positionToolbar(_selectedField);
}
function zoomIn(){const i=ZOOM_STEPS.indexOf(_zoom);if(i<ZOOM_STEPS.length-1)setZoom(ZOOM_STEPS[i+1]);}
function zoomOut(){const i=ZOOM_STEPS.indexOf(_zoom);if(i>0)setZoom(ZOOM_STEPS[i-1]);}
function zoomFit(){
  const scroll=$('canvas-scroll');
  if(!scroll)return;
  const avail=scroll.clientWidth-48;
  const z=Math.max(0.5,Math.min(2.0,avail/ST.canvasW));
  const nearest=ZOOM_STEPS.reduce((a,b)=>Math.abs(b-z)<Math.abs(a-z)?b:a);
  setZoom(nearest);
}

// Canvas-space position from a mouse event on canvas-host
function getCanvasPos(e,hostEl){
  const r=hostEl.getBoundingClientRect();
  return{x:(e.clientX-r.left)/_zoom, y:(e.clientY-r.top)/_zoom};
}

// ── Live preview text ─────────────────────────────────
function getPreviewText(f){
  return{
    name:  $('f-name')?.value.trim()  ||'Олена Петренко',
    period:$('f-period')?.value.trim()||'Вер–Гру 2024',
    grade: $('f-grade')?.value.trim() ||'B2',
    date:  fmtDate(new Date()),
    num:   `№ ${getN()}`,
  }[f]||FIELD_META[f].label;
}
function updateAllMarkerPreviews(){
  Object.keys(FIELD_META).forEach(f=>{
    const el=_markerEls[f];if(!el)return;
    el.querySelector('.mk-preview').textContent=getPreviewText(f);
  });
}

// ── Snap ─────────────────────────────────────────────
const SNAP_T=10;
function computeSnap(x,y,excludeField=null){
  const host=$('canvas-host');
  if(!host)return{x,y,guideH:null,guideV:null};
  const W=ST.canvasW,H=ST.canvasH;
  let sx=x,sy=y,guideH=null,guideV=null;
  const snapX=[W/2,W/3,W*2/3];
  const snapY=[H/2,H/3,H*2/3];
  Object.entries(ST.placements).forEach(([f,pl])=>{
    if(f!==excludeField){snapX.push(pl.x);snapY.push(pl.y);}
  });
  for(const pt of snapX){if(Math.abs(x-pt)<SNAP_T){sx=pt;guideV=pt;break;}}
  for(const pt of snapY){if(Math.abs(y-pt)<SNAP_T){sy=pt;guideH=pt;break;}}
  return{x:sx,y:sy,guideH,guideV};
}
function ensureGuide(dir){
  if(_guides[dir])return _guides[dir];
  const el=document.createElement('div');
  el.className=`snap-guide snap-${dir}`;
  _guides[dir]=el;return el;
}
function showGuide(dir,pos){
  const host=$('canvas-host');if(!host)return;
  const el=ensureGuide(dir);
  if(!host.contains(el))host.appendChild(el);
  el.style.display='block';
  if(dir==='h'){el.style.top=pos+'px';el.style.height=(1/_zoom)+'px';}
  if(dir==='v'){el.style.left=pos+'px';el.style.width=(1/_zoom)+'px';}
}
function hideGuide(dir){const el=_guides[dir];if(el)el.style.display='none';}
function hideAllGuides(){hideGuide('h');hideGuide('v');}
function applySnap(rawX,rawY,excl){
  const{x,y,guideH,guideV}=computeSnap(rawX,rawY,excl);
  guideH!==null?showGuide('h',guideH):hideGuide('h');
  guideV!==null?showGuide('v',guideV):hideGuide('v');
  return{x,y};
}

// ── Floating toolbar (position:fixed, appended to body) ──
function getToolbar(){
  if(_toolbarEl)return _toolbarEl;
  const el=document.createElement('div');
  el.className='mtb';
  el.style.cssText='display:none;position:fixed;z-index:9999;';
  el.innerHTML=`
    <span class="mtb-lbl"></span>
    <div class="mtb-sep"></div>
    <button class="mtb-btn" data-a="sz-" title="Менший шрифт (−1)">−</button>
    <span class="mtb-sz">12</span>
    <button class="mtb-btn" data-a="sz+" title="Більший шрифт (+1)">+</button>
    <div class="mtb-sep"></div>
    <label class="mtb-cl" title="Колір тексту"><input type="color" class="mtb-color" value="#111111"/></label>
    <button class="mtb-btn mtb-b" data-a="bold" title="Жирний">B</button>
    <div class="mtb-sep"></div>
    <button class="mtb-btn mtb-al" data-a="al-left"   title="По лівому краю">⇤</button>
    <button class="mtb-btn mtb-al" data-a="al-center" title="По центру">⊡</button>
    <button class="mtb-btn mtb-al" data-a="al-right"  title="По правому краю">⇥</button>
    <div class="mtb-sep"></div>
    <span class="mtb-coord-lbl">X</span>
    <input type="number" class="mtb-coord-inp" id="mtb-xi" min="0"/>
    <span class="mtb-coord-lbl">Y</span>
    <input type="number" class="mtb-coord-inp" id="mtb-yi" min="0"/>
    <div class="mtb-sep"></div>
    <button class="mtb-btn mtb-x" data-a="del" title="Видалити поле (Del)">✕</button>
  `;
  el.addEventListener('mousedown',e=>e.stopPropagation());
  el.addEventListener('click',e=>{
    const a=e.target.closest('[data-a]')?.dataset.a;
    if(!a||!_selectedField)return;
    const pl=ST.placements[_selectedField];if(!pl)return;
    if(a==='sz-')pl.size=Math.max(6,pl.size-1);
    if(a==='sz+')pl.size=Math.min(72,pl.size+1);
    if(a==='bold'){pl.bold=!pl.bold;el.querySelector('.mtb-b').classList.toggle('on',pl.bold);}
    if(a==='al-left'||a==='al-center'||a==='al-right'){
      pl.align=a.replace('al-','');
      el.querySelectorAll('.mtb-al').forEach(b=>b.classList.toggle('on',b.dataset.a==='al-'+pl.align));
    }
    if(a==='del'){removeMarker(_selectedField);return;}
    el.querySelector('.mtb-sz').textContent=pl.size;
    refreshMarkerVisual(_selectedField);
    syncFieldItem(_selectedField);
    positionToolbar(_selectedField);
  });
  el.querySelector('.mtb-color').addEventListener('input',e=>{
    if(!_selectedField)return;
    const pl=ST.placements[_selectedField];if(!pl)return;
    pl.color=e.target.value;refreshMarkerVisual(_selectedField);syncFieldItem(_selectedField);
  });
  function applyCoord(axis,val){
    if(!_selectedField)return;
    const pl=ST.placements[_selectedField];if(!pl)return;
    const max=axis==='x'?ST.canvasW:ST.canvasH;
    pl[axis]=Math.max(0,Math.min(Math.round(val),max));
    const mel=_markerEls[_selectedField];
    if(mel)mel.style[axis==='x'?'left':'top']=pl[axis]+'px';
    positionToolbar(_selectedField);
  }
  el.querySelector('#mtb-xi').addEventListener('change',e=>applyCoord('x',+e.target.value));
  el.querySelector('#mtb-yi').addEventListener('change',e=>applyCoord('y',+e.target.value));
  [el.querySelector('#mtb-xi'),el.querySelector('#mtb-yi')].forEach(i=>{
    i.addEventListener('keydown',e=>{if(e.key==='Enter')i.blur();});
    i.addEventListener('click',e=>e.stopPropagation());
  });
  document.body.appendChild(el);
  _toolbarEl=el;return el;
}

function showToolbar(field){
  const pl=ST.placements[field];if(!pl)return;
  _selectedField=field;
  const tb=getToolbar();
  tb.style.display='flex';
  tb.querySelector('.mtb-lbl').textContent=FIELD_META[field].label;
  tb.querySelector('.mtb-sz').textContent=pl.size;
  tb.querySelector('.mtb-color').value=pl.color||'#111111';
  tb.querySelector('.mtb-b').classList.toggle('on',!!pl.bold);
  tb.querySelectorAll('.mtb-al').forEach(b=>b.classList.toggle('on',b.dataset.a==='al-'+(pl.align||'center')));
  updateXYInputs(pl);
  Object.entries(_markerEls).forEach(([f,m])=>m.classList.toggle('selected',f===field));
  positionToolbar(field);
}
function hideToolbar(){
  _selectedField=null;
  if(_toolbarEl)_toolbarEl.style.display='none';
  Object.values(_markerEls).forEach(m=>m.classList.remove('selected'));
}
function updateXYInputs(pl){
  if(!_toolbarEl)return;
  const xi=_toolbarEl.querySelector('#mtb-xi'),yi=_toolbarEl.querySelector('#mtb-yi');
  if(xi)xi.value=Math.round(pl.x);
  if(yi)yi.value=Math.round(pl.y);
}
function positionToolbar(field){
  const mel=_markerEls[field],tb=_toolbarEl;
  if(!mel||!tb||tb.style.display==='none')return;
  const r=mel.getBoundingClientRect(); // viewport coords (zoom already included)
  const tbH=tb.offsetHeight||44,tbW=tb.offsetWidth||360;
  const above=r.top-tbH-12;
  let top,below;
  if(above>8){top=above;below=false;}
  else{top=r.bottom+12;below=true;}
  tb.classList.toggle('below',below);
  const left=Math.max(8,Math.min(r.left-10,window.innerWidth-tbW-8));
  tb.style.top=top+'px';tb.style.left=left+'px';
}

// ── Markers ───────────────────────────────────────────
function addMarker(f,x,y){
  _markerEls[f]?.remove();delete _markerEls[f];
  const meta=FIELD_META[f];
  if(!ST.placements[f]){
    ST.placements[f]={x,y,size:meta.defSize,bold:meta.defBold,color:'#111111',align:'center'};
  }else{
    ST.placements[f].x=x;ST.placements[f].y=y;
    if(!ST.placements[f].align)ST.placements[f].align='center';
  }
  const pl=ST.placements[f];
  const el=document.createElement('div');
  el.className=`marker ${meta.cls}`;
  el.dataset.f=f;el.style.left=x+'px';el.style.top=y+'px';el.draggable=true;
  el.innerHTML=`<span class="mk-preview">${getPreviewText(f)}</span><span class="mk-sz">${pl.size}px</span>`;
  el.addEventListener('click',e=>{
    e.stopPropagation();
    _selectedField===f?hideToolbar():showToolbar(f);
  });
  el.addEventListener('dragstart',e=>{
    hideToolbar();
    const r=el.getBoundingClientRect();
    const ox=(e.clientX-r.left-r.width/2)/_zoom;
    const oy=(e.clientY-r.top-r.height/2)/_zoom;
    _dragMeta={field:f,ox,oy};
    e.dataTransfer.setData('f',f);e.dataTransfer.setData('src','marker');
    e.dataTransfer.setData('ox',String(ox));e.dataTransfer.setData('oy',String(oy));
  });
  el.addEventListener('dragend',()=>{
    hideAllGuides();
    setTimeout(()=>{if(ST.placements[f])showToolbar(f);},80);
  });
  $('canvas-host').appendChild(el);
  _markerEls[f]=el;
  refreshMarkerVisual(f);syncFieldItem(f);updatePlacedInfo();
}

function removeMarker(f){
  _markerEls[f]?.remove();delete _markerEls[f];delete ST.placements[f];
  if(_selectedField===f)hideToolbar();
  syncFieldItem(f);updatePlacedInfo();
}

function moveMarker(f,x,y){
  const pl=ST.placements[f],el=_markerEls[f];if(!pl||!el)return;
  pl.x=Math.max(0,Math.min(Math.round(x),ST.canvasW));
  pl.y=Math.max(0,Math.min(Math.round(y),ST.canvasH));
  el.style.left=pl.x+'px';el.style.top=pl.y+'px';
  if(_selectedField===f){positionToolbar(f);updateXYInputs(pl);}
}

function refreshMarkerVisual(f){
  const el=_markerEls[f],pl=ST.placements[f];if(!el||!pl)return;
  el.querySelector('.mk-preview').textContent=getPreviewText(f);
  el.querySelector('.mk-sz').textContent=`${pl.size}px ${ALIGN_ICONS[pl.align||'center']}`;
  el.style.fontWeight=pl.bold?'900':'700';
  // Transform origin by alignment
  const txMap={left:'translate(0,-50%)',center:'translate(-50%,-50%)',right:'translate(-100%,-50%)'};
  el.style.transform=txMap[pl.align||'center'];
  // Color ring
  const noClr=!pl.color||pl.color==='#111111';
  el.style.outline=noClr?'':`3px solid ${pl.color}`;
  el.style.outlineOffset=noClr?'':'2px';
}

// ── Arrow-key nudge ───────────────────────────────────
document.addEventListener('keydown',e=>{
  if($('modal').style.display==='none')return;
  if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(e.key==='Delete'||e.key==='Backspace'){
    if(_selectedField){e.preventDefault();removeMarker(_selectedField);}
    return;
  }
  if(e.key==='Escape'){
    if(_armedField){setArmedField(null);}
    else if(_selectedField){hideToolbar();}
    return;
  }
  if(!_selectedField)return;
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();
  const step=e.shiftKey?10:1,pl=ST.placements[_selectedField];if(!pl)return;
  if(e.key==='ArrowLeft') pl.x-=step;
  if(e.key==='ArrowRight')pl.x+=step;
  if(e.key==='ArrowUp')   pl.y-=step;
  if(e.key==='ArrowDown') pl.y+=step;
  moveMarker(_selectedField,pl.x,pl.y);
  syncFieldItem(_selectedField);
});

// ── Field items ───────────────────────────────────────
function buildFieldItems(){
  const list=$('field-list');if(!list)return;
  list.innerHTML='';
  Object.entries(FIELD_META).forEach(([f,meta])=>{
    const item=document.createElement('div');
    item.className='fi';item.id=`fi-${f}`;item.dataset.f=f;item.draggable=true;
    item.innerHTML=`
      <div class="fi-top">
        <span class="fi-lbl">${meta.label}</span>
        <span class="fi-badge" id="fib-${f}">Не розміщено</span>
      </div>
      <div class="fi-settings" id="fis-${f}">
        <div class="fi-sz-ctrl">
          <button class="fi-sz-btn" data-f="${f}" data-a="sz-">−</button>
          <span class="fi-sz-val" id="fisz-${f}">12</span>
          <button class="fi-sz-btn" data-f="${f}" data-a="sz+">+</button>
        </div>
        <label title="Колір" style="display:flex;align-items:center">
          <input type="color" class="fi-color" id="fic-${f}" value="#111111"/>
        </label>
        <button class="fi-bold-btn" id="fib2-${f}" data-f="${f}" data-a="bold">B</button>
        <div class="fi-align-ctrl">
          <button class="fi-al-btn" data-f="${f}" data-a="al-left"   title="По лівому краю">⇤</button>
          <button class="fi-al-btn" data-f="${f}" data-a="al-center" title="По центру">⊡</button>
          <button class="fi-al-btn" data-f="${f}" data-a="al-right"  title="По правому краю">⇥</button>
        </div>
        <button class="fi-del-btn" data-f="${f}" data-a="del" title="Видалити">✕</button>
      </div>
    `;
    item.querySelector('.fi-top').addEventListener('click',()=>armField(f));
    item.addEventListener('click',e=>{
      const btn=e.target.closest('[data-a]');if(!btn)return;
      const field=btn.dataset.f,action=btn.dataset.a;
      const pl=ST.placements[field];if(!pl)return;
      e.stopPropagation();
      if(action==='sz-')pl.size=Math.max(6,pl.size-1);
      if(action==='sz+')pl.size=Math.min(72,pl.size+1);
      if(action==='bold')pl.bold=!pl.bold;
      if(action==='al-left'||action==='al-center'||action==='al-right')pl.align=action.replace('al-','');
      if(action==='del'){removeMarker(field);return;}
      refreshMarkerVisual(field);syncFieldItem(field);
      if(_selectedField===field&&_toolbarEl){
        _toolbarEl.querySelector('.mtb-sz').textContent=pl.size;
        _toolbarEl.querySelector('.mtb-b').classList.toggle('on',!!pl.bold);
        _toolbarEl.querySelectorAll('.mtb-al').forEach(b=>b.classList.toggle('on',b.dataset.a==='al-'+pl.align));
      }
    });
    item.querySelector('.fi-color').addEventListener('input',e=>{
      e.stopPropagation();
      const pl=ST.placements[f];if(!pl)return;
      pl.color=e.target.value;refreshMarkerVisual(f);
      if(_selectedField===f&&_toolbarEl)_toolbarEl.querySelector('.mtb-color').value=e.target.value;
    });
    item.querySelector('.fi-color').addEventListener('click',e=>e.stopPropagation());
    item.addEventListener('dragstart',e=>{
      setArmedField(null);
      _dragMeta={field:f,ox:0,oy:0};
      e.dataTransfer.setData('f',f);e.dataTransfer.setData('src','chip');
    });
    list.appendChild(item);
  });
}

function syncFieldItem(f){
  const item=$(`fi-${f}`),badge=$(`fib-${f}`),szEl=$(`fisz-${f}`),fib2=$(`fib2-${f}`),fic=$(`fic-${f}`);
  if(!item)return;
  const pl=ST.placements[f];
  if(pl){
    item.classList.add('placed');badge.textContent='✓ Розміщено';
    if(szEl)szEl.textContent=pl.size;
    if(fib2)fib2.classList.toggle('on',!!pl.bold);
    if(fic)fic.value=pl.color||'#111111';
    item.querySelectorAll('.fi-al-btn').forEach(b=>b.classList.toggle('on',b.dataset.a==='al-'+(pl.align||'center')));
  }else{
    item.classList.remove('placed');badge.textContent='Не розміщено';
  }
}

function armField(f){f===_armedField?setArmedField(null):setArmedField(f);}
function setArmedField(f){
  _armedField=f;
  document.querySelectorAll('.fi').forEach(el=>el.classList.toggle('armed',el.dataset.f===f));
  const host=$('canvas-host'),hint=$('arm-hint'),hintTx=$('arm-hint-text');
  if(f){
    hint.style.display='flex';hintTx.textContent=`Клікніть на шаблоні → ${FIELD_META[f].label}`;
    if(host)host.classList.add('armed-mode');hideToolbar();
  }else{
    hint.style.display='none';
    if(host)host.classList.remove('armed-mode');hideAllGuides();
  }
}
function updatePlacedInfo(){
  const keys=Object.keys(ST.placements),el=$('placed-info');if(!el)return;
  el.textContent=keys.length?`✓ Розміщено: ${keys.map(f=>FIELD_META[f].label).join(', ')}`:'Нічого не розміщено';
}

// ── Open editor ───────────────────────────────────────
async function openEditor(bytes,isBulk){
  ST.editorIsBulk=isBulk;
  const pdfjsDoc=await pdfjsLib.getDocument({data:bytes.slice(0)}).promise;
  const pg=await pdfjsDoc.getPage(1);
  const vp0=pg.getViewport({scale:1});
  ST.pdfW=vp0.width;ST.pdfH=vp0.height;

  // Initial scale to fit
  const maxW=Math.min(window.innerWidth*0.60,740);
  const scale=maxW/vp0.width;
  const vp=pg.getViewport({scale});
  const cvs=$('editor-canvas');
  cvs.width=Math.floor(vp.width);cvs.height=Math.floor(vp.height);
  ST.canvasW=cvs.width;ST.canvasH=cvs.height;
  await pg.render({canvasContext:cvs.getContext('2d'),viewport:vp}).promise;

  hideToolbar();setArmedField(null);hideAllGuides();
  Object.keys(_markerEls).forEach(f=>{_markerEls[f]?.remove();delete _markerEls[f];});
  buildFieldItems();

  // Reset zoom to 1.0 on open
  _zoom=1.0;
  const host=$('canvas-host'),wrapper=$('zoom-wrapper');
  if(host){host.style.transform='scale(1)';host.style.transformOrigin='top left';}
  if(wrapper){wrapper.style.width=(ST.canvasW+40)+'px';wrapper.style.height=(ST.canvasH+40)+'px';}
  const zv=$('zoom-val');if(zv)zv.textContent='100%';
  if($('zoom-out'))$('zoom-out').disabled=false;
  if($('zoom-in'))$('zoom-in').disabled=false;

  Object.entries(ST.placements).forEach(([f,pos])=>addMarker(f,pos.x,pos.y));
  $('modal').style.display='flex';
  bindDnD();
}

// ── Drag & Drop ───────────────────────────────────────
function bindDnD(){
  const host=$('canvas-host');
  const newHost=host.cloneNode(false);
  while(host.firstChild)newHost.appendChild(host.firstChild);
  host.parentNode.replaceChild(newHost,host);
  newHost.id='canvas-host';
  // Re-ensure guides in new host
  Object.values(_guides).forEach(g=>{if(g&&!newHost.contains(g))newHost.appendChild(g);});

  newHost.addEventListener('dragover',e=>{
    e.preventDefault();
    const pos=getCanvasPos(e,newHost);
    const{guideH,guideV}=computeSnap(pos.x-_dragMeta.ox,pos.y-_dragMeta.oy,_dragMeta.field);
    guideH!==null?showGuide('h',guideH):hideGuide('h');
    guideV!==null?showGuide('v',guideV):hideGuide('v');
  });
  newHost.addEventListener('dragleave',()=>hideAllGuides());
  newHost.addEventListener('drop',e=>{
    e.preventDefault();hideAllGuides();
    const f=e.dataTransfer.getData('f'),src=e.dataTransfer.getData('src');
    if(!f)return;
    const pos=getCanvasPos(e,newHost);
    let x=pos.x,y=pos.y;
    if(src==='marker'){
      x-=parseFloat(e.dataTransfer.getData('ox')||0);
      y-=parseFloat(e.dataTransfer.getData('oy')||0);
    }
    const snapped=applySnap(x,y,f);hideAllGuides();
    addMarker(f,snapped.x,snapped.y);
    setTimeout(()=>showToolbar(f),80);
  });

  // Hover in armed mode: show snap preview
  newHost.addEventListener('mousemove',e=>{
    if(!_armedField)return;
    const pos=getCanvasPos(e,newHost);
    const{guideH,guideV}=computeSnap(pos.x,pos.y,_armedField);
    guideH!==null?showGuide('h',guideH):hideGuide('h');
    guideV!==null?showGuide('v',guideV):hideGuide('v');
  });
  newHost.addEventListener('mouseleave',()=>{if(_armedField)hideAllGuides();});

  // Click: place armed field or deselect
  newHost.addEventListener('mousedown',e=>{
    const inMarker=e.target.closest('.marker');
    const inToolbar=e.target.closest('.mtb');
    if(inMarker||inToolbar)return;
    if(_armedField){
      const pos=getCanvasPos(e,newHost);
      const snapped=applySnap(pos.x,pos.y,_armedField);
      const armed=_armedField;setArmedField(null);hideAllGuides();
      addMarker(armed,snapped.x,snapped.y);
      setTimeout(()=>showToolbar(armed),60);
    }else{hideToolbar();}
  });

  // Reposition toolbar on scroll
  $('canvas-scroll')?.removeEventListener('scroll',_onScroll);
  $('canvas-scroll')?.addEventListener('scroll',_onScroll);
}
function _onScroll(){if(_selectedField&&_toolbarEl?.style.display!=='none')positionToolbar(_selectedField);}

// ── Modal buttons ─────────────────────────────────────
$('modal-x').addEventListener('click',()=>{$('modal').style.display='none';setArmedField(null);hideToolbar();});
$('modal-reset').addEventListener('click',()=>{[...Object.keys(ST.placements)].forEach(f=>removeMarker(f));hideToolbar();updatePlacedInfo();});
$('modal-ok').addEventListener('click',()=>{
  $('modal').style.display='none';setArmedField(null);
  const n=Object.keys(ST.placements).length;
  if(!n){toast('⚠️ Жодного поля не розміщено','err');return;}
  toast(`✅ ${n} ${n===1?'поле збережено':'полів збережено'}`,'ok');
  if(!ST.editorIsBulk)renderPreview();
});
$('arm-cancel').addEventListener('click',()=>setArmedField(null));

// Zoom controls
document.addEventListener('click',e=>{
  if(e.target.id==='zoom-in')  zoomIn();
  if(e.target.id==='zoom-out') zoomOut();
  if(e.target.id==='zoom-fit') zoomFit();
});
document.addEventListener('keydown',e=>{
  if($('modal').style.display==='none')return;
  if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key==='='){e.preventDefault();zoomIn();}
  if((e.ctrlKey||e.metaKey)&&e.key==='-'){e.preventDefault();zoomOut();}
  if((e.ctrlKey||e.metaKey)&&e.key==='0'){e.preventDefault();zoomFit();}
});

// ── Bulk auto-preview ─────────────────────────────────
async function autoPreviewBulk(){
  if(!ST.excelRows.length)return;
  const{name,period,grade}=ST.excelRows[0];
  try{
    const bytes=await buildCert({name,period,grade,num:'001',date:fmtDate(new Date()),tpl:ST.bulkTplBytes});
    await renderToBox(bytes,'bulk-prev-box');
  }catch(e){console.warn('bulk preview:',e);}
}

// ── Excel parser ──────────────────────────────────────
function parseExcel(buf){
  try{
    const wb=XLSX.read(buf,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
    if(!rows.length){toast('❌ Таблиця порожня','err');return;}
    const get=(row,...keys)=>{
      for(const k of keys){const found=Object.keys(row).find(rk=>rk.toLowerCase().trim()===k);if(found&&String(row[found]).trim())return String(row[found]).trim();}
      return'';
    };
    ST.excelRows=rows.map(r=>({
      name:  get(r,'name','піб','pib','студент','student'),
      period:get(r,'period','період','term'),
      grade: get(r,'grade','грейд','рівень','level'),
    })).filter(r=>r.name);
    if(!ST.excelRows.length){toast('❌ Не знайдено колонку name/ПІБ','err');return;}
    $('st-count').textContent=`${ST.excelRows.length} студентів`;
    $('stl').innerHTML=ST.excelRows.slice(0,8).map((s,i)=>
      `<div class="sr"><span class="si">${i+1}</span><span style="flex:1">${s.name}</span><span class="sg">${s.grade||'—'}</span></div>`
    ).join('')+(ST.excelRows.length>8?`<div style="padding:4px 8px;font-size:11px;color:#9ca3af">…ще ${ST.excelRows.length-8}</div>`:'');
    $('stbox').style.display='block';$('btn-bulk').disabled=false;
    toast(`✅ ${ST.excelRows.length} студентів завантажено`,'ok');
    autoPreviewBulk(); // ← автопревью першого запису
  }catch(e){toast('❌ Excel: '+e.message,'err');}
}

// ── Validation ────────────────────────────────────────
function validate(name,period,grade){
  let ok=true;
  [['f-name',name],['f-period',period],['f-grade',grade]].forEach(([id,v])=>{
    $(id).classList.toggle('err',!v);if(!v)ok=false;
  });
  if(!ok)toast('⚠️ Заповніть всі поля','err');
  return ok;
}

// ── Downloads ─────────────────────────────────────────
function dlPdf(bytes,name){dlBlob(new Blob([bytes],{type:'application/pdf'}),name);}
function dlBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=Object.assign(document.createElement('a'),{href:url,download:name});
  document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},3000);
}

// ── Progress ──────────────────────────────────────────
function showProg(msg,pct){$('prog-overlay').style.display='flex';setMsg(msg);setP(pct);}
function setP(p){$('prog-bar').style.width=p+'%';}
function setMsg(m){$('prog-msg').textContent=m;}
function hideProg(){setTimeout(()=>$('prog-overlay').style.display='none',500);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ── Toast ─────────────────────────────────────────────
let _tid;
function toast(msg,type=''){
  const el=$('toast');el.textContent=msg;el.className=`toast show ${type}`;
  clearTimeout(_tid);_tid=setTimeout(()=>el.classList.remove('show'),3500);
}

window.addEventListener('load',renderPreview);
