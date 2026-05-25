/* =====================================================
   Certificate Generator — script.js
   GitHub Pages compatible (static, no server)
   Fonts: DejaVu Sans embedded in fonts.js (Cyrillic ✓)
   pdf-lib + fontkit from CDN
   ===================================================== */

const $   = id => document.getElementById(id);
const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtDate = d => d.toLocaleDateString('uk-UA', {day:'2-digit',month:'2-digit',year:'numeric'});
const sanitize = s => (s||'cert').replace(/\s+/g,'_').replace(/[^\w]/g,'').slice(0,50)||'cert';

function getN()  { return parseInt(localStorage.getItem('cn')||'1000',10); }
function nextN() { const n=getN()+1; localStorage.setItem('cn',n); return String(n); }

// ── State ─────────────────────────────────────────────
const ST = {
  tplBytes:     null,
  bulkTplBytes: null,
  excelRows:    [],
  // placements[field] = { x, y, size, color, bold }
  placements:   {},
  canvasW: 1, canvasH: 1,
  pdfW: 842, pdfH: 595,
  editorIsBulk: false,
  style: { ns:28, gs:18, bs:11, color:'#111111' },
};

// ── Font embedding ────────────────────────────────────
function waitForFontkit(ms = 8000) {
  if (typeof fontkit !== 'undefined') return Promise.resolve(fontkit);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      if (typeof fontkit !== 'undefined') { clearInterval(id); resolve(fontkit); }
      else if (Date.now() - t0 > ms) { clearInterval(id); resolve(null); }
    }, 80);
  });
}

function trl(s) {
  const m={'А':'A','Б':'B','В':'V','Г':'H','Ґ':'G','Д':'D','Е':'E','Є':'Ye','Ж':'Zh','З':'Z','И':'Y','І':'I','Ї':'Yi','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ю':'Yu','Я':'Ya','Ь':"'",'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ie','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ю':'yu','я':'ya','ь':"'"};
  return (s||'').split('').map(c=>m[c]??c).join('');
}

async function embedFonts(doc) {
  const { StandardFonts } = PDFLib;
  const fk = await waitForFontkit();
  if (fk) {
    try {
      doc.registerFontkit(fk);
      const fontR = await doc.embedFont(getFontR().slice(0));
      const fontB = await doc.embedFont(getFontB().slice(0));
      return { fontR, fontB, cyrillic: true };
    } catch(e) {
      console.warn('Custom font embed failed:', e.message);
    }
  }
  console.info('Using Helvetica fallback. Text will be transliterated.');
  return {
    fontR: await doc.embedFont(StandardFonts.Helvetica),
    fontB: await doc.embedFont(StandardFonts.HelveticaBold),
    cyrillic: false,
  };
}

function parseHexColor(hex) {
  const { rgb } = PDFLib;
  const h = (hex||'#111111').replace('#','');
  return rgb(
    parseInt(h.slice(0,2),16)/255,
    parseInt(h.slice(2,4),16)/255,
    parseInt(h.slice(4,6),16)/255
  );
}

// ── Tabs ──────────────────────────────────────────────
document.querySelectorAll('.tb').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tb').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tp').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('panel-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Upload helper ─────────────────────────────────────
function mkUpload({ dzId, inId, chId, nmId, rmId, onLoad, onClear }) {
  const dz=$(dzId), inp=$(inId), ch=$(chId), nm=$(nmId), rm=$(rmId);
  dz.addEventListener('click', () => inp.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handle(e.dataTransfer.files[0]); });
  inp.addEventListener('change', e => { handle(e.target.files[0]); inp.value=''; });
  rm.addEventListener('click', () => { ch.style.display='none'; dz.style.display='flex'; onClear?.(); });
  function handle(file) {
    if (!file) return;
    nm.textContent = file.name;
    ch.style.display='flex'; dz.style.display='none';
    const fr = new FileReader();
    fr.onload = e => onLoad(new Uint8Array(e.target.result), file.name);
    fr.readAsArrayBuffer(file);
  }
}

// ── Single template ───────────────────────────────────
mkUpload({
  dzId:'dz-tpl', inId:'in-tpl', chId:'ch-tpl', nmId:'ch-tpl-name', rmId:'rm-tpl',
  onLoad: async (bytes, name) => {
    ST.tplBytes = bytes;
    ST.placements = {};
    toast(`Шаблон "${name}" завантажено`, 'ok');
    await openEditor(bytes, false);
    renderPreview();
  },
  onClear: () => { ST.tplBytes=null; ST.placements={}; renderPreview(); }
});
$('btn-edit-tpl').addEventListener('click', () => { if(ST.tplBytes) openEditor(ST.tplBytes, false); });

