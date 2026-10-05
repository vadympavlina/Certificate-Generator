/* =====================================================
   Certificate Generator — script.js (UI)
   PDF logic lives in cert-core.js (window.CertCore).
   ===================================================== */
'use strict';

const C = window.CertCore;
const { FIELDS, FIELD_KEYS } = C;
const $ = id => document.getElementById(id);

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const JSZIP_URL = 'vendor/jszip.min.js';
const LIMITS = { pdf: 30 << 20, sheet: 15 << 20, preset: 1 << 20 };
const PLACEHOLDER = { name: 'Олена Петренко', period: 'Вересень–Грудень 2024', grade: 'B2' };

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

// ── Small utils ───────────────────────────────────────
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const students = n => `${n} ${plural(n, 'студент', 'студенти', 'студентів')}`;
const fields = n => `${n} ${plural(n, 'поле', 'поля', 'полів')}`;

const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : v; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } },
};

const scripts = {};
function loadScript(src) {
  return scripts[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res;
    s.onerror = () => { delete scripts[src]; rej(new Error(`Не вдалося завантажити ${src.split('/').pop()}`)); };
    document.head.appendChild(s);
  });
}

function openPdf(bytes) {
  // pdf.js transfers the buffer to its worker → always pass a copy.
  // isEvalSupported:false mitigates CVE-2024-4367 for untrusted templates.
  return pdfjsLib.getDocument({
    data: bytes.slice(0),
    isEvalSupported: false,
    enableXfa: false,
    standardFontDataUrl: 'vendor/standard_fonts/',
  }).promise;
}

// ── State ─────────────────────────────────────────────
const ST = {
  single: { tpl: null, tplName: '', placements: {}, pdfW: 0, pdfH: 0 },
  bulk:   { tpl: null, tplName: '', placements: {}, pdfW: 0, pdfH: 0 },
  rows: [],
  issueDate: todayISO(),
  preview: { single: null, bulk: null },   // { bytes, label }
  busy: false,
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function issueDateText() {
  const [y, m, d] = (ST.issueDate || todayISO()).split('-').map(Number);
  return C.formatDate(new Date(y, m - 1, d));
}

// Certificate counter: localStorage 'cn' holds the last issued number.
const counter = {
  next() { const n = parseInt(store.get('cn', '1000'), 10); return Number.isFinite(n) && n >= 0 ? n + 1 : 1001; },
  setNext(n) { store.set('cn', Math.max(0, n - 1)); },
  commit(lastIssued) { store.set('cn', lastIssued); syncIssueInputs(); },
};

// ── Fonts ─────────────────────────────────────────────
let fontsPromise = null;
function loadFonts() {
  return fontsPromise ||= (async () => {
    const fk = typeof fontkit !== 'undefined' ? fontkit : null;
    try {
      const get = async url => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      };
      const [regular, bold] = await Promise.all([get('fonts/DejaVuSans.ttf'), get('fonts/DejaVuSans-Bold.ttf')]);
      if (!fk) throw new Error('fontkit');
      registerEditorFonts(regular, bold);
      return { fontkit: fk, fontBytes: { regular, bold } };
    } catch (e) {
      console.warn('Cyrillic font unavailable:', e);
      toast('⚠️ Не вдалося завантажити шрифт — кирилиця буде транслітерована', 'err', 6000);
      return { fontkit: null, fontBytes: null };
    }
  })();
}
// Same font in the editor so markers look exactly like the PDF output.
function registerEditorFonts(regular, bold) {
  if (!('FontFace' in window)) return;
  try {
    document.fonts.add(new FontFace('CertSans', regular.slice(0).buffer, { weight: '400' }));
    document.fonts.add(new FontFace('CertSans', bold.slice(0).buffer, { weight: '700' }));
  } catch (e) { console.warn(e); }
}

async function build({ mode, data, requirePlacements = true }) {
  const fonts = await loadFonts();
  const s = ST[mode];
  return C.buildCert({ PDFLib, ...fonts, template: s.tpl, placements: s.placements, data, requirePlacements });
}

// ── Tabs ──────────────────────────────────────────────
const tabs = [...document.querySelectorAll('.tb')];
function selectTab(name, focus = false) {
  tabs.forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
    b.tabIndex = on ? 0 : -1;
    const panel = $('panel-' + b.dataset.tab);
    panel.classList.toggle('active', on);
    panel.hidden = !on;
    if (on && focus) b.focus();
  });
  store.set('tab', name);
  if (name === 'single' || ST.rows.length) refresh(name);   // re-render at the visible size
}
tabs.forEach((b, i) => {
  b.addEventListener('click', () => selectTab(b.dataset.tab));
  b.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const t = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(t.dataset.tab, true);
  });
});
const initialTab = store.get('tab', 'single') === 'bulk' ? 'bulk' : 'single';

// ── Upload helper ─────────────────────────────────────
function mkUpload({ dzId, inId, chId, nmId, rmId, exts, limit, onLoad, onClear }) {
  const dz = $(dzId), inp = $(inId), ch = $(chId), nm = $(nmId), rm = $(rmId);
  const show = chosen => { ch.hidden = !chosen; dz.hidden = chosen; };
  dz.addEventListener('click', () => inp.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handle(e.dataTransfer.files[0]); });
  inp.addEventListener('change', () => { handle(inp.files[0]); inp.value = ''; });
  rm.addEventListener('click', () => { show(false); onClear(); dz.focus(); });

  async function handle(file) {
    if (!file) return;
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!exts.includes(ext)) { toast(`❌ Непідтримуваний формат: очікується ${exts.join(', ')}`, 'err'); return; }
    if (file.size > limit) { toast(`❌ Файл завеликий (макс. ${Math.round(limit / 1048576)} МБ)`, 'err'); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await onLoad(bytes, file.name);
      nm.textContent = file.name; nm.title = file.name;
      show(true);
    } catch (e) {
      console.error(e);
      toast('❌ ' + (e.message || 'Не вдалося відкрити файл'), 'err', 6000);
    }
  }
  return { show, setName: n => { nm.textContent = n; nm.title = n; } };
}

async function checkTemplate(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (!head.includes('%PDF-')) throw new Error('Це не PDF-файл');
  // Fail early with a readable message (encrypted, damaged, no pages…)
  await C.buildCert({ PDFLib, template: bytes, placements: {}, data: {}, requirePlacements: false });
}

