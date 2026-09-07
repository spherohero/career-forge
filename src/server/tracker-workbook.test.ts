// @vitest-environment node
import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { appendApplication, blankWorkbook, inspectWorkbook } from "./tracker-workbook";

export function syntheticWorkbook() {
  const entries = unzipSync(blankWorkbook());
  entries['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(entries['xl/worksheets/sheet1.xml']).replace('</sheetData>', '<row r="3" ht="24" customHeight="1"><c r="B3" s="0" t="inlineStr"><is><t>Existing example</t></is></c><c r="F3"><f>1+2</f><v>3</v></c></row><row r="900"><c r="B900" s="0"/></row></sheetData>'));
  return zipSync(entries);
}

describe('tracker workbook', () => {
  it.each(['stored-size', 'deflated-size', 'alias', 'overlap', 'total'])('rejects forged ZIP metadata or expansion: %s', kind => {
    const files = unzipSync(blankWorkbook());
    files['padding0.bin'] = new Uint8Array(kind === 'total' ? 8 * 1024 * 1024 : 1024 * 1024);
    if (kind === 'total') for (let i = 1; i < 3; i++) files[`padding${i}.bin`] = files['padding0.bin'];
    const zip = Buffer.from(zipSync(files, { level: kind === 'stored-size' || kind === 'alias' || kind === 'overlap' ? 0 : 6 }));
    const end = zip.length - 22, cd = zip.readUInt32LE(end + 16);
    let offset = cd;
    const records: Buffer[] = [];
    while (offset < end) {
      const length = 46 + zip.readUInt16LE(offset + 28) + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
      records.push(Buffer.from(zip.subarray(offset, offset + length))); offset += length;
    }
    const padding = records.at(-1)!;
    if (kind.endsWith('size')) {
      padding.writeUInt32LE(1, 24);
      // Both copies lie: bounded inflation must also verify actual output.
      if (kind === 'deflated-size') zip.writeUInt32LE(1, padding.readUInt32LE(42) + 22);
    }
    if (kind === 'alias') {
      const clone = Buffer.from(padding); clone.write('padding1.bin', 46); records.push(clone);
    }
    if (kind === 'overlap') padding.writeUInt32LE(0, 42);
    const directory = Buffer.concat(records), eocd = Buffer.from(zip.subarray(end));
    eocd.writeUInt16LE(records.length, 8); eocd.writeUInt16LE(records.length, 10); eocd.writeUInt32LE(directory.length, 12);
    expect(() => inspectWorkbook(Buffer.concat([zip.subarray(0, cd), directory, eocd]))).toThrow();
  });
  it.each(["'", '"'])('preserves valid XML attributes using %s quotes and spacing', quote => {
    const entries = unzipSync(blankWorkbook());
    const row = `<row r = ${quote}3${quote} ht = ${quote}30${quote} customHeight=${quote}1${quote}><c r = ${quote}A3${quote} s=${quote}0${quote}/><c r = ${quote}B3${quote} s = ${quote}0${quote}/><c r=${quote}L3${quote} s=${quote}0${quote}/></row>`;
    entries['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(entries['xl/worksheets/sheet1.xml']).replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', `xmlns = ${quote}http://schemas.openxmlformats.org/spreadsheetml/2006/main${quote}`).replace('</sheetData>', `${row}</sheetData>`));
    const input = zipSync(entries);
    expect(inspectWorkbook(input).nextRow).toBe(3);
    const result = inspectWorkbook(appendApplication(input, Array(10).fill('New')));
    expect(result.sheet).toContain(row.slice(0, row.indexOf('>') + 1));
    expect(result.sheet).toContain(`<c r = ${quote}A3${quote} s=${quote}0${quote}/>`);
    expect(result.sheet).toContain(`<c r=${quote}L3${quote} s=${quote}0${quote}/>`);
    expect(result.$('c[r="B3"]')).toHaveLength(1);
    expect(result.$('c[r="B3"]').attr('s')).toBe('0');
    expect(result.nextRow).toBe(4);
    for (const name of Object.keys(entries)) if (name !== result.path) expect(Buffer.from(result.entries[name]).equals(Buffer.from(entries[name]))).toBe(true);
  });
  it('preserves a preformatted destination row and cells outside the tracker', () => {
    const entries = unzipSync(blankWorkbook());
    entries['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(entries['xl/worksheets/sheet1.xml']).replace('</sheetData>', '<row r="3" ht="30" customHeight="1"><c r="A3" s="0"/><c r="B3" s="0"/><c r="L3" s="0"/></row></sheetData>'));
    const sheet = inspectWorkbook(appendApplication(zipSync(entries), Array(10).fill('New'))).sheet;
    expect(sheet).toContain('<c r="A3" s="0"/>');
    expect(sheet).toContain('<c r="L3" s="0"/>');
    expect(sheet).toContain('<row r="3" ht="30" customHeight="1">');
    expect(sheet).toContain('<c r="B3" s="0" t="inlineStr">');
  });
  it('never overwrites data outside tracker columns', () => {
    const entries = unzipSync(blankWorkbook());
    entries['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(entries['xl/worksheets/sheet1.xml']).replace('</sheetData>', '<row r="3"><c r="A3" t="inlineStr"><is><t>Keep this note</t></is></c></row></sheetData>'));
    const output = appendApplication(zipSync(entries), Array(10).fill('New'));
    expect(inspectWorkbook(output).sheet).toContain('Keep this note');
    expect(inspectWorkbook(output).nextRow).toBe(5);
  });
  it.each(['garbage', 'xml', 'bomb', 'macros', 'table'])('rejects invalid or unsafe %s files', kind => {
    const entries = unzipSync(blankWorkbook());
    if (kind === 'xml') entries['xl/styles.xml'] = strToU8('<!DOCTYPE x [<!ENTITY x "boom">]><x>&x;</x>');
    if (kind === 'bomb') entries['large.xml'] = new Uint8Array(9*1024*1024);
    if (kind === 'macros') entries['xl/vbaProject.bin'] = new Uint8Array([1]);
    if (kind === 'table') entries['xl/tables/table1.xml'] = strToU8('<table/>');
    expect(() => inspectWorkbook(kind === 'garbage' ? new Uint8Array([1,2,3]) : zipSync(entries))).toThrow();
  });
  it('appends after data, not style-only rows, preserving existing XML and all other parts', () => {
    const original = syntheticWorkbook();
    expect(inspectWorkbook(original).nextRow).toBe(4);
    const output = appendApplication(original, ['=literal', 'Engineer', '', '', '', '', '2026-09-06', '', '', 'https://example.test/job']);
    const before = unzipSync(original), after = unzipSync(output);
    for (const key of Object.keys(before)) if (key !== 'xl/worksheets/sheet1.xml') expect(after[key]).toEqual(before[key]);
    const xml = strFromU8(after['xl/worksheets/sheet1.xml']);
    expect(xml).toContain('<f>1+2</f><v>3</v>');
    expect(xml).toContain('<row r="4" ht="24" customHeight="1">');
    expect(xml).toContain('<c r="B4" s="0" t="inlineStr"><is><t xml:space="preserve">=literal</t>');
    expect(xml.indexOf('<row r="4"')).toBeLessThan(xml.indexOf('<row r="900"'));
  });
});