// ── Bulk template ─────────────────────────────────────
mkUpload({
  dzId:'dz-bulk-tpl', inId:'in-bulk-tpl', chId:'ch-bulk-tpl', nmId:'ch-bulk-tpl-name', rmId:'rm-bulk-tpl',
  onLoad: async (bytes, name) => {
    ST.bulkTplBytes = bytes;
    toast(`Шаблон "${name}" завантажено`, 'ok');
    await openEditor(bytes, true);
  },
  onClear: () => { ST.bulkTplBytes=null; }
});
$('btn-edit-bulk-tpl').addEventListener('click', () => { if(ST.bulkTplBytes) openEditor(ST.bulkTplBytes, true); });

// ── Excel ─────────────────────────────────────────────
mkUpload({
  dzId:'dz-excel', inId:'in-excel', chId:'ch-excel', nmId:'ch-excel-name', rmId:'rm-excel',
  onLoad: (buf) => parseExcel(buf),
  onClear: () => {
    ST.excelRows=[];
    $('stbox').style.display='none';
    $('btn-bulk').disabled=true;
    clearCanvas('bulk-prev-box');
  }
});

// ── Style sliders ─────────────────────────────────────
[['s-ns','s-ns-v','ns'],['s-gs','s-gs-v','gs'],['s-bs','s-bs-v','bs']].forEach(([id,vid,k])=>{
  $(id).addEventListener('input', e => { ST.style[k]=+e.target.value; $(vid).textContent=e.target.value; renderPreview(); });
});
$('s-col').addEventListener('input', e => { ST.style.color=e.target.value; $('s-col-v').textContent=e.target.value; renderPreview(); });

// ── Live preview ──────────────────────────────────────
['f-name','f-period','f-grade'].forEach(id => $(id).addEventListener('input', deb(renderPreview, 350)));

// ── Generate single ───────────────────────────────────
$('btn-gen').addEventListener('click', async () => {
  const name   = $('f-name').value.trim();
  const period = $('f-period').value.trim();
  const grade  = $('f-grade').value.trim();
  if (!validate(name, period, grade)) return;

  showProg('Генерація PDF…', 10);
  try {
    const num  = nextN();
    const date = fmtDate(new Date());
    const bytes = await buildCert({ name, period, grade, num, date, tpl: ST.tplBytes });
    setP(85);
    await renderToBox(bytes, 'prev-box');
    setP(100);
    await sleep(200);
    dlPdf(bytes, `cert_${sanitize(name)}_${num}.pdf`);
    toast(`✅ Сертифікат №${num} завантажено!`, 'ok');
  } catch(e) {
    console.error(e);
    toast('❌ ' + e.message, 'err');
  } finally { hideProg(); }
});

// ── Generate bulk ─────────────────────────────────────
$('btn-bulk').addEventListener('click', async () => {
  if (!ST.excelRows.length) return;
  const total = ST.excelRows.length;
  showProg(`Генерація 0 / ${total}…`, 0);
  try {
    const zip  = new JSZip();
    const date = fmtDate(new Date());
    for (let i=0; i<total; i++) {
      const { name, period, grade } = ST.excelRows[i];
      const num   = nextN();
      const bytes = await buildCert({ name, period, grade, num, date, tpl: ST.bulkTplBytes });
      zip.file(`${String(i+1).padStart(3,'0')}_${sanitize(name)}.pdf`, bytes);
      setP(Math.round((i+1)/total*88));
      setMsg(`Генерація ${i+1} / ${total}…`);
      if (i%5===4) await sleep(0);
    }
    setMsg('Пакування ZIP…'); setP(94);
    const blob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{level:3} });
    setP(100); await sleep(200);
    dlBlob(blob, `certs_${Date.now()}.zip`);
    toast(`✅ ${total} сертифікатів у ZIP!`, 'ok');
  } catch(e) {
    console.error(e);
    toast('❌ ' + e.message, 'err');
  } finally { hideProg(); }
});

