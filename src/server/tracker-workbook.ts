import { strFromU8, strToU8, zipSync } from "fflate";
import { inflateRawSync } from "node:zlib";
import { load } from "cheerio";
import { SaxesParser } from "saxes";

export const MAX_WORKBOOK_BYTES = 4 * 1024 * 1024;
const MAX_EXPANDED = 24 * 1024 * 1024;
const HEADERS = ['Company', 'Position', 'Location', 'pos #', 'pay', 'post date', 'apply date', 'close date', 'response', 'website'];
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const columns = 'BCDEFGHIJK';
const invalid = () => new Error('Unsupported workbook. Use a plain .xlsx with Sheet1 headers in B2:K2 (Company through website), without tables, merged data cells, protection, macros or external connections.');
function escapeXml(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function cell(ref: string, value: string, style = '') {
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value.slice(0, 32767))}</t></is></c>`;
}
export function blankWorkbook(): Uint8Array {
  const files = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': `<styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}"><cols><col min="2" max="11" width="24" customWidth="1"/></cols><sheetData><row r="2">${HEADERS.map((text, i) => cell(`${columns[i]}2`, text)).join('')}</row></sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)])));
}

// Validate the entire directory and local record layout before allocating output.
// ZIP64, encryption and nonstandard compression are intentionally unsupported.
function readBoundedZip(bytes: Uint8Array): Record<string, Uint8Array> {
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => input.readUInt16LE(at);
  const u32 = (at: number) => input.readUInt32LE(at);
  let end = input.length - 22;
  while (end >= Math.max(0, input.length - 65557) && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== input.length)) end--;
  if (end < 0 || end < input.length - 65557 || u16(end + 4) || u16(end + 6)) throw invalid();
  const count = u16(end + 10), directory = u32(end + 16);
  if (!count || count > 256 || count !== u16(end + 8) || directory + u32(end + 12) !== end) throw invalid();
  const records: Array<{ name: string; start: number; data: number; end: number; size: number; original: number; method: number; crc: number }> = [];
  const names = new Set<string>();
  let offset = directory, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) throw invalid();
    const flags = u16(offset + 8), method = u16(offset + 10), crc = u32(offset + 16);
    const size = u32(offset + 20), original = u32(offset + 24), nameLength = u16(offset + 28);
    const next = offset + 46 + nameLength + u16(offset + 30) + u16(offset + 32), start = u32(offset + 42);
    if (next > end || u16(offset + 34) || flags & ~0x080e || ![0, 8].includes(method)) throw invalid();
    const nameBytes = input.subarray(offset + 46, offset + 46 + nameLength);
    const name = strFromU8(nameBytes);
    expanded += original;
    if (!name || names.has(name) || /(^\/|\\|(^|\/)\.\.(\/|$)|\0)/.test(name) || expanded > MAX_EXPANDED || original > 8 * 1024 * 1024 || size > MAX_WORKBOOK_BYTES) throw invalid();
    if (/(vbaProject|externalLinks|connections|embeddings|activeX|_xmlsignatures|tables\/)/i.test(name)) throw invalid();
    names.add(name);
    if (start + 30 > directory || u32(start) !== 0x04034b50 || u16(start + 6) !== flags || u16(start + 8) !== method || u16(start + 26) !== nameLength) throw invalid();
    const data = start + 30 + nameLength + u16(start + 28);
    if (data + size > directory || !input.subarray(start + 30, start + 30 + nameLength).equals(nameBytes)) throw invalid();
    for (const [local, central] of [[u32(start + 14), crc], [u32(start + 18), size], [u32(start + 22), original]]) {
      if (local !== central && (!(flags & 8) || local !== 0)) throw invalid();
    }
    let recordEnd = data + size;
    if (flags & 8) {
      if (recordEnd + 12 > directory) throw invalid();
      if (u32(recordEnd) === 0x08074b50) recordEnd += 4;
      if (recordEnd + 12 > directory || u32(recordEnd) !== crc || u32(recordEnd + 4) !== size || u32(recordEnd + 8) !== original) throw invalid();
      recordEnd += 12;
    }
    if (method === 0 && size !== original) throw invalid();
    records.push({ name, start, data, end: recordEnd, size, original, method, crc });
    offset = next;
  }
  if (offset !== end) throw invalid();
  let position = 0;
  for (const record of [...records].sort((a, b) => a.start - b.start)) {
    if (record.start !== position) throw invalid(); // no aliases, overlaps or hidden records
    position = record.end;
  }
  if (position !== directory) throw invalid();
  const entries: Record<string, Uint8Array> = Object.create(null);
  for (const record of records) {
    const compressed = input.subarray(record.data, record.data + record.size);
    // Native zlib enforces this cap during inflation, not after an unbounded allocation.
    const data = record.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, record.original), info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    const output = Buffer.isBuffer(data) ? data : data.buffer;
    if ((!Buffer.isBuffer(data) && data.engine.bytesWritten !== compressed.length) || output.length !== record.original) throw invalid();
    let crc = 0xffffffff;
    for (const byte of output) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== record.crc) throw invalid();
    entries[record.name] = output;
  }
  return entries;
}

