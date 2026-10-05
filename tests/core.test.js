const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const PDFLib = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
const C = require('../cert-core.js');

const font = f => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fonts', f)));
const fontBytes = { regular: font('DejaVuSans.ttf'), bold: font('DejaVuSans-Bold.ttf') };
const data = { name: 'Олена Петренко', period: 'Вересень–Грудень 2024', grade: 'B2', date: '05.10.2026', num: '1001' };

async function template({ size = [842, 595], rotate = 0, cropBox = null } = {}) {
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage(size);
  if (rotate) page.setRotation(PDFLib.degrees(rotate));
  if (cropBox) page.setCropBox(...cropBox);
  return doc.save();
}

/** Text items with positions in *displayed* page space, normalised 0..1 (top-left origin). */
async function textItems(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();
  const out = items.filter(i => i.str.trim()).map(i => {
    const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5]);
    return { str: i.str, x: x / vp.width, y: y / vp.height };
  });
  await doc.destroy();
  return out;
}

test('default design embeds subset fonts — small file, Cyrillic text present', async () => {
  const bytes = await C.buildCert({ PDFLib, fontkit, fontBytes, data });
  assert.ok(bytes.length < 60_000, `PDF too large: ${bytes.length} bytes`);
  const strs = (await textItems(bytes)).map(i => i.str).join(' ');
  assert.match(strs, /Олена Петренко/);
  assert.match(strs, /№ 1001/);
});

test('fallback without fontkit transliterates and never throws on "№"', async () => {
  const bytes = await C.buildCert({ PDFLib, fontkit: null, fontBytes: null, data });
  const strs = (await textItems(bytes)).map(i => i.str).join(' ');
  assert.match(strs, /Olena Petrenko/);
  assert.match(strs, /No 1001/);
});

test('template without placements: generation refused, preview allowed', async () => {
  const tpl = await template();
  await assert.rejects(C.buildCert({ PDFLib, fontkit, fontBytes, template: tpl, placements: {}, data }), { code: 'NO_PLACEMENTS' });
  const bytes = await C.buildCert({ PDFLib, fontkit, fontBytes, template: tpl, placements: {}, data, requirePlacements: false });
  assert.equal((await textItems(bytes)).length, 0, 'template must not be painted over');
});

test('invalid template bytes give a readable error', async () => {
  await assert.rejects(
    C.buildCert({ PDFLib, template: new Uint8Array([1, 2, 3]), placements: { name: C.normalizePlacement('name', { x: .5, y: .5 }) }, data }),
    { code: 'BAD_PDF' });
});

for (const rotate of [0, 90, 180, 270]) {
  test(`placement lands where it was put in the editor (Rotate ${rotate})`, async () => {
    const tpl = await template({ rotate });
    const placements = {
      name: C.normalizePlacement('name', { x: 0.5, y: 0.4, align: 'center' }),
      num: C.normalizePlacement('num', { x: 0.1, y: 0.9, align: 'left' }),
    };
    const items = await textItems(await C.buildCert({ PDFLib, fontkit, fontBytes, template: tpl, placements, data }));
    const name = items.find(i => i.str.includes('Олена'));
    const num = items.find(i => i.str.includes('1001'));
    // pdf.js reports the baseline start; left-aligned x is exact, baseline sits slightly below the anchor
    assert.ok(Math.abs(num.x - 0.1) < 0.01, `num.x=${num.x}`);
    assert.ok(num.y > 0.9 && num.y < 0.93, `num.y=${num.y}`);
    assert.ok(name.x > 0.25 && name.x < 0.5, `name.x=${name.x}`);
    assert.ok(name.y > 0.4 && name.y < 0.45, `name.y=${name.y}`);
  });
}

test('CropBox offset is respected', async () => {
  const tpl = await template({ size: [1000, 800], cropBox: [100, 100, 842, 595] });
  const placements = { num: C.normalizePlacement('num', { x: 0.2, y: 0.5, align: 'left' }) };
  const [num] = await textItems(await C.buildCert({ PDFLib, fontkit, fontBytes, template: tpl, placements, data }));
  assert.ok(Math.abs(num.x - 0.2) < 0.01, `num.x=${num.x}`);
});

