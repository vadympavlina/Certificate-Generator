/* =====================================================
   Certificate Generator — cert-core.js
   Pure certificate logic (no DOM). Works in the browser
   (window.CertCore) and in Node (require) for tests.
   ===================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CertCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Fields ──────────────────────────────────────────
  const FIELDS = {
    name:   { label: 'ПІБ',    defSize: 28, defBold: true  },
    period: { label: 'Період', defSize: 11, defBold: false },
    grade:  { label: 'Грейд',  defSize: 18, defBold: true  },
    date:   { label: 'Дата',   defSize: 10, defBold: false },
    num:    { label: 'Номер',  defSize: 9,  defBold: false },
  };
  const FIELD_KEYS = Object.keys(FIELDS);
  const ALIGNS = ['left', 'center', 'right'];
  const DEFAULT_COLOR = '#111111';
  const MIN_SIZE = 6, MAX_SIZE = 96;
  // Distance from the vertical centre of a line box (line-height:1) to the
  // baseline, in em. Matches DejaVu Sans metrics so the editor marker and
  // the PDF output line up.
  const BASELINE_FROM_CENTER = 0.346;
  const DEFAULT_PAGE = [842, 595]; // A4 landscape, pt

  class CertError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  // ── Helpers ─────────────────────────────────────────
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isHexColor = s => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

  function hexToRgb01(hex) {
    const h = isHexColor(hex) ? hex.slice(1) : DEFAULT_COLOR.slice(1);
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  }

  function formatDate(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getFullYear()}`;
  }

  /** File name that keeps Cyrillic but is safe on Windows/macOS/Linux. */
  function safeFileName(s, fallback = 'cert') {
    const out = String(s || '')
      .normalize('NFC')
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._]+|[._]+$/g, '')
      .slice(0, 80);
    return out || fallback;
  }

  // ── Transliteration (КМУ №55, 2010) ─────────────────
  // Used only when the Cyrillic font cannot be embedded.
  const TR = {
    'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','ж':'zh','з':'z','и':'y',
    'і':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
    'у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
    // initial / non-initial forms
    'є':['ye','ie'],'ї':['yi','i'],'й':['y','i'],'ю':['yu','iu'],'я':['ya','ia'],
    // soft sign and apostrophes are dropped
    'ь':'','\'':'','’':'','ʼ':'',
    // common Russian letters
    'ё':'io','ы':'y','э':'e','ъ':'',
  };
  const isLetter = c => !!c && /\p{L}/u.test(c);
  const isApos = c => c === '\'' || c === '’' || c === 'ʼ';

  function trl(input) {
    const s = String(input || '');
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i], lo = ch.toLowerCase(), m = TR[lo];
      if (m === undefined) { out += ch; continue; }
      const prev = s[i - 1], next = s[i + 1];
      const initial = !isLetter(prev) && !isApos(prev);
      let t = Array.isArray(m) ? m[initial ? 0 : 1] : m;
      if (lo === 'г' && prev && prev.toLowerCase() === 'з') t = 'gh';
      if (ch !== lo && t) {
        const allCaps = (isLetter(next) && next === next.toUpperCase() && next !== next.toLowerCase())
          || (isLetter(prev) && prev === prev.toUpperCase() && prev !== prev.toLowerCase() && !isLetter(next));
        t = allCaps ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1);
      }
      out += t;
    }
    return out;
  }

  // ── Placements ──────────────────────────────────────
  // Placements are stored in normalised page coordinates (0..1, origin at
  // the top-left of the page *as displayed*), so they do not depend on
  // screen size, zoom or template resolution.
  function normalizePlacement(field, raw) {
    if (!FIELDS[field] || !raw || typeof raw !== 'object') return null;
    const x = Number(raw.x), y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const size = Number(raw.size);
    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      size: Number.isFinite(size) ? clamp(Math.round(size), MIN_SIZE, MAX_SIZE) : FIELDS[field].defSize,
      bold: typeof raw.bold === 'boolean' ? raw.bold : FIELDS[field].defBold,
      color: isHexColor(raw.color) ? raw.color.toLowerCase() : DEFAULT_COLOR,
      align: ALIGNS.includes(raw.align) ? raw.align : 'center',
    };
  }

  function clonePlacements(src) {
    const out = {};
    for (const f of FIELD_KEYS) if (src && src[f]) out[f] = { ...src[f] };
    return out;
  }

  // ── Presets ─────────────────────────────────────────
  function buildPreset(placements, { template = '', pdfW = 0, pdfH = 0 } = {}) {
    const fields = {};
    for (const f of FIELD_KEYS) {
      const p = placements[f];
      if (!p) continue;
      fields[f] = {
        xNorm: +p.x.toFixed(5), yNorm: +p.y.toFixed(5),
        size: p.size, bold: p.bold, color: p.color, align: p.align,
      };
    }
    return {
      version: 2,
      app: 'Certificate Generator',
      created: new Date().toISOString(),
      template: template || 'unknown',
      pdfSize: { w: Math.round(pdfW), h: Math.round(pdfH) },
      fields,
    };
  }

  /** Validates an imported preset. Returns { placements, pdfSize, template }. */
  function parsePreset(obj) {
    if (!obj || typeof obj !== 'object' || !obj.version || !obj.fields || typeof obj.fields !== 'object') {
      throw new CertError('BAD_PRESET', 'Невірний формат пресету');
    }
    const placements = {};
    for (const f of FIELD_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(obj.fields, f)) continue;
      const d = obj.fields[f];
      if (!d || typeof d !== 'object') continue;
      const p = normalizePlacement(f, { ...d, x: d.xNorm, y: d.yNorm });
      if (p) placements[f] = p;
    }
    if (!Object.keys(placements).length) {
      throw new CertError('EMPTY_PRESET', 'Пресет не містить жодного відомого поля');
    }
    const w = Number(obj.pdfSize?.w), h = Number(obj.pdfSize?.h);
    return {
      placements,
      pdfSize: Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null,
      template: typeof obj.template === 'string' ? obj.template.slice(0, 200) : '',
    };
  }

  // ── Spreadsheet rows ────────────────────────────────
  const normKey = k => String(k).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const COLUMN_ALIASES = {
    name:   ['name', 'fullname', 'student', 'піб', 'pib', 'студент', 'прізвищетаімя', 'прізвищеімя',
             'імятапрізвище', 'імяпрізвище', 'фіо', 'фио', 'fio', 'учень', 'слухач'],
    period: ['period', 'term', 'період', 'періоднавчання', 'термін', 'семестр', 'период'],
    grade:  ['grade', 'level', 'грейд', 'рівень', 'оцінка', 'уровень'],
  };

  /** Maps raw sheet rows (objects keyed by header) to students. */
  function mapRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const headers = new Set();
    list.forEach(r => r && Object.keys(r).forEach(k => headers.add(k)));
    const col = {};
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      col[field] = [...headers].find(h => aliases.includes(normKey(h))) || null;
    }
    if (!col.name) return { students: [], incomplete: 0, columns: col };
    const cell = (r, k) => (k && r[k] != null ? String(r[k]).replace(/\s+/g, ' ').trim() : '');
    const students = list
      .map(r => ({ name: cell(r, col.name), period: cell(r, col.period), grade: cell(r, col.grade) }))
      .filter(s => s.name);
    const incomplete = students.filter(s => !s.period || !s.grade).length;
    return { students, incomplete, columns: col };
  }

  // ── Page geometry ───────────────────────────────────
  /**
   * Describes how a pdf-lib page is displayed (CropBox + /Rotate), which is
   * exactly how pdf.js renders it in the editor.
   */
  function pageFrame(page) {
    const box = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    return { box, rot, viewW: swap ? box.height : box.width, viewH: swap ? box.width : box.height };
  }

  /**
   * Maps a normalised display point (u,v) to PDF user space. Returns the
   * point plus unit vectors pointing "right" and "down" on the displayed page.
   */
  function anchor(frame, u, v) {
    const { box: b, rot } = frame;
    switch (rot) {
      case 90:  return { x: b.x + v * b.width,       y: b.y + u * b.height,       r: [0, 1],  d: [1, 0]  };
      case 180: return { x: b.x + (1 - u) * b.width, y: b.y + v * b.height,       r: [-1, 0], d: [0, 1]  };
      case 270: return { x: b.x + (1 - v) * b.width, y: b.y + (1 - u) * b.height, r: [0, -1], d: [-1, 0] };
      default:  return { x: b.x + u * b.width,       y: b.y + (1 - v) * b.height, r: [1, 0],  d: [0, -1] };
    }
  }

  /** Width available for text at (u) with given alignment, in pt. */
  function availableWidth(u, align, viewW, margin = 0.03) {
    const lo = margin, hi = 1 - margin;
    let frac;
    if (align === 'left') frac = hi - u;
    else if (align === 'right') frac = u - lo;
    else frac = 2 * Math.min(u - lo, hi - u);
    return Math.max(frac, 0.05) * viewW;
  }

  /** Largest size ≤ pref (step 0.5, ≥ min) at which txt fits into maxW. */
  function fitSize(font, txt, pref, min, maxW) {
    const w1 = font.widthOfTextAtSize(txt, 1);
    if (!w1 || w1 * pref <= maxW) return pref;
    return Math.max(min, Math.floor((maxW / w1) * 2) / 2);
  }

  // ── PDF builder ─────────────────────────────────────
  /**
   * Builds one certificate.
   * @param {object} o
   * @param {object} o.PDFLib    pdf-lib namespace
   * @param {object} [o.fontkit] @pdf-lib/fontkit; without it Helvetica + transliteration is used
   * @param {{regular:Uint8Array,bold:Uint8Array}} [o.fontBytes]
   * @param {Uint8Array} [o.template] PDF template; without it the built-in design is used
   * @param {object} [o.placements] field -> placement (normalised)
   * @param {{name,period,grade,date,num}} o.data
   * @param {boolean} [o.requirePlacements=true] throw if a template has no placed fields
   * @returns {Promise<Uint8Array>}
   */
  async function buildCert(o) {
    const { PDFLib, fontkit, fontBytes, template, data } = o;
    const placements = o.placements || {};
    const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
    const hasPlacements = FIELD_KEYS.some(f => placements[f]);

    if (template && !hasPlacements && o.requirePlacements !== false) {
      throw new CertError('NO_PLACEMENTS', 'Розмістіть поля на шаблоні (кнопка «Розмістити поля»)');
    }

    let doc;
    if (template) {
      doc = await loadTemplate(PDFDocument, template);
    } else {
      doc = await PDFDocument.create();
      doc.addPage(DEFAULT_PAGE);
    }
    doc.setCreator('Certificate Generator');
    doc.setProducer('Certificate Generator');
    if (data.name) doc.setTitle(`Сертифікат — ${data.name}`);

    const useCustom = !!(fontkit && fontBytes && fontBytes.regular && fontBytes.bold);
    if (useCustom) doc.registerFontkit(fontkit);
    const fontCache = {};
    const getFont = async bold => {
      const k = bold ? 'b' : 'r';
      if (!fontCache[k]) {
        fontCache[k] = useCustom
          // fresh copy: fontkit's subsetter must never share state between documents
          ? doc.embedFont((bold ? fontBytes.bold : fontBytes.regular).slice(), { subset: true })
          : doc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
      }
      return fontCache[k];
    };
    // Helvetica (WinAnsi) cannot encode Cyrillic, "№", emoji, etc.
    const prep = async (txt, bold) => {
      if (useCustom) return txt;
      const font = await getFont(bold);
      const ok = new Set(font.getCharacterSet());
      return Array.from(trl(txt)).map(c => (ok.has(c.codePointAt(0)) ? c : '?')).join('');
    };
    const texts = {
      name: data.name || '',
      period: data.period || '',
      grade: data.grade || '',
      date: data.date || '',
      num: data.num ? `${useCustom ? '№' : 'No'} ${data.num}` : '',
    };

    const page = doc.getPage(0);
    if (template) {
      const frame = pageFrame(page);
      for (const f of FIELD_KEYS) {
        const p = placements[f];
        if (!p || !texts[f]) continue;
        const font = await getFont(p.bold);
        const txt = await prep(texts[f], p.bold);
        if (!txt) continue;
        const size = fitSize(font, txt, p.size, MIN_SIZE, availableWidth(p.x, p.align, frame.viewW));
        const w = font.widthOfTextAtSize(txt, size);
        const shift = p.align === 'center' ? -w / 2 : p.align === 'right' ? -w : 0;
        const base = BASELINE_FROM_CENTER * size;
        const a = anchor(frame, p.x, p.y);
        page.drawText(txt, {
          x: a.x + a.r[0] * shift + a.d[0] * base,
          y: a.y + a.r[1] * shift + a.d[1] * base,
          size, font, color: rgb(...hexToRgb01(p.color)), rotate: degrees(frame.rot),
        });
      }
    } else {
      await drawDefault({ page, rgb, getFont, prep, texts });
    }
    return doc.save();
  }

  async function loadTemplate(PDFDocument, bytes) {
    let doc;
    try {
      doc = await PDFDocument.load(bytes);
    } catch (e) {
      if (/encrypt/i.test(e && e.message)) throw new CertError('ENCRYPTED', 'PDF-шаблон захищено паролем — збережіть його без захисту');
      throw new CertError('BAD_PDF', 'Не вдалося прочитати PDF-шаблон');
    }
    if (!doc.getPageCount()) throw new CertError('BAD_PDF', 'PDF-шаблон не містить сторінок');
    return doc;
  }

  async function drawDefault({ page, rgb, getFont, prep, texts }) {
    const { width: W, height: H } = page.getSize();
    const fR = await getFont(false), fB = await getFont(true);
    const gold = rgb(.76, .63, .38);
    const text = async (txt, x, y, bold, size, color, maxW) => {
      const s = await prep(txt, bold);
      if (!s) return;
      const font = bold ? fB : fR;
      const sz = maxW ? fitSize(font, s, size, 8, maxW) : size;
      page.drawText(s, { x: x - font.widthOfTextAtSize(s, sz) / 2, y, size: sz, font, color });
    };

    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 14, y: 14, width: W - 28, height: H - 28, borderColor: gold, borderWidth: 2 });
    page.drawRectangle({ x: 22, y: 22, width: W - 44, height: H - 44, borderColor: rgb(.86, .76, .56), borderWidth: .5 });
    page.drawRectangle({ x: 14, y: H - 74, width: W - 28, height: 60, color: rgb(.08, .11, .22) });
    await text('СЕРТИФІКАТ', W / 2, H - 52, true, 13, rgb(.86, .72, .40));
    await text('про завершення навчання', W / 2, H - 66, false, 8, rgb(.62, .62, .70));
    await text('Цей сертифікат підтверджує, що', W / 2, H - 108, false, 11, rgb(.5, .5, .5));
    page.drawLine({ start: { x: W * .15, y: H - 127 }, end: { x: W * .85, y: H - 127 }, thickness: .5, color: gold });
    await text(texts.name, W / 2, H - 172, true, 28, rgb(...hexToRgb01(DEFAULT_COLOR)), W * .68);
    page.drawLine({ start: { x: W * .15, y: H - 189 }, end: { x: W * .85, y: H - 189 }, thickness: .5, color: gold });
    await text('успішно завершив(ла) курс навчання', W / 2, H - 216, false, 11, rgb(.45, .45, .45));
    await text(texts.grade, W / 2, H - 250, true, 18, rgb(.76, .50, .16), W * .65);
    page.drawLine({ start: { x: W * .28, y: H - 264 }, end: { x: W * .72, y: H - 264 }, thickness: .3, color: rgb(.84, .76, .58) });
    if (texts.period) await text('Період навчання: ' + texts.period, W / 2, H - 289, false, 11, rgb(.42, .42, .42), W * .8);
    for (const [x, y] of [[28, 28], [W - 28, 28], [28, H - 28], [W - 28, H - 28]]) {
      page.drawRectangle({ x: x - 5, y: y - 5, width: 10, height: 10, color: gold, opacity: .5 });
    }
    if (texts.num) await text(texts.num, W * .22, 34, false, 8, rgb(.55, .55, .55));
    if (texts.date) await text('Видано: ' + texts.date, W * .78, 34, false, 8, rgb(.55, .55, .55));
  }

  return {
    FIELDS, FIELD_KEYS, ALIGNS, DEFAULT_COLOR, MIN_SIZE, MAX_SIZE, BASELINE_FROM_CENTER,
    CertError, clamp, isHexColor, hexToRgb01, formatDate, safeFileName, trl,
    normalizePlacement, clonePlacements, buildPreset, parsePreset, mapRows,
    pageFrame, anchor, availableWidth, fitSize, buildCert,
  };
}));