async function setTemplate(mode, bytes, name) {
  await checkTemplate(bytes);
  const s = ST[mode];
  const keep = s.tpl && Object.keys(s.placements).length;
  s.tpl = bytes; s.tplName = name;
  if (!keep) s.placements = {};
  toast(`Шаблон «${name}» завантажено`, 'ok');
  await openEditor(mode);
  refresh(mode);
}

const uploads = {
  single: mkUpload({
    dzId: 'dz-tpl', inId: 'in-tpl', chId: 'ch-tpl', nmId: 'ch-tpl-name', rmId: 'rm-tpl',
    exts: ['.pdf'], limit: LIMITS.pdf,
    onLoad: (b, n) => setTemplate('single', b, n),
    onClear: () => { Object.assign(ST.single, { tpl: null, tplName: '', placements: {} }); refresh('single'); },
  }),
  bulk: mkUpload({
    dzId: 'dz-bulk-tpl', inId: 'in-bulk-tpl', chId: 'ch-bulk-tpl', nmId: 'ch-bulk-tpl-name', rmId: 'rm-bulk-tpl',
    exts: ['.pdf'], limit: LIMITS.pdf,
    onLoad: (b, n) => setTemplate('bulk', b, n),
    onClear: () => { Object.assign(ST.bulk, { tpl: null, tplName: '', placements: {} }); refresh('bulk'); },
  }),
  sheet: mkUpload({
    dzId: 'dz-excel', inId: 'in-excel', chId: 'ch-excel', nmId: 'ch-excel-name', rmId: 'rm-excel',
    exts: ['.xlsx', '.xls', '.ods', '.csv'], limit: LIMITS.sheet,
    onLoad: bytes => loadSheet(bytes),
    onClear: () => { ST.rows = []; $('stbox').hidden = true; refresh('bulk'); },
  }),
};
$('btn-edit-tpl').addEventListener('click', () => openEditor('single'));
$('btn-edit-bulk-tpl').addEventListener('click', () => openEditor('bulk'));

// ── Issue parameters (date + number), shared by both tabs ──
function syncIssueInputs() {
  document.querySelectorAll('[data-issue="date"]').forEach(i => { i.value = ST.issueDate; });
  document.querySelectorAll('[data-issue="num"]').forEach(i => { if (document.activeElement !== i) i.value = counter.next(); });
}
document.querySelectorAll('[data-issue="date"]').forEach(inp => inp.addEventListener('change', () => {
  ST.issueDate = inp.value || todayISO();
  syncIssueInputs(); refresh('single'); refresh('bulk');
}));
document.querySelectorAll('[data-issue="num"]').forEach(inp => inp.addEventListener('change', () => {
  const n = parseInt(inp.value, 10);
  if (Number.isFinite(n) && n >= 1) counter.setNext(Math.min(n, 999999999));
  syncIssueInputs(); refresh('single'); refresh('bulk');
}));
syncIssueInputs();

// ── Single: inputs, preview, generation ───────────────
const singleInputs = ['f-name', 'f-period', 'f-grade'];
function singleData(withPlaceholders) {
  const v = id => $(id).value.trim();
  return {
    name: v('f-name') || (withPlaceholders ? PLACEHOLDER.name : ''),
    period: v('f-period') || (withPlaceholders ? PLACEHOLDER.period : ''),
    grade: v('f-grade') || (withPlaceholders ? PLACEHOLDER.grade : ''),
    date: issueDateText(),
    num: String(counter.next()),
  };
}
singleInputs.forEach(id => $(id).addEventListener('input', () => {
  $(id).classList.remove('err');
  refreshSingleSoon();
  if (ED.mode === 'single') updateMarkerTexts();
}));

$('btn-gen').addEventListener('click', async () => {
  const data = singleData(false);
  const missing = singleInputs.filter(id => !$(id).value.trim());
  singleInputs.forEach(id => $(id).classList.toggle('err', missing.includes(id)));
  if (missing.length) { toast('⚠️ Заповніть усі обов\'язкові поля', 'err'); $(missing[0]).focus(); return; }
  if (ST.single.tpl && !Object.keys(ST.single.placements).length) {
    toast('⚠️ Спочатку розмістіть поля на шаблоні', 'err'); openEditor('single'); return;
  }
  if (ST.busy) return;
  ST.busy = true;
  const prog = progress('Генерація PDF…');
  try {
    const bytes = await build({ mode: 'single', data });
    prog.set(90);
    download(new Blob([bytes], { type: 'application/pdf' }), `cert_${C.safeFileName(data.name)}_${data.num}.pdf`);
    counter.commit(Number(data.num));
    toast(`✅ Сертифікат №${data.num} завантажено`, 'ok');
    refresh('single');
  } catch (e) {
    console.error(e); toast('❌ ' + e.message, 'err', 6000);
  } finally { prog.done(); ST.busy = false; }
});

// ── Bulk: spreadsheet, preview, generation ────────────
async function loadSheet(bytes) {
  const prog = progress('Читання таблиці…');
  try {
    await loadScript(XLSX_URL);
    const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
    let res = null;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false, dateNF: 'dd.mm.yyyy' });
      const r = C.mapRows(rows);
      if (r.students.length) { res = r; break; }
      res ||= r;
    }
    if (!res || !res.columns.name) throw new Error('Не знайдено колонку з іменами (name / ПІБ)');
    if (!res.students.length) throw new Error('У таблиці немає жодного студента');
    ST.rows = res.students;
    renderStudents(res);
    toast(`✅ Завантажено: ${students(ST.rows.length)}`, 'ok');
    refresh('bulk');
  } finally { prog.done(); }
}