test('long names shrink to stay inside the page', async () => {
  const tpl = await template();
  const placements = { name: C.normalizePlacement('name', { x: 0.6, y: 0.5, align: 'left', size: 40 }) };
  const long = { ...data, name: 'Костянтин-Олександр Володимирович Шевченко-Квітка' };
  const bytes = await C.buildCert({ PDFLib, fontkit, fontBytes, template: tpl, placements, data: long });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true }).promise;
  const { items } = await (await doc.getPage(1)).getTextContent();
  const it = items.find(i => i.str.includes('Костянтин'));
  assert.ok(it.transform[0] < 40, `size not reduced: ${it.transform[0]}`);
  assert.ok(it.transform[4] + it.width <= 842 * 0.98, `overflows page: ${it.transform[4] + it.width}`);
  await doc.destroy();
});

test('consecutive documents keep every glyph (no shared subset state)', async () => {
  // Regression: Cyrillic "о" is a composite glyph referencing Latin "o"; sharing a parsed
  // font between documents made later certificates lose letters.
  const tpl = await template();
  const placements = { name: C.normalizePlacement('name', { x: 0.5, y: 0.5 }) };
  const names = ['Олена Петренко', 'onerror window hello', 'Ярослава Щербина', 'Bob Moore'];
  for (const name of names) {
    const bytes = await C.buildCert({ PDFLib, fontkit, fontBytes, template: tpl, placements, data: { ...data, name } });
    assert.deepEqual((await textItems(bytes)).map(i => i.str), [name]);
  }
});

test('trl follows КМУ-2010 rules', () => {
  assert.equal(C.trl('Олена Петренко'), 'Olena Petrenko');
  assert.equal(C.trl('Юрій Єрмоленко'), 'Yurii Yermolenko');
  assert.equal(C.trl('Знам\'янка Згурський'), 'Znamianka Zghurskyi');
  assert.equal(C.trl('Їжакевич Яна'), 'Yizhakevych Yana');
  assert.equal(C.trl('ЩУКА'), 'SHCHUKA');
  assert.equal(C.trl('Щука'), 'Shchuka');
});

test('safeFileName keeps Cyrillic and strips unsafe characters', () => {
  assert.equal(C.safeFileName('Олена Петренко'), 'Олена_Петренко');
  assert.equal(C.safeFileName('a/b\\c:d*?"<>|'), 'abcd');
  assert.equal(C.safeFileName('   '), 'cert');
});

test('parsePreset validates input', () => {
  assert.throws(() => C.parsePreset({ version: 1, fields: null }), { code: 'BAD_PRESET' });
  assert.throws(() => C.parsePreset({ version: 1, fields: { foo: {} } }), { code: 'EMPTY_PRESET' });
  const { placements } = C.parsePreset({
    version: 1,
    fields: { name: { xNorm: 2, yNorm: 0.5, size: 'abc', color: 'red', align: 'up' }, __proto__: { xNorm: 1, yNorm: 1 } },
  });
  assert.deepEqual(placements.name, { x: 1, y: 0.5, size: 28, bold: true, color: '#111111', align: 'center' });
  assert.equal(Object.keys(placements).length, 1);
});

test('preset round-trip', () => {
  const placements = { grade: C.normalizePlacement('grade', { x: 0.3, y: 0.7, size: 20, bold: false, color: '#FF0000', align: 'right' }) };
  const back = C.parsePreset(JSON.parse(JSON.stringify(C.buildPreset(placements, { pdfW: 842, pdfH: 595 }))));
  assert.deepEqual(back.placements, { grade: { x: 0.3, y: 0.7, size: 20, bold: false, color: '#ff0000', align: 'right' } });
});

test('mapRows understands Ukrainian headers and flags incomplete rows', () => {
  const { students, incomplete } = C.mapRows([
    { 'Прізвище та ім\'я': '  Олена   Петренко ', 'Період навчання': 'Вер–Гру 2024', 'Рівень': 'B2' },
    { 'Прізвище та ім\'я': 'Іван Іваненко', 'Період навчання': '', 'Рівень': 'B1' },
    { 'Прізвище та ім\'я': '', 'Період навчання': 'x', 'Рівень': 'x' },
  ]);
  assert.deepEqual(students[0], { name: 'Олена Петренко', period: 'Вер–Гру 2024', grade: 'B2' });
  assert.equal(students.length, 2);
  assert.equal(incomplete, 1);
  assert.equal(C.mapRows([{ foo: 1 }]).students.length, 0);
});