// ── PDF Builder ───────────────────────────────────────
async function buildCert({ name, period, grade, num, date, tpl }) {
  const { PDFDocument, rgb } = PDFLib;

  let doc;
  if (tpl) {
    doc = await PDFDocument.load(tpl.slice(0));
  } else {
    doc = await PDFDocument.create();
    doc.addPage([842, 595]);
  }

  const page = doc.getPages()[0];
  const { width:W, height:H } = page.getSize();

  const { fontR, fontB, cyrillic } = await embedFonts(doc);
  const tx = cyrillic ? (s => s) : trl;

  const tName   = tx(name);
  const tPeriod = tx(period);
  const tGrade  = tx(grade);
  const tDate   = tx(date);

  // Global color fallback
  const clr = parseHexColor(ST.style.color);
  const NS=ST.style.ns, GS=ST.style.gs, BS=ST.style.bs;

  function ctext(txt, cx, y, font, size, color) {
    if (!txt) return;
    const w = font.widthOfTextAtSize(txt, size);
    page.drawText(txt, { x: cx-w/2, y, size, font, color });
  }
  function fit(txt, font, pref, min, maxW) {
    let s=pref; while(s>min && font.widthOfTextAtSize(txt,s)>maxW) s-=0.5; return s;
  }

  if (tpl && Object.keys(ST.placements).length > 0) {
    // ── Custom template with drag-drop placements ──
    const sx = W / ST.canvasW;
    const sy = H / ST.canvasH;

    const FIELDS = {
      name:   { text: tName,         defSize: NS,   defBold: true  },
      period: { text: tPeriod,       defSize: BS,   defBold: false },
      grade:  { text: tGrade,        defSize: GS,   defBold: true  },
      date:   { text: tDate,         defSize: BS-1, defBold: false },
      num:    { text: `№ ${num}`,    defSize: BS-2, defBold: false },
    };

    for (const [field, cfg] of Object.entries(FIELDS)) {
      const pl = ST.placements[field];
      if (!pl) continue;
      const bold = pl.bold ?? cfg.defBold;
      const font = bold ? fontB : fontR;
      const sz   = fit(cfg.text, font, pl.size ?? cfg.defSize, 6, W * 0.8);
      const fieldClr = pl.color ? parseHexColor(pl.color) : clr;
      const pdfX = pl.x * sx;
      const pdfY = H - (pl.y * sy);
      ctext(cfg.text, pdfX, pdfY - sz*0.3, font, sz, fieldClr);
    }

  } else {
    // ── Default design ──
    drawDefault({ page, W, H, fontR, fontB, rgb, ctext, fit,
      name: tName, period: tPeriod, grade: tGrade, date: tDate, num,
      NS, GS, BS, clr, cyrillic });
  }

  return doc.save();
}

function drawDefault({ page, W, H, fontR, fontB, rgb, ctext, fit, name, period, grade, date, num, NS, GS, BS, clr, cyrillic }) {
  const L = cyrillic ? {
    confirms:  'Цей сертифікат підтверджує, що',
    completed: 'успішно завершив(ла) курс навчання',
    period:    'Період навчання: ',
    issued:    'Видано: ',
    certNum:   '№ ',
  } : {
    confirms:  'Tsiei sertyfikat pidtverdzhuie, shcho',
    completed: 'uspishno zavershyv(la) kurs navchannia',
    period:    'Period navchannia: ',
    issued:    'Vydano: ',
    certNum:   'No ',
  };
  page.drawRectangle({ x:0, y:0, width:W, height:H, color:rgb(1,1,1) });
  page.drawRectangle({ x:14, y:14, width:W-28, height:H-28, borderColor:rgb(.76,.63,.38), borderWidth:2, color:rgb(1,1,1) });
  page.drawRectangle({ x:22, y:22, width:W-44, height:H-44, borderColor:rgb(.86,.76,.56), borderWidth:.5, color:rgb(1,1,1) });
  page.drawRectangle({ x:14, y:H-74, width:W-28, height:60, color:rgb(.08,.11,.22) });
  ctext('IT STEP Academy', W/2, H-54, fontB, 11, rgb(.86,.72,.40));
  ctext('CERTIFICATE OF COMPLETION', W/2, H-68, fontR, 7.5, rgb(.55,.55,.62));
  ctext(L.confirms, W/2, H-108, fontR, BS, rgb(.5,.5,.5));
  page.drawLine({ start:{x:W*.15,y:H-127}, end:{x:W*.85,y:H-127}, thickness:.5, color:rgb(.76,.63,.38) });
  const nSz = fit(name, fontB, NS, 12, W*.68);
  ctext(name, W/2, H-172, fontB, nSz, clr);
  page.drawLine({ start:{x:W*.15,y:H-189}, end:{x:W*.85,y:H-189}, thickness:.5, color:rgb(.76,.63,.38) });
  ctext(L.completed, W/2, H-216, fontR, BS, rgb(.45,.45,.45));
  const gSz = fit(grade, fontB, GS, 9, W*.65);
  ctext(grade, W/2, H-250, fontB, gSz, rgb(.76,.50,.16));
  page.drawLine({ start:{x:W*.28,y:H-264}, end:{x:W*.72,y:H-264}, thickness:.3, color:rgb(.84,.76,.58) });
  ctext(L.period + period, W/2, H-289, fontR, BS, rgb(.42,.42,.42));
  [[28,28],[W-28,28],[28,H-28],[W-28,H-28]].forEach(([x,y]) =>
    page.drawRectangle({ x:x-5, y:y-5, width:10, height:10, color:rgb(.76,.63,.38), opacity:.5 }));
  ctext(L.certNum+num, W*.22, 34, fontR, 8, rgb(.55,.55,.55));
  ctext(L.issued+date, W*.78, 34, fontR, 8, rgb(.55,.55,.55));
}