function renderStudents({ students: list, incomplete, columns }) {
  $('st-count').textContent = students(list.length);
  const warn = $('st-warn');
  const notes = [];
  if (!columns.period) notes.push('немає колонки «Період»');
  if (!columns.grade) notes.push('немає колонки «Грейд»');
  if (incomplete) notes.push(`${incomplete} ${plural(incomplete, 'рядок', 'рядки', 'рядків')} з порожніми полями`);
  warn.hidden = !notes.length;
  warn.textContent = notes.length ? '⚠️ ' + notes.join('; ') : '';
  $('st-status').textContent = notes.length ? 'перевірте' : 'готово';
  $('st-status').classList.toggle('warn', !!notes.length);

  const box = $('stl'), MAX = 300;
  box.replaceChildren(...list.slice(0, MAX).map((s, i) => {
    const row = document.createElement('div');
    row.className = 'sr' + (!s.period || !s.grade ? ' sr-warn' : '');
    const idx = document.createElement('span'); idx.className = 'si'; idx.textContent = i + 1;
    const nm = document.createElement('span'); nm.className = 'sn'; nm.textContent = s.name; nm.title = [s.name, s.period].filter(Boolean).join(' · ');
    const gr = document.createElement('span'); gr.className = 'sg'; gr.textContent = s.grade || '—';
    row.append(idx, nm, gr);
    return row;
  }));
  if (list.length > MAX) {
    const more = document.createElement('div'); more.className = 'sr-more';
    more.textContent = `…і ще ${list.length - MAX}`;
    box.append(more);
  }
  $('stbox').hidden = false;
}

let bulkCancel = false;
$('btn-bulk').addEventListener('click', async () => {
  const rows = ST.rows, total = rows.length;
  if (!total || ST.busy) return;
  if (ST.bulk.tpl && !Object.keys(ST.bulk.placements).length) {
    toast('⚠️ Спочатку розмістіть поля на шаблоні', 'err'); openEditor('bulk'); return;
  }
  const incomplete = rows.filter(r => !r.period || !r.grade).length;
  if (incomplete && !confirm(`${incomplete} з ${total} рядків мають порожній період або грейд — ці поля залишаться порожніми. Продовжити?`)) return;

  ST.busy = true; bulkCancel = false;
  const prog = progress(`Генерація 0 / ${total}…`, true);
  try {
    await Promise.all([loadScript(JSZIP_URL), loadFonts()]);
    const zip = new JSZip(), date = issueDateText(), first = counter.next();
    const used = new Set();
    let tick = performance.now();
    for (let i = 0; i < total; i++) {
      if (bulkCancel) throw new C.CertError('CANCELLED', 'Генерацію скасовано');
      const num = String(first + i), r = rows[i];
      const bytes = await build({ mode: 'bulk', data: { ...r, date, num } });
      let fname = `${num}_${C.safeFileName(r.name)}`;
      while (used.has(fname.toLowerCase())) fname += '_';
      used.add(fname.toLowerCase());
      zip.file(`${fname}.pdf`, bytes);
      if (performance.now() - tick > 50) {         // keep the UI responsive
        prog.set((i + 1) / total * 85, `Генерація ${i + 1} / ${total}…`);
        await nextFrame(); tick = performance.now();
      }
    }
    prog.set(86, 'Пакування ZIP…', false);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      m => prog.set(86 + m.percent * 0.14));
    download(blob, `certificates_${ST.issueDate}_${first}-${first + total - 1}.zip`);
    counter.commit(first + total - 1);
    toast(`✅ ${total} ${plural(total, 'сертифікат', 'сертифікати', 'сертифікатів')} у ZIP (№${first}–${first + total - 1})`, 'ok', 5000);
    refresh('bulk'); refresh('single');
  } catch (e) {
    if (e.code !== 'CANCELLED') console.error(e);
    toast((e.code === 'CANCELLED' ? '⏹ ' : '❌ ') + e.message, 'err', 6000);
  } finally { prog.done(); ST.busy = false; }
});

// ── Previews ──────────────────────────────────────────
function makePreview(boxId) {
  const box = $(boxId);
  let seq = 0, doc = null;
  return {
    async show(bytes) {
      const my = ++seq;
      const d = await openPdf(bytes);
      if (my !== seq) { d.destroy(); return; }
      const page = await d.getPage(1);
      if (my !== seq) { d.destroy(); return; }
      const cssW = Math.max((box.clientWidth || 520) - 32, 240);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = Math.min(cssW / vp0.width, 1.6);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const cvs = document.createElement('canvas');
      cvs.width = Math.floor(vp.width); cvs.height = Math.floor(vp.height);
      cvs.style.width = Math.floor(vp.width / dpr) + 'px';
      try {
        await page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
      } catch (e) { d.destroy(); if (e?.name !== 'RenderingCancelledException') throw e; return; }
      if (my !== seq) { d.destroy(); return; }
      // Swap only when fully rendered → no flicker
      box.querySelectorAll('canvas').forEach(c => c.remove());
      box.querySelector('.prev-ph').hidden = true;
      box.appendChild(cvs);
      doc?.destroy(); doc = d;
    },
    clear() {
      seq++;
      box.querySelectorAll('canvas').forEach(c => c.remove());
      box.querySelector('.prev-ph').hidden = false;
      doc?.destroy(); doc = null;
    },
  };
}
const previews = { single: makePreview('prev-box'), bulk: makePreview('bulk-prev-box') };

const refreshing = { single: 0, bulk: 0 };
async function refresh(mode) {
  const my = ++refreshing[mode];
  updateSyncRows();
  if (mode === 'bulk') $('btn-bulk').disabled = !ST.rows.length;
  const s = ST[mode], hint = $(mode === 'single' ? 'prev-hint' : 'bulk-prev-hint');
  const needsPlacement = s.tpl && !Object.keys(s.placements).length;

  let data, label;
  if (mode === 'single') {
    data = singleData(true);
    label = data.name;
    hint.textContent = needsPlacement ? '⚠️ Розмістіть поля на шаблоні' : 'Оновлюється автоматично';
  } else {
    if (!ST.rows.length) { previews.bulk.clear(); ST.preview.bulk = null; hint.textContent = 'Перший запис з таблиці'; return; }
    data = { ...ST.rows[0], date: issueDateText(), num: String(counter.next()) };
    label = `${data.name} — зразок`;
    hint.textContent = needsPlacement ? '⚠️ Розмістіть поля на шаблоні' : `Перший із ${students(ST.rows.length)}`;
  }
  hint.classList.toggle('warn', !!needsPlacement);
  try {
    const bytes = await build({ mode, data, requirePlacements: false });
    if (my !== refreshing[mode]) return;
    ST.preview[mode] = { bytes, label };
    await previews[mode].show(bytes);
  } catch (e) {
    if (my === refreshing[mode]) { console.warn('preview:', e); hint.textContent = '❌ ' + e.message; }
  }
}
const refreshSingleSoon = debounce(() => refresh('single'), 250);

