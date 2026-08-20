'use strict';
/**
 * Tests for the .xlsx reader.
 *
 * The self-closing-cell case below is not hypothetical. The first version of this reader used a
 * greedy quantifier, which let an empty cell like <c r="D1" s="15"/> fall through to the
 * ">...</c>" branch and swallow the following cell - so column D silently reported column E's
 * value, unresolved from the shared-string table. Nothing threw. The roster would simply have
 * been built from shifted columns.
 *
 *   node tools/lib/xlsx.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { readWorkbook } = require('./xlsx');

let pass = 0;
const fails = [];
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// ---------------------------------------------------------------- build a tiny .xlsx in memory

function zipOf(files) {
  // Minimal store-only ZIP writer, enough for the reader to walk.
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32 ? zlib.crc32(data) : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 10); // stored
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const body = Buffer.concat(chunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, centralBuf, eocd]);
}

function fixture(sheetXml, shared) {
  const files = [
    ['xl/workbook.xml', `<workbook><sheets><sheet name="s1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`],
  ];
  if (shared) {
    files.push(['xl/sharedStrings.xml', `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`]);
  }
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsxtest-')), 'f.xlsx');
  fs.writeFileSync(p, zipOf(files));
  return p;
}

// ---------------------------------------------------------------- tests

test('a self-closing empty cell does not swallow the next cell', () => {
  // This is the regression. D is empty and self-closing; E carries shared string 1.
  const p = fixture(
    `<row r="1"><c r="C1" t="s"><v>0</v></c><c r="D1" s="15"/><c r="E1" t="s"><v>1</v></c></row>`,
    ['Name', 'Classes']
  );
  const rows = readWorkbook(p).sheet('s1');
  assert.equal(rows[0].C, 'Name', 'column C lost its value');
  assert.equal(rows[0].D, undefined, 'empty column D should be absent, not borrow from E');
  assert.equal(rows[0].E, 'Classes', 'column E value landed in the wrong column, or was left as a raw index');
});

test('shared strings resolve, inline and numeric cells do not', () => {
  const p = fixture(
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c><c r="C1" t="inlineStr"><is><t>hi</t></is></c></row>`,
    ['shared!']
  );
  const rows = readWorkbook(p).sheet('s1');
  assert.equal(rows[0].A, 'shared!');
  assert.equal(rows[0].B, '42');
  assert.equal(rows[0].C, 'hi');
});

test('a self-closing row does not swallow the next row', () => {
  const p = fixture(
    `<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"/><row r="3"><c r="A3" t="s"><v>1</v></c></row>`,
    ['first', 'third']
  );
  const rows = readWorkbook(p).sheet('s1');
  assert.equal(rows[0].A, 'first');
  assert.deepEqual(rows[1], {}, 'the empty row should be empty, not merged');
  assert.equal(rows[2].A, 'third', 'row 3 was lost to the self-closing row 2');
});

test('entities decode, and &amp; is not double-decoded', () => {
  const p = fixture(`<row r="1"><c r="A1" t="inlineStr"><is><t>a &amp;lt; b &lt; c</t></is></c></row>`);
  assert.equal(readWorkbook(p).sheet('s1')[0].A, 'a &lt; b < c');
});

test('runs inside one shared string are joined in order', () => {
  const files = [
    ['xl/workbook.xml', `<workbook><sheets><sheet name="s1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/sharedStrings.xml', `<sst><si><r><t>Dmg: </t></r><r><t>11</t></r></si></sst>`],
    ['xl/worksheets/sheet1.xml', `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`],
  ];
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsxtest-')), 'f.xlsx');
  fs.writeFileSync(p, zipOf(files));
  assert.equal(readWorkbook(p).sheet('s1')[0].A, 'Dmg: 11');
});

// ---------------------------------------------------------------- the real file, if present

const REAL = path.join(__dirname, '..', '..', 'new spell roster to be added.xlsx');
if (fs.existsSync(REAL)) {
  test('the real roster spreadsheet reads with the expected shape', () => {
    const wb = readWorkbook(REAL);
    assert.deepEqual(wb.sheetNames, ['spells', 'spell scaling']);
    const rows = wb.sheet('spells');
    const data = rows.slice(1).filter((r) => Object.keys(r).length);
    assert.equal(data.length, 1052, 'spell count changed - if the sheet was reissued, update this number deliberately');
    assert.equal(rows[0].C, 'Name');
    assert.equal(rows[0].N, 'Duration');
    assert.equal(data.filter((r) => r.C != null).length, 1052, 'every spell must have a name');
    // The columns the sheet ships empty. If these ever fill in, the roster build should use them.
    for (const col of ['I', 'J', 'K', 'L']) {
      assert.equal(data.filter((r) => r[col] != null).length, 0, `column ${col} is no longer empty - the roster build can now use it`);
    }
  });
} else {
  console.log('  skip the real roster spreadsheet (not present)');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