// ── Preview rendering ─────────────────────────────────
let _rseq = 0;
async function renderToBox(pdfBytes, boxId) {
  const box = $(boxId);
  if (!box) return;
  const seq = ++_rseq;
  const ph  = box.querySelector('.prev-ph');
  try {
    const doc  = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
    if (seq !== _rseq) return;
    const page = await doc.getPage(1);
    if (seq !== _rseq) return;
    const W   = Math.max((box.clientWidth||520) - 20, 250);
    const vp0 = page.getViewport({ scale:1 });
    const sc  = Math.min(W / vp0.width, 1.4);
    const vp  = page.getViewport({ scale: sc });
    box.querySelectorAll('canvas').forEach(c=>c.remove());
    const cvs = document.createElement('canvas');
    cvs.width  = Math.floor(vp.width);
    cvs.height = Math.floor(vp.height);
    cvs.style.cssText = 'display:block;max-width:100%;height:auto;border-radius:3px;box-shadow:0 2px 12px rgba(0,0,0,.12)';
    box.appendChild(cvs);
    if (seq !== _rseq) { cvs.remove(); return; }
    await page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
    if (ph) ph.style.display = 'none';
  } catch(e) {
    if (e?.name !== 'RenderingCancelledException') console.error('render:', e);
  }
}

async function renderPreview() {
  const name   = $('f-name').value.trim()   || 'Олена Петренко';
  const period = $('f-period').value.trim() || 'Вересень–Грудень 2024';
  const grade  = $('f-grade').value.trim()  || 'B2';
  try {
    const bytes = await buildCert({ name, period, grade, num:'####', date:fmtDate(new Date()), tpl:ST.tplBytes });
    await renderToBox(bytes, 'prev-box');
  } catch(e) { console.warn('preview:', e); }
}

function clearCanvas(boxId) {
  const box=$(boxId);
  if (!box) return;
  box.querySelectorAll('canvas').forEach(c=>c.remove());
  const ph=box.querySelector('.prev-ph');
  if (ph) ph.style.display='flex';
}

// ══════════════════════════════════════════════════════
//  EDITOR — field placement modal
// ══════════════════════════════════════════════════════

const FIELD_META = {
  name:   { label:'👤 ПІБ',    cls:'m-name',   defSize:28, defBold:true  },
  period: { label:'📅 Період', cls:'m-period', defSize:11, defBold:false },
  grade:  { label:'🎓 Грейд',  cls:'m-grade',  defSize:18, defBold:true  },
  date:   { label:'📆 Дата',   cls:'m-date',   defSize:10, defBold:false },
  num:    { label:'# Номер',   cls:'m-num',    defSize:9,  defBold:false },
};

// ── Editor local state ────────────────────────────────
let _selectedField = null;
let _armedField    = null;
const _markerEls   = {};    // { field: HTMLElement }
let _toolbarEl     = null;