['prev-box', 'bulk-prev-box'].forEach(id => {
  const mode = id === 'prev-box' ? 'single' : 'bulk';
  const open = () => { const p = ST.preview[mode]; if (p) openLightbox(p.bytes, p.label); };
  $(id).addEventListener('click', open);
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
});

// ── Sync placements Single ↔ Bulk ─────────────────────
function updateSyncRows() {
  $('sync-single-row').hidden = !(ST.single.tpl && Object.keys(ST.single.placements).length);
  $('sync-bulk-row').hidden = !(ST.bulk.tpl && Object.keys(ST.bulk.placements).length);
}
function copyLayout(from, to) {
  const src = ST[from], dst = ST[to];
  if (!Object.keys(src.placements).length) { toast('⚠️ Немає розміщених полів', 'err'); return; }
  if (!dst.tpl) {
    Object.assign(dst, { tpl: src.tpl, tplName: src.tplName, pdfW: src.pdfW, pdfH: src.pdfH });
    uploads[to].setName(`${src.tplName} (скопійовано)`);
    uploads[to].show(true);
  } else if (dst.tplName !== src.tplName && !confirm('У цільовій вкладці інший шаблон. Скопіювати розміщення полів (пропорційно)?')) {
    return;
  }
  dst.placements = C.clonePlacements(src.placements);
  toast(`✅ ${fields(Object.keys(dst.placements).length)} скопійовано`, 'ok');
  refresh(to);
}
$('btn-sync-to-bulk').addEventListener('click', () => copyLayout('single', 'bulk'));
$('btn-sync-to-single').addEventListener('click', () => copyLayout('bulk', 'single'));

// ══════════════════════════════════════════════════════
//   EDITOR
// ══════════════════════════════════════════════════════
const ED = {
  mode: null,         // 'single' | 'bulk' while open
  snapshot: null,     // placements before opening (for cancel)
  doc: null, page: null, renderTask: null,
  baseW: 0, baseH: 0, // canvas CSS size at zoom 1
  zoom: 1,
  selected: null, armed: null,
  markers: {},
  returnFocus: null,
};
const ZOOM_STEPS = [0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];
const SNAP_PX = 8;
const P = () => ST[ED.mode].placements;
const dispW = () => ED.baseW * ED.zoom;
const dispH = () => ED.baseH * ED.zoom;

async function openEditor(mode) {
  const s = ST[mode];
  if (!s.tpl || ED.mode) return;
  closeEditorDoc();
  try {
    ED.doc = await openPdf(s.tpl);
    ED.page = await ED.doc.getPage(1);
  } catch (e) {
    console.error(e); closeEditorDoc();
    toast('❌ Не вдалося відкрити шаблон у редакторі', 'err');
    return;
  }
  ED.mode = mode;
  ED.snapshot = C.clonePlacements(s.placements);
  ED.returnFocus = document.activeElement;
  const vp0 = ED.page.getViewport({ scale: 1 });
  s.pdfW = vp0.width; s.pdfH = vp0.height;

  $('modal').hidden = false;
  document.body.classList.add('no-scroll');
  const scroll = $('canvas-scroll');
  const availW = Math.max(scroll.clientWidth - 40, 320), availH = Math.max(scroll.clientHeight - 40, 240);
  const fit = Math.min(availW / vp0.width, availH / vp0.height);
  ED.baseW = vp0.width * fit; ED.baseH = vp0.height * fit;
  ED.zoom = 1;
  $('zoom-info').textContent = `${Math.round(vp0.width)}×${Math.round(vp0.height)} pt`;

  hideToolbar(); setArmed(null);
  Object.values(ED.markers).forEach(m => m.remove());
  ED.markers = {};
  buildFieldItems();
  applyZoom();
  FIELD_KEYS.forEach(f => { if (P()[f]) renderMarker(f); });
  updatePlacedInfo();
  $('field-list').querySelector('.fi-top')?.focus();
}

function closeEditorDoc() {
  ED.renderTask?.cancel(); ED.renderTask = null;
  ED.doc?.destroy(); ED.doc = null; ED.page = null;
}

function closeEditor(commit) {
  if (!ED.mode) return;
  const mode = ED.mode;
  if (!commit) ST[mode].placements = ED.snapshot;
  hideToolbar(); setArmed(null); hideGuides();
  $('modal').hidden = true;
  document.body.classList.remove('no-scroll');
  closeEditorDoc();
  ED.mode = null;
  if (commit) {
    const n = Object.keys(ST[mode].placements).length;
    toast(n ? `✅ ${fields(n)} збережено` : '⚠️ Жодного поля не розміщено', n ? 'ok' : 'err');
  }
  refresh(mode);
  ED.returnFocus?.focus?.();
}
$('modal-x').addEventListener('click', () => closeEditor(false));
$('modal-ok').addEventListener('click', () => closeEditor(true));
$('modal-reset').addEventListener('click', () => {
  FIELD_KEYS.forEach(f => removeField(f));
  hideToolbar();
});
$('arm-cancel').addEventListener('click', () => setArmed(null));

// ── Zoom ──────────────────────────────────────────────
function applyZoom() {
  const w = dispW(), h = dispH(), host = $('canvas-host');
  host.style.width = w + 'px'; host.style.height = h + 'px';
  $('zoom-val').textContent = Math.round(ED.zoom * 100) + '%';
  $('zoom-out').disabled = ED.zoom <= ZOOM_STEPS[0];
  $('zoom-in').disabled = ED.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
  FIELD_KEYS.forEach(f => ED.markers[f] && layoutMarker(f));
  if (ED.selected) positionToolbar();
  renderEditorCanvas();
}
const renderEditorCanvas = debounce(async () => {
  if (!ED.page) return;
  ED.renderTask?.cancel();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp0 = ED.page.getViewport({ scale: 1 });
  const vp = ED.page.getViewport({ scale: (dispW() / vp0.width) * dpr });
  const off = document.createElement('canvas');
  off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
  const task = ED.page.render({ canvasContext: off.getContext('2d'), viewport: vp });
  ED.renderTask = task;
  try { await task.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e); return; }
  if (ED.renderTask !== task) return;
  const cvs = $('editor-canvas');
  cvs.width = off.width; cvs.height = off.height;
  cvs.getContext('2d').drawImage(off, 0, 0);
}, 60);