export function inspectWorkbook(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_WORKBOOK_BYTES) throw new Error('Workbook must be at most 4 MiB.');
  const entries = readBoundedZip(bytes);
  for (const [name, data] of Object.entries(entries)) {
    if (/\.(xml|rels)$/.test(name)) {
      const text = strFromU8(data);
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw invalid();
      const parser = new SaxesParser();
      parser.on('error', () => { throw invalid(); });
      parser.write(text).close();
    }
  }
  const xml = (name: string) => { if (!entries[name]) throw invalid(); return strFromU8(entries[name]); };
  if (!xml('[Content_Types].xml').includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) throw invalid();
  const wb = load(xml('xl/workbook.xml'), { xml: true });
  const sheets = wb('sheet').filter((_, el) => wb(el).attr('name') === 'Sheet1');
  if (sheets.length !== 1) throw invalid();
  const rels = load(xml('xl/_rels/workbook.xml.rels'), { xml: true });
  const rel = rels('Relationship').filter((_, el) => rels(el).attr('Id') === sheets.attr('r:id'));
  const target = rel.attr('Target') ?? '';
  if (rel.attr('TargetMode') === 'External' || !/^\/?(?:xl\/)?worksheets\/sheet\d+\.xml$/.test(target)) throw invalid();
  const path = target.startsWith('/xl/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`;
  const sheet = xml(path);
  const $ = load(sheet, { xml: true });
  if ($('worksheet').attr('xmlns') !== NS || $('sheetData').length !== 1 || !sheet.includes('</sheetData>') || $('sheetProtection,tableParts,extLst').length) throw invalid();
  // Merges above the header are harmless; data-area merges cannot be appended safely.
  $('mergeCell').each((_, el) => { const ref = $(el).attr('ref') ?? ''; if (!/^[A-Z]+1:[A-Z]+1$/.test(ref)) throw invalid(); });
  const shared = entries['xl/sharedStrings.xml'] ? load(xml('xl/sharedStrings.xml'), { xml: true }) : null;
  const value = (ref: string) => {
    const c = $(`c[r="${ref}"]`);
    if (c.attr('t') === 's') return shared ? shared('si').eq(Number(c.find('v').text())).text() : '';
    return c.find('t,v').text();
  };
  HEADERS.forEach((header, i) => { if (value(`${columns[i]}2`).trim().toLowerCase() !== header.toLowerCase()) throw invalid(); });
  let last = 2, previous = 0;
  $('sheetData > row').each((_, el) => {
    const row = Number($(el).attr('r'));
    if (!Number.isInteger(row) || row <= previous || row > 100_000) throw invalid();
    previous = row;
    $(el).children('c').each((_, c) => {
      if (!new RegExp(`^[A-Z]+${row}$`).test($(c).attr('r') ?? '')) throw invalid();
      if (row > 2 && ($(c).find('f').length || $(c).find('v,t').text().length)) last = row;
    });
  });
  if (last >= 99_999) throw invalid();
  return { entries, path, sheet, nextRow: last + 1, $ };
}

export function appendApplication(bytes: Uint8Array, values: string[]): Uint8Array {
  if (values.length !== 10) throw new Error('Expected ten tracker values.');
  const { entries, path, sheet, nextRow, $ } = inspectWorkbook(bytes);
  const prior = $(`row[r="${nextRow - 1}"]`);
  const rowStyle = ['ht', 'customHeight', 's', 'customFormat'].map(key => prior.attr(key) ? ` ${key}="${escapeXml(prior.attr(key)!)}"` : '').join('');
  const destination = $(`row[r="${nextRow}"]`);
  const cells = values.map((value, i) => {
    const style = destination.find(`c[r="${columns[i]}${nextRow}"]`).attr('s') ?? (nextRow > 3 ? prior.find(`c[r="${columns[i]}${nextRow - 1}"]`).attr('s') : undefined);
    return cell(`${columns[i]}${nextRow}`, value, style ? ` s="${escapeXml(style)}"` : '');
  }).join('');
  const newRow = `<row r="${nextRow}"${rowStyle}>${cells}</row>`;
  let inserted = false;
  // Match quoted attribute values as units (including >), then let the XML
  // parser decode references and accept either quote and whitespace around =.
  const attributes = `(?:[^"'<>]|"[^"]*"|'[^']*')*?`;
  const rowPattern = new RegExp(`<row\\b${attributes}(?:/>|>[\\s\\S]*?</row\\s*>)`, 'g');
  const cellPattern = new RegExp(`<c\\b${attributes}(?:/>|>[\\s\\S]*?</c\\s*>)`, 'g');
  const reference = (xml: string, tag: string) => load(xml, { xml: true })(tag).first().attr('r') ?? '';
  let updated = sheet.replace(rowPattern, row => {
    const index = reference(row, 'row');
    if (Number(index) === nextRow) {
      inserted = true;
      // Keep the destination's row attributes and untouched cells byte-for-byte.
      const opening = row.match(new RegExp(`^<row\\b${attributes}>`))![0].replace(/\/>$/, '>');
      const existing = row.match(cellPattern) ?? [];
      const outside = existing.filter(c => !new RegExp(`^[B-K]${nextRow}$`).test(reference(c, 'c')));
      const before = outside.filter(c => reference(c, 'c') === `A${nextRow}`);
      const after = outside.filter(c => !before.includes(c));
      return `${opening}${before.join('')}${cells}${after.join('')}</row>`;
    }
    if (!inserted && Number(index) > nextRow) { inserted = true; return newRow + row; }
    return row;
  });
  if (!inserted) updated = updated.replace('</sheetData>', `${newRow}</sheetData>`);
  // Dimension is advisory. Omitting it lets Excel compute the actual used range.
  updated = updated.replace(/<dimension\b[^>]*\/>/, '');
  entries[path] = strToU8(updated);
  const output = zipSync(entries);
  inspectWorkbook(output);
  return output;
}