// ── Floating toolbar ──────────────────────────────────
function getToolbar() {
  if (_toolbarEl) return _toolbarEl;
  const el = document.createElement('div');
  el.className = 'mtb';
  el.style.display = 'none';
  el.innerHTML = `
    <span class="mtb-lbl"></span>
    <div class="mtb-sep"></div>
    <button class="mtb-btn" data-a="sz-" title="Зменшити розмір">−</button>
    <span class="mtb-sz">12</span>
    <button class="mtb-btn" data-a="sz+" title="Збільшити розмір">+</button>
    <div class="mtb-sep"></div>
    <label class="mtb-cl" title="Колір тексту">
      <input type="color" class="mtb-color" value="#111111"/>
    </label>
    <button class="mtb-btn mtb-b" data-a="bold" title="Жирний">B</button>
    <div class="mtb-sep"></div>
    <button class="mtb-btn mtb-x" data-a="del" title="Видалити поле">✕</button>
  `;

  // Prevent clicks inside toolbar from bubbling to canvas (deselect)
  el.addEventListener('mousedown', e => e.stopPropagation());

  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !_selectedField) return;
    const pl = ST.placements[_selectedField];
    if (!pl) return;

    if (a === 'sz-') pl.size = Math.max(6, pl.size - 1);
    if (a === 'sz+') pl.size = Math.min(72, pl.size + 1);
    if (a === 'bold') {
      pl.bold = !pl.bold;
      el.querySelector('.mtb-b').classList.toggle('on', pl.bold);
    }
    if (a === 'del') {
      removeMarker(_selectedField);
      return;
    }
    el.querySelector('.mtb-sz').textContent = pl.size;
    refreshMarkerVisual(_selectedField);
    positionToolbar(_selectedField);
    syncFieldItem(_selectedField);
  });

  el.querySelector('.mtb-color').addEventListener('input', e => {
    if (!_selectedField) return;
    const pl = ST.placements[_selectedField];
    if (!pl) return;
    pl.color = e.target.value;
    refreshMarkerVisual(_selectedField);
    syncFieldItem(_selectedField);
  });

  _toolbarEl = el;
  return el;
}

function showToolbar(field) {
  const pl = ST.placements[field];
  if (!pl) return;
  _selectedField = field;

  const tb   = getToolbar();
  const host = $('canvas-host');
  if (host && !host.contains(tb)) host.appendChild(tb);

  tb.style.display = 'flex';
  tb.querySelector('.mtb-lbl').textContent = FIELD_META[field].label;
  tb.querySelector('.mtb-sz').textContent  = pl.size;
  tb.querySelector('.mtb-color').value     = pl.color || '#111111';
  tb.querySelector('.mtb-b').classList.toggle('on', !!pl.bold);

  // Highlight the selected marker
  Object.entries(_markerEls).forEach(([f, m]) =>
    m.classList.toggle('selected', f === field)
  );

  positionToolbar(field);
}

function hideToolbar() {
  _selectedField = null;
  if (_toolbarEl) _toolbarEl.style.display = 'none';
  Object.values(_markerEls).forEach(m => m.classList.remove('selected'));
}

function positionToolbar(field) {
  const markerEl = _markerEls[field];
  const tb       = _toolbarEl;
  if (!markerEl || !tb) return;

  const x = parseFloat(markerEl.style.left) || 0;
  const y = parseFloat(markerEl.style.top)  || 0;
  const mW = markerEl.offsetWidth  || 80;
  const mH = markerEl.offsetHeight || 26;
  const tbH = 42;

  const above = y - mH / 2 - tbH - 12;

  if (above > 4) {
    tb.style.top = above + 'px';
    tb.classList.remove('below');
  } else {
    tb.style.top = (y + mH / 2 + 12) + 'px';
    tb.classList.add('below');
  }
  // Center toolbar over marker, clamp to canvas bounds
  const host = $('canvas-host');
  const maxLeft = host ? (host.offsetWidth - 20) : 9999;
  const tbW = tb.offsetWidth || 260;
  let left = x - mW / 2;
  left = Math.max(4, Math.min(left, maxLeft - tbW));
  tb.style.left = left + 'px';
}