function setZoom(z, anchorEvt) {
  const scroll = $('canvas-scroll');
  const old = ED.zoom;
  z = C.clamp(z, ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  if (z === old) return;
  // keep the point under the cursor (or the centre) in place
  const r = scroll.getBoundingClientRect();
  const ax = anchorEvt ? anchorEvt.clientX - r.left : r.width / 2;
  const ay = anchorEvt ? anchorEvt.clientY - r.top : r.height / 2;
  const cx = (scroll.scrollLeft + ax) / old, cy = (scroll.scrollTop + ay) / old;
  ED.zoom = z;
  applyZoom();
  scroll.scrollLeft = cx * z - ax; scroll.scrollTop = cy * z - ay;
}
const zoomStep = (dir, e) => {
  const i = ZOOM_STEPS.findIndex(s => s >= ED.zoom - 1e-6);
  setZoom(ZOOM_STEPS[C.clamp(dir > 0 ? (ZOOM_STEPS[i] > ED.zoom + 1e-6 ? i : i + 1) : i - 1, 0, ZOOM_STEPS.length - 1)], e);
};
$('zoom-in').addEventListener('click', () => zoomStep(1));
$('zoom-out').addEventListener('click', () => zoomStep(-1));
$('zoom-fit').addEventListener('click', () => setZoom(1));
$('canvas-scroll').addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  zoomStep(e.deltaY < 0 ? 1 : -1, e);
}, { passive: false });
$('canvas-scroll').addEventListener('scroll', () => { if (ED.selected) positionToolbar(); });

// ── Coordinates & snapping ────────────────────────────
function toNorm(e) {
  const r = $('canvas-host').getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, inside:
    e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
}
function snap(x, y, exclude) {
  const tx = SNAP_PX / dispW(), ty = SNAP_PX / dispH();
  const xs = [0.5, 1 / 3, 2 / 3], ys = [0.5, 1 / 3, 2 / 3];
  for (const [f, p] of Object.entries(P())) if (f !== exclude) { xs.push(p.x); ys.push(p.y); }
  const gx = xs.find(v => Math.abs(v - x) < tx), gy = ys.find(v => Math.abs(v - y) < ty);
  showGuide('v', gx); showGuide('h', gy);
  return { x: C.clamp(gx ?? x, 0, 1), y: C.clamp(gy ?? y, 0, 1) };
}
const guides = {};
function showGuide(dir, v) {
  let el = guides[dir];
  if (!el) { el = guides[dir] = document.createElement('div'); el.className = `snap-guide snap-${dir}`; }
  if (!$('canvas-host').contains(el)) $('canvas-host').appendChild(el);
  el.style.display = v === undefined ? 'none' : 'block';
  if (v !== undefined) el.style[dir === 'h' ? 'top' : 'left'] = (v * 100) + '%';
}
function hideGuides() { showGuide('h'); showGuide('v'); }

// ── Field list (left column) ──────────────────────────
function buildFieldItems() {
  const list = $('field-list');
  list.replaceChildren();
  for (const f of FIELD_KEYS) {
    const item = document.createElement('div');
    item.className = 'fi'; item.id = `fi-${f}`; item.dataset.f = f;
    item.innerHTML = `
      <div class="fi-top" role="button" tabindex="0">
        <span class="fi-lbl"></span>
        <span class="fi-badge">Не розміщено</span>
      </div>
      <div class="fi-settings">
        <div class="fi-sz-ctrl">
          <button type="button" class="fi-sz-btn" data-a="sz-" aria-label="Менший шрифт">−</button>
          <span class="fi-sz-val">12</span>
          <button type="button" class="fi-sz-btn" data-a="sz+" aria-label="Більший шрифт">+</button>
        </div>
        <input type="color" class="fi-color" value="#111111" aria-label="Колір"/>
        <button type="button" class="fi-bold-btn" data-a="bold" aria-label="Жирний">B</button>
        <div class="fi-align-ctrl">
          <button type="button" class="fi-al-btn" data-a="al-left" title="По лівому краю" aria-label="По лівому краю">⇤</button>
          <button type="button" class="fi-al-btn" data-a="al-center" title="По центру" aria-label="По центру">⊡</button>
          <button type="button" class="fi-al-btn" data-a="al-right" title="По правому краю" aria-label="По правому краю">⇥</button>
        </div>
        <button type="button" class="fi-del-btn" data-a="del" title="Видалити" aria-label="Видалити поле">✕</button>
      </div>`;
    item.querySelector('.fi-lbl').textContent = FIELDS[f].label;
    const top = item.querySelector('.fi-top');
    top.setAttribute('aria-label', `${FIELDS[f].label}: розмістити на шаблоні`);
    top.addEventListener('click', () => { if (!top._dragged) setArmed(ED.armed === f ? null : f); top._dragged = false; });
    top.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        // keyboard users: place at the centre (or select if already placed)
        if (P()[f]) showToolbar(f); else { placeField(f, 0.5, 0.5); showToolbar(f); }
      }
    });
    top.addEventListener('pointerdown', e => startChipDrag(e, f, top));
    item.querySelector('.fi-settings').addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a) applyAction(f, a);
    });
    item.querySelector('.fi-color').addEventListener('input', e => applyColor(f, e.target.value));
    list.appendChild(item);
    syncFieldItem(f);
  }
}

function syncFieldItem(f) {
  const item = $(`fi-${f}`); if (!item) return;
  const p = P()[f];
  item.classList.toggle('placed', !!p);
  item.querySelector('.fi-badge').textContent = p ? '✓ Розміщено' : 'Не розміщено';
  if (!p) return;
  item.querySelector('.fi-sz-val').textContent = p.size;
  item.querySelector('.fi-bold-btn').classList.toggle('on', p.bold);
  item.querySelector('.fi-color').value = p.color;
  item.querySelectorAll('.fi-al-btn').forEach(b => b.classList.toggle('on', b.dataset.a === 'al-' + p.align));
}