// ── Marker elements ───────────────────────────────────
function addMarker(f, x, y) {
  // Remove existing DOM element (keep placement data)
  _markerEls[f]?.remove();
  delete _markerEls[f];

  const meta = FIELD_META[f];

  // Initialize placement if not already set
  if (!ST.placements[f]) {
    ST.placements[f] = {
      x, y,
      size:  meta.defSize,
      bold:  meta.defBold,
      color: '#111111',
    };
  } else {
    // Update position only
    ST.placements[f].x = x;
    ST.placements[f].y = y;
  }

  const pl = ST.placements[f];

  const el = document.createElement('div');
  el.className  = `marker ${meta.cls}`;
  el.dataset.f  = f;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  el.draggable  = true;
  el.innerHTML  = `<span class="mk-lbl">${meta.label}</span><span class="mk-sz">${pl.size}px</span>`;

  // Click → select & show toolbar
  el.addEventListener('click', e => {
    e.stopPropagation();
    if (_selectedField === f) {
      hideToolbar();
    } else {
      showToolbar(f);
    }
  });

  // Drag to reposition
  el.addEventListener('dragstart', e => {
    hideToolbar();
    const r = el.getBoundingClientRect();
    e.dataTransfer.setData('f', f);
    e.dataTransfer.setData('src', 'marker');
    e.dataTransfer.setData('ox', String(e.clientX - r.left  - r.width  / 2));
    e.dataTransfer.setData('oy', String(e.clientY - r.top   - r.height / 2));
  });
  el.addEventListener('dragend', () => {
    // Small delay so drop fires first
    setTimeout(() => showToolbar(f), 60);
  });

  const host = $('canvas-host');
  host.appendChild(el);
  _markerEls[f] = el;

  refreshMarkerVisual(f);
  syncFieldItem(f);
  updatePlacedInfo();
}

function removeMarker(f) {
  _markerEls[f]?.remove();
  delete _markerEls[f];
  delete ST.placements[f];
  if (_selectedField === f) hideToolbar();
  syncFieldItem(f);
  updatePlacedInfo();
}

function refreshMarkerVisual(f) {
  const el = _markerEls[f];
  const pl = ST.placements[f];
  if (!el || !pl) return;
  el.querySelector('.mk-sz').textContent = pl.size + 'px';
  el.style.fontWeight = pl.bold ? '900' : '700';
  // Color ring if custom color
  const isDefaultColor = !pl.color || pl.color === '#111111';
  el.style.outline = isDefaultColor ? '' : `3px solid ${pl.color}`;
  el.style.outlineOffset = isDefaultColor ? '' : '2px';
}

// ── Field items (left panel) ──────────────────────────
function buildFieldItems() {
  const list = $('field-list');
  if (!list) return;
  list.innerHTML = '';

  Object.entries(FIELD_META).forEach(([f, meta]) => {
    const item = document.createElement('div');
    item.className = 'fi';
    item.id = `fi-${f}`;
    item.draggable = true;
    item.dataset.f = f;

    item.innerHTML = `
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
        <label title="Колір тексту" style="display:flex;align-items:center">
          <input type="color" class="fi-color" id="fic-${f}" value="#111111"/>
        </label>
        <button class="fi-bold-btn" id="fib2-${f}" data-f="${f}" data-a="bold">B</button>
        <button class="fi-del-btn" data-f="${f}" data-a="del" title="Видалити">✕</button>
      </div>
    `;

    // Click on item → arm for click-to-place
    item.addEventListener('click', e => {
      // If settings controls clicked, don't arm
      if (e.target.closest('.fi-settings')) return;
      armField(f);
    });

    // Size/color/bold controls in left panel
    item.addEventListener('click', e => {
      const btn = e.target.closest('[data-a]');
      if (!btn) return;
      const field = btn.dataset.f;
      const action = btn.dataset.a;
      const pl = ST.placements[field];
      if (!pl) return;
      e.stopPropagation();

      if (action === 'sz-') pl.size = Math.max(6, pl.size - 1);
      if (action === 'sz+') pl.size = Math.min(72, pl.size + 1);
      if (action === 'bold') pl.bold = !pl.bold;
      if (action === 'del') { removeMarker(field); return; }

      refreshMarkerVisual(field);
      syncFieldItem(field);
      // Update floating toolbar if this field is selected
      if (_selectedField === field && _toolbarEl) {
        _toolbarEl.querySelector('.mtb-sz').textContent = pl.size;
        _toolbarEl.querySelector('.mtb-b').classList.toggle('on', !!pl.bold);
      }
    });

    // Color in left panel
    const colorInput = item.querySelector('.fi-color');
    colorInput.addEventListener('input', e => {
      e.stopPropagation();
      const pl = ST.placements[f];
      if (!pl) return;
      pl.color = e.target.value;
      refreshMarkerVisual(f);
      if (_selectedField === f && _toolbarEl) {
        _toolbarEl.querySelector('.mtb-color').value = e.target.value;
      }
    });

    // Drag from left panel → DnD to canvas
    item.addEventListener('dragstart', e => {
      setArmedField(null);
      e.dataTransfer.setData('f', f);
      e.dataTransfer.setData('src', 'chip');
    });

    list.appendChild(item);
  });
}