function setArmed(f) {
  ED.armed = f;
  document.querySelectorAll('.fi').forEach(el => el.classList.toggle('armed', el.dataset.f === f));
  $('arm-hint').hidden = !f;
  $('canvas-host').classList.toggle('armed-mode', !!f);
  if (f) { $('arm-hint-text').textContent = `Клікніть на шаблоні → ${FIELDS[f].label}`; hideToolbar(); }
  else hideGuides();
}

function updatePlacedInfo() {
  const keys = FIELD_KEYS.filter(f => P()[f]);
  $('placed-info').textContent = keys.length
    ? `✓ Розміщено: ${keys.map(f => FIELDS[f].label).join(', ')}`
    : 'Нічого не розміщено';
}

// ── Placement actions ─────────────────────────────────
function placeField(f, x, y) {
  const pl = P();
  pl[f] = pl[f] ? { ...pl[f], x, y } : C.normalizePlacement(f, { x, y });
  pl[f].y = clampY(f, pl[f].y);
  renderMarker(f); syncFieldItem(f); updatePlacedInfo();
}
function removeField(f) {
  ED.markers[f]?.remove(); delete ED.markers[f];
  delete P()[f];
  if (ED.selected === f) hideToolbar();
  syncFieldItem(f); updatePlacedInfo();
}
function applyAction(f, a) {
  const p = P()[f]; if (!p) return;
  if (a === 'del') { removeField(f); return; }
  if (a === 'sz-') p.size = Math.max(C.MIN_SIZE, p.size - 1);
  if (a === 'sz+') p.size = Math.min(C.MAX_SIZE, p.size + 1);
  if (a === 'bold') p.bold = !p.bold;
  if (a.startsWith('al-')) p.align = a.slice(3);
  layoutMarker(f); syncFieldItem(f);
  if (ED.selected === f) syncToolbar();
}
function applyColor(f, color) {
  const p = P()[f]; if (!p || !C.isHexColor(color)) return;
  p.color = color.toLowerCase();
  layoutMarker(f); syncFieldItem(f);
  if (ED.selected === f) syncToolbar();
}
// Keep the whole line of text inside the page vertically.
function clampY(f, y) {
  const p = P()[f], h = ST[ED.mode].pdfH;
  const half = p && h ? (p.size / 2) / h : 0;
  return C.clamp(y, half, 1 - half);
}
function moveField(f, x, y) {
  const p = P()[f]; if (!p) return;
  p.x = C.clamp(x, 0, 1); p.y = clampY(f, y);
  layoutMarker(f);
  if (ED.selected === f) { positionToolbar(); syncToolbar(); }
}