function syncFieldItem(f) {
  const item  = $(`fi-${f}`);
  const badge = $(`fib-${f}`);
  const settings = $(`fis-${f}`);
  const szEl  = $(`fisz-${f}`);
  const fib2  = $(`fib2-${f}`);
  const fic   = $(`fic-${f}`);
  if (!item) return;

  const pl = ST.placements[f];
  if (pl) {
    item.classList.add('placed');
    badge.textContent = '✓ Розміщено';
    if (szEl)  szEl.textContent = pl.size;
    if (fib2)  fib2.classList.toggle('on', !!pl.bold);
    if (fic)   fic.value = pl.color || '#111111';
  } else {
    item.classList.remove('placed');
    badge.textContent = 'Не розміщено';
  }
}

// ── Arm field (click-to-place mode) ──────────────────
function armField(f) {
  if (_armedField === f) {
    setArmedField(null);
  } else {
    setArmedField(f);
  }
}

function setArmedField(f) {
  _armedField = f;
  // Update field item armed states
  document.querySelectorAll('.fi').forEach(el =>
    el.classList.toggle('armed', el.dataset.f === f)
  );
  const host   = $('canvas-host');
  const hint   = $('arm-hint');
  const hintTx = $('arm-hint-text');

  if (f) {
    hint.style.display = 'flex';
    hintTx.textContent = `Клікніть на шаблоні щоб розмістити ${FIELD_META[f].label}`;
    if (host) host.classList.add('armed-mode');
    hideToolbar();
  } else {
    hint.style.display = 'none';
    if (host) host.classList.remove('armed-mode');
  }
}

function updatePlacedInfo() {
  const keys = Object.keys(ST.placements);
  const el = $('placed-info');
  if (!el) return;
  el.textContent = keys.length
    ? `✓ Розміщено: ${keys.map(f => FIELD_META[f].label).join(', ')}`
    : 'Нічого не розміщено';
}

// ── Open modal ────────────────────────────────────────
async function openEditor(bytes, isBulk) {
  ST.editorIsBulk = isBulk;

  // Render PDF page to canvas
  const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const pg       = await pdfjsDoc.getPage(1);
  const vp0      = pg.getViewport({ scale:1 });
  ST.pdfW = vp0.width; ST.pdfH = vp0.height;

  const maxW  = Math.min(window.innerWidth * 0.60, 740);
  const scale = maxW / vp0.width;
  const vp    = pg.getViewport({ scale });

  const cvs = $('editor-canvas');
  cvs.width  = Math.floor(vp.width);
  cvs.height = Math.floor(vp.height);
  ST.canvasW = cvs.width;
  ST.canvasH = cvs.height;
  await pg.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;

  // Reset editor state
  hideToolbar();
  setArmedField(null);
  Object.keys(_markerEls).forEach(f => { _markerEls[f]?.remove(); delete _markerEls[f]; });

  // Build/rebuild field items
  buildFieldItems();

  // Re-add existing markers (edit mode — keep placements)
  Object.entries(ST.placements).forEach(([f, pos]) => addMarker(f, pos.x, pos.y));

  $('modal').style.display = 'flex';

  bindDnD();
}

// ── Drag & Drop ───────────────────────────────────────
function bindDnD() {
  // Refresh chip dragstart listeners via item re-bind (buildFieldItems already did this)

  // Replace canvas host to clear old listeners
  const host = $('canvas-host');
  const newHost = host.cloneNode(false);
  while (host.firstChild) newHost.appendChild(host.firstChild);
  host.parentNode.replaceChild(newHost, host);
  newHost.id = 'canvas-host';

  // Re-append toolbar if needed
  if (_toolbarEl && !newHost.contains(_toolbarEl)) newHost.appendChild(_toolbarEl);

  newHost.addEventListener('dragover', e => e.preventDefault());

  newHost.addEventListener('drop', e => {
    e.preventDefault();
    const f   = e.dataTransfer.getData('f');
    const src = e.dataTransfer.getData('src');
    if (!f) return;
    const r = newHost.getBoundingClientRect();
    let x = e.clientX - r.left;
    let y = e.clientY - r.top;
    if (src === 'marker') {
      x -= parseFloat(e.dataTransfer.getData('ox') || 0);
      y -= parseFloat(e.dataTransfer.getData('oy') || 0);
    }
    addMarker(f, x, y);
    // After drop, select the moved/placed field
    setTimeout(() => showToolbar(f), 80);
  });

  // Click on canvas → place armed field, or deselect
  newHost.addEventListener('mousedown', e => {
    const clickedMarker = e.target.closest('.marker');
    const clickedToolbar = e.target.closest('.mtb');
    if (!clickedMarker && !clickedToolbar) {
      if (_armedField) {
        // Place the armed field
        const r = newHost.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const armed = _armedField;
        setArmedField(null);
        addMarker(armed, x, y);
        setTimeout(() => showToolbar(armed), 60);
      } else {
        hideToolbar();
      }
    }
  });
}