// ── Markers (WYSIWYG: real font, real size, real colour) ──
function previewText(f) {
  const d = ED.mode === 'bulk' && ST.rows.length
    ? { ...ST.rows[0], date: issueDateText(), num: String(counter.next()) }
    : singleData(true);
  if (f === 'num') return `№ ${d.num}`;
  return d[f] || FIELDS[f].label;
}
function updateMarkerTexts() {
  FIELD_KEYS.forEach(f => { const m = ED.markers[f]; if (m) m.querySelector('.mk-text').textContent = previewText(f); });
}
function renderMarker(f) {
  ED.markers[f]?.remove();
  const el = document.createElement('div');
  el.className = `marker m-${f}`;
  el.dataset.f = f;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${FIELDS[f].label} — налаштувати`);
  el.innerHTML = '<span class="mk-tag"></span><span class="mk-text"></span>';
  el.querySelector('.mk-text').textContent = previewText(f);
  el.addEventListener('pointerdown', e => startMarkerDrag(e, f));
  el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); showToolbar(f); } });
  el.addEventListener('focus', () => { if (ED.selected && ED.selected !== f) showToolbar(f); });
  $('canvas-host').appendChild(el);
  ED.markers[f] = el;
  layoutMarker(f);
}
function layoutMarker(f) {
  const el = ED.markers[f], p = P()[f];
  if (!el || !p) return;
  const pxPerPt = dispW() / ST[ED.mode].pdfW;
  el.style.left = (p.x * 100) + '%';
  el.style.top = (p.y * 100) + '%';
  el.style.transform = `translate(${p.align === 'left' ? 0 : p.align === 'right' ? -100 : -50}%, -50%)`;
  const t = el.querySelector('.mk-text');
  t.style.fontSize = (p.size * pxPerPt) + 'px';
  t.style.fontWeight = p.bold ? '700' : '400';
  t.style.color = p.color;
  el.querySelector('.mk-tag').textContent = `${FIELDS[f].label} · ${p.size}pt`;
  el.classList.toggle('al-left', p.align === 'left');
  el.classList.toggle('al-right', p.align === 'right');
}

// ── Pointer drag (mouse, pen & touch) ─────────────────
function startMarkerDrag(e, f) {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const el = ED.markers[f], p = P()[f];
  const start = toNorm(e), ox = start.x - p.x, oy = start.y - p.y;
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  el.setPointerCapture(e.pointerId);
  el.focus({ preventScroll: true });
  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
    if (!moved) { moved = true; hideToolbar(); el.classList.add('dragging'); }
    const n = toNorm(ev);
    const s = snap(n.x - ox, n.y - oy, f);
    moveField(f, s.x, s.y);
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.classList.remove('dragging');
    hideGuides();
    if (moved || ED.selected !== f) showToolbar(f); else hideToolbar();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function startChipDrag(e, f, chip) {
  if (e.button !== 0) return;
  const sx = e.clientX, sy = e.clientY;
  let dragging = false;
  const move = ev => {
    if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    if (!dragging) { dragging = true; chip._dragged = true; setArmed(null); hideToolbar(); }
    const n = toNorm(ev);
    if (n.inside) {
      const s = snap(n.x, n.y, f);
      if (!P()[f]) placeField(f, s.x, s.y); else moveField(f, s.x, s.y);
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    hideGuides();
    if (dragging && P()[f]) showToolbar(f);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

const host = $('canvas-host');
host.addEventListener('pointermove', e => {
  if (!ED.armed) return;
  const n = toNorm(e); snap(n.x, n.y, ED.armed);
});
host.addEventListener('pointerleave', () => { if (ED.armed) hideGuides(); });
host.addEventListener('pointerdown', e => {
  if (e.target.closest('.marker')) return;
  if (ED.armed) {
    const n = toNorm(e), f = ED.armed;
    const s = snap(n.x, n.y, f);
    setArmed(null); hideGuides();
    placeField(f, s.x, s.y);
    showToolbar(f);
  } else hideToolbar();
});

// ── Floating toolbar ──────────────────────────────────
const TB = $('mtb');
function showToolbar(f) {
  if (!P()[f]) return;
  ED.selected = f;
  TB.hidden = false;
  Object.entries(ED.markers).forEach(([k, m]) => m.classList.toggle('selected', k === f));
  syncToolbar(); positionToolbar();
}
function hideToolbar() {
  ED.selected = null;
  TB.hidden = true;
  Object.values(ED.markers).forEach(m => m.classList.remove('selected'));
}
function syncToolbar() {
  const f = ED.selected, p = f && P()[f];
  if (!p) return;
  const s = ST[ED.mode];
  TB.querySelector('.mtb-lbl').textContent = FIELDS[f].label;
  TB.querySelector('.mtb-sz').textContent = p.size;
  TB.querySelector('.mtb-color').value = p.color;
  TB.querySelector('.mtb-b').classList.toggle('on', p.bold);
  TB.querySelectorAll('.mtb-al').forEach(b => b.classList.toggle('on', b.dataset.a === 'al-' + p.align));
  const xi = $('mtb-xi'), yi = $('mtb-yi');
  xi.max = Math.round(s.pdfW); yi.max = Math.round(s.pdfH);
  if (document.activeElement !== xi) xi.value = Math.round(p.x * s.pdfW);
  if (document.activeElement !== yi) yi.value = Math.round(p.y * s.pdfH);
}
function positionToolbar() {
  const el = ED.markers[ED.selected];
  if (!el || TB.hidden) return;
  const r = el.getBoundingClientRect();
  const h = TB.offsetHeight || 44, w = TB.offsetWidth || 400;
  const tag = 22;   // keep the marker's label visible above it
  const below = r.top - h - tag - 14 < 8;
  TB.classList.toggle('below', below);
  TB.style.top = (below ? r.bottom + 12 : r.top - h - tag - 12) + 'px';
  TB.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
}
TB.addEventListener('pointerdown', e => e.stopPropagation());
TB.addEventListener('click', e => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a && ED.selected) applyAction(ED.selected, a);
});
TB.querySelector('.mtb-color').addEventListener('input', e => ED.selected && applyColor(ED.selected, e.target.value));
[['mtb-xi', 'x', 'pdfW'], ['mtb-yi', 'y', 'pdfH']].forEach(([id, axis, dim]) => {
  const inp = $(id);
  inp.addEventListener('change', () => {
    const f = ED.selected, p = f && P()[f], v = parseFloat(inp.value);
    if (!p || !Number.isFinite(v)) return;
    const s = ST[ED.mode];
    moveField(f, axis === 'x' ? v / s[dim] : p.x, axis === 'y' ? v / s[dim] : p.y);
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
});
window.addEventListener('resize', debounce(() => { if (ED.selected) positionToolbar(); }, 100));

// ── Presets ───────────────────────────────────────────
$('btn-export-preset').addEventListener('click', () => {
  const s = ST[ED.mode];
  if (!Object.keys(s.placements).length) { toast('⚠️ Спочатку розмістіть хоча б одне поле', 'err'); return; }
  const preset = C.buildPreset(s.placements, { template: s.tplName, pdfW: s.pdfW, pdfH: s.pdfH });
  const base = C.safeFileName((s.tplName || 'preset').replace(/\.[^.]+$/, ''), 'preset');
  download(new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }), `preset_${base}_${todayISO()}.json`);
  toast(`✅ Пресет збережено: ${fields(Object.keys(s.placements).length)}`, 'ok');
});
$('btn-import-preset').addEventListener('click', () => $('in-preset').click());
$('in-preset').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !ED.mode) return;
  try {
    if (file.size > LIMITS.preset) throw new Error('Файл пресету завеликий');
    let obj;
    try { obj = JSON.parse(await file.text()); } catch { throw new Error('Невірний JSON-файл'); }
    const { placements, pdfSize, template } = C.parsePreset(obj);
    const s = ST[ED.mode];
    if (pdfSize && (Math.abs(pdfSize.w / pdfSize.h - s.pdfW / s.pdfH) > 0.03)) {
      if (!confirm(`Пропорції шаблону в пресеті (${pdfSize.w}×${pdfSize.h} pt) відрізняються від поточного `
        + `(${Math.round(s.pdfW)}×${Math.round(s.pdfH)} pt). Координати буде масштабовано. Продовжити?`)) return;
    }
    FIELD_KEYS.forEach(f => removeField(f));
    for (const f of FIELD_KEYS) {
      if (!placements[f]) continue;
      P()[f] = placements[f];
      renderMarker(f); syncFieldItem(f);
      const item = $(`fi-${f}`);
      item.classList.add('preset-loaded');
      setTimeout(() => item.classList.remove('preset-loaded'), 900);
    }
    updatePlacedInfo();
    const n = Object.keys(placements).length;
    toast(`✅ Завантажено ${fields(n)}${template && template !== 'unknown' ? ` (з «${template}»)` : ''}`, 'ok');
  } catch (err) { toast('❌ ' + err.message, 'err'); }
});

// ══════════════════════════════════════════════════════
//   LIGHTBOX
// ══════════════════════════════════════════════════════
const LB = { doc: null, page: null, fit: 1, zoom: 1, task: null, steps: [0.5, 0.75, 1, 1.5, 2, 3, 4], returnFocus: null };

async function openLightbox(bytes, label) {
  LB.returnFocus = document.activeElement;
  $('lightbox').hidden = false;
  document.body.classList.add('no-scroll');
  $('lb-title').textContent = label || 'Перегляд сертифіката';
  $('lb-spinner').hidden = false;
  $('lb-canvas').style.visibility = 'hidden';
  $('lb-close').focus();
  try {
    const doc = await openPdf(bytes);
    if ($('lightbox').hidden) { doc.destroy(); return; }
    LB.doc = doc; LB.page = await doc.getPage(1);
    const vp0 = LB.page.getViewport({ scale: 1 });
    const body = $('lb-body');
    LB.fit = Math.min((body.clientWidth - 64) / vp0.width, (body.clientHeight - 64) / vp0.height);
    LB.zoom = 1;
    await lbRender();
  } catch (e) {
    console.error('lightbox:', e); toast('❌ Не вдалося показати перегляд', 'err'); closeLightbox();
  }
}
async function lbRender() {
  if (!LB.page) return;
  LB.task?.cancel();
  updateLbZoomUI();
  const dpr = Math.min(window.devicePixelRatio || 1, 2), scale = LB.fit * LB.zoom;
  const vp = LB.page.getViewport({ scale: scale * dpr });
  const off = document.createElement('canvas');
  off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
  const task = LB.page.render({ canvasContext: off.getContext('2d'), viewport: vp });
  LB.task = task;
  $('lb-spinner').hidden = false;
  try { await task.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e); return; }
  if (LB.task !== task) return;
  const cvs = $('lb-canvas');
  cvs.width = off.width; cvs.height = off.height;
  cvs.style.width = (off.width / dpr) + 'px';
  cvs.getContext('2d').drawImage(off, 0, 0);
  cvs.style.visibility = 'visible';
  $('lb-spinner').hidden = true;
}
const lbRenderSoon = debounce(lbRender, 80);
function updateLbZoomUI() {
  $('lb-zoom-val').textContent = Math.round(LB.zoom * 100) + '%';
  $('lb-zoom-out').disabled = LB.zoom <= LB.steps[0];
  $('lb-zoom-in').disabled = LB.zoom >= LB.steps[LB.steps.length - 1];
}
function lbZoom(dir) {
  const i = LB.steps.indexOf(LB.zoom);
  const n = dir === 0 ? 1 : LB.steps[C.clamp((i < 0 ? 2 : i) + dir, 0, LB.steps.length - 1)];
  if (n === LB.zoom) return;
  LB.zoom = n; updateLbZoomUI(); lbRenderSoon();
}
function closeLightbox() {
  LB.task?.cancel(); LB.task = null;
  LB.doc?.destroy(); LB.doc = null; LB.page = null;
  $('lightbox').hidden = true;
  if (!ED.mode) document.body.classList.remove('no-scroll');
  LB.returnFocus?.focus?.();
}
$('lb-close').addEventListener('click', closeLightbox);
$('lb-zoom-in').addEventListener('click', () => lbZoom(1));
$('lb-zoom-out').addEventListener('click', () => lbZoom(-1));
$('lb-zoom-fit').addEventListener('click', () => lbZoom(0));
$('lb-body').addEventListener('click', e => { if (e.target === $('lb-body') || e.target === $('lb-wrap')) closeLightbox(); });
$('lb-body').addEventListener('wheel', e => {
  // Ctrl/⌘ + wheel always zooms; plain wheel zooms only while the page fits (otherwise it scrolls)
  const b = $('lb-body'), overflow = b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1;
  if (!e.ctrlKey && !e.metaKey && overflow) return;
  e.preventDefault(); lbZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ══════════════════════════════════════════════════════
//   KEYBOARD
// ══════════════════════════════════════════════════════
function trapFocus(e, container) {
  const els = [...container.querySelectorAll('button:not([disabled]),input:not([type=hidden]),[tabindex="0"]')]
    .filter(el => el.offsetParent !== null);
  if (!els.length) return;
  const first = els[0], last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

document.addEventListener('keydown', e => {
  // Lightbox
  if (!$('lightbox').hidden) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); lbZoom(1); }
    else if (e.key === '-') { e.preventDefault(); lbZoom(-1); }
    else if (e.key === '0') { e.preventDefault(); lbZoom(0); }
    else if (e.key === 'Tab') trapFocus(e, $('lightbox'));
    return;
  }
  if (!ED.mode) return;
  // Editor
  if (e.key === 'Tab') { trapFocus(e, $('modal')); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomStep(1); return; }
  if (mod && e.key === '-') { e.preventDefault(); zoomStep(-1); return; }
  if (mod && e.key === '0') { e.preventDefault(); setZoom(1); return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (ED.armed) setArmed(null);
    else if (ED.selected) { const f = ED.selected; hideToolbar(); ED.markers[f]?.focus(); }
    else closeEditor(false);
    return;
  }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (typing || !ED.selected) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeField(ED.selected); return; }
  const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (dirs[e.key]) {
    e.preventDefault();
    const s = ST[ED.mode], p = P()[ED.selected], step = e.shiftKey ? 10 : 1, [dx, dy] = dirs[e.key];
    moveField(ED.selected, p.x + dx * step / s.pdfW, p.y + dy * step / s.pdfH);
  }
});

// ══════════════════════════════════════════════════════
//   UI helpers: download, progress, toast
// ══════════════════════════════════════════════════════
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

let progToken = 0;
function progress(msg, cancellable = false) {
  const my = ++progToken, t0 = performance.now();
  // don't flash the overlay for quick operations
  const timer = setTimeout(() => { if (my === progToken) $('prog-overlay').hidden = false; }, 150);
  $('prog-msg').textContent = msg;
  $('prog-bar').style.width = '0%';
  $('prog-box').setAttribute('aria-valuenow', 0);
  $('prog-cancel').hidden = !cancellable;
  return {
    set(pct, m, canCancel) {
      if (my !== progToken) return;
      $('prog-bar').style.width = pct + '%';
      $('prog-box').setAttribute('aria-valuenow', Math.round(pct));
      if (m) $('prog-msg').textContent = m;
      if (canCancel === false) $('prog-cancel').hidden = true;
    },
    done() {
      clearTimeout(timer);
      if (my !== progToken) return;
      const wait = Math.max(0, 300 - (performance.now() - t0));
      setTimeout(() => { if (my === progToken) $('prog-overlay').hidden = true; }, $('prog-overlay').hidden ? 0 : wait);
    },
  };
}
$('prog-cancel').addEventListener('click', () => { bulkCancel = true; $('prog-msg').textContent = 'Скасування…'; });

let toastTimer;
function toast(msg, type = '', ms = 3500) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

window.addEventListener('beforeunload', e => { if (ST.busy) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', debounce(() => { refresh('single'); if (ST.rows.length) refresh('bulk'); }, 300));

// ── Start ─────────────────────────────────────────────
loadFonts();
selectTab(initialTab);
if (initialTab !== 'single') refresh('single');