// ── Modal buttons ─────────────────────────────────────
$('modal-x').addEventListener('click', () => {
  $('modal').style.display = 'none';
  setArmedField(null);
});

$('modal-reset').addEventListener('click', () => {
  Object.keys(ST.placements).forEach(f => removeMarker(f));
  hideToolbar();
  updatePlacedInfo();
});

$('modal-ok').addEventListener('click', () => {
  $('modal').style.display = 'none';
  setArmedField(null);
  const n = Object.keys(ST.placements).length;
  if (!n) { toast('⚠️ Жодного поля не розміщено', 'err'); return; }
  toast(`✅ ${n} ${n === 1 ? 'поле збережено' : 'полів збережено'}`, 'ok');
  if (!ST.editorIsBulk) renderPreview();
});

$('arm-cancel').addEventListener('click', () => setArmedField(null));

// ── Excel parser ──────────────────────────────────────
function parseExcel(buf) {
  try {
    const wb   = XLSX.read(buf, { type:'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
    if (!rows.length) { toast('❌ Таблиця порожня','err'); return; }

    const get = (row, ...keys) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk=>rk.toLowerCase().trim()===k);
        if (found && String(row[found]).trim()) return String(row[found]).trim();
      }
      return '';
    };
    ST.excelRows = rows.map(r=>({
      name:   get(r,'name','піб','pib','студент','student'),
      period: get(r,'period','період','term'),
      grade:  get(r,'grade','грейд','рівень','level'),
    })).filter(r=>r.name);

    if (!ST.excelRows.length) { toast('❌ Не знайдено колонку name/ПІБ','err'); return; }

    $('st-count').textContent = `${ST.excelRows.length} студентів`;
    $('stl').innerHTML = ST.excelRows.slice(0,8).map((s,i)=>
      `<div class="sr"><span class="si">${i+1}</span><span style="flex:1">${s.name}</span><span class="sg">${s.grade||'—'}</span></div>`
    ).join('') + (ST.excelRows.length>8 ? `<div style="padding:4px 8px;font-size:11px;color:#9ca3af">…ще ${ST.excelRows.length-8}</div>` : '');
    $('stbox').style.display = 'block';
    $('btn-bulk').disabled   = false;
    toast(`✅ ${ST.excelRows.length} студентів завантажено`, 'ok');
  } catch(e) { toast('❌ Excel: '+e.message,'err'); }
}

// ── Validation ────────────────────────────────────────
function validate(name, period, grade) {
  let ok=true;
  [['f-name',name],['f-period',period],['f-grade',grade]].forEach(([id,v])=>{
    $(id).classList.toggle('err',!v); if(!v) ok=false;
  });
  if (!ok) toast('⚠️ Заповніть всі поля','err');
  return ok;
}

// ── Downloads ─────────────────────────────────────────
function dlPdf(bytes, name) { dlBlob(new Blob([bytes],{type:'application/pdf'}), name); }
function dlBlob(blob, name) {
  const url=URL.createObjectURL(blob);
  const a=Object.assign(document.createElement('a'),{href:url,download:name});
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},3000);
}

// ── Progress ──────────────────────────────────────────
function showProg(msg,pct){ $('prog-overlay').style.display='flex'; setMsg(msg); setP(pct); }
function setP(p){ $('prog-bar').style.width=p+'%'; }
function setMsg(m){ $('prog-msg').textContent=m; }
function hideProg(){ setTimeout(()=>$('prog-overlay').style.display='none',500); }
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ── Toast ─────────────────────────────────────────────
let _tid;
function toast(msg,type=''){
  const el=$('toast'); el.textContent=msg; el.className=`toast show ${type}`;
  clearTimeout(_tid); _tid=setTimeout(()=>el.classList.remove('show'),3500);
}

// ── Init ──────────────────────────────────────────────
window.addEventListener('load', renderPreview);
