import { basename, extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import { extractText } from "unpdf";

export const MAX_RESUME_BYTES = 4 * 1024 * 1024;
const MAX_DOCX_EXPANDED_BYTES = 16 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2_048;

const TYPES_BY_EXTENSION = new Map([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".txt", "text/plain"],
]);

export interface ResumeImportFile {
  originalName: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface ExtractedResumeImport {
  originalFilename: string;
  mediaType: string;
  text: string;
}

export function sanitizeOriginalFilename(value: string): string {
  const safe = basename(value.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim()
    .slice(0, 180);
  return safe || "resume";
}

export function normalizeImportedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function assertMagic(extension: string, bytes: Uint8Array): void {
  if (extension === ".pdf" && new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("The file content does not match its PDF type.");
  }
  if (extension === ".docx" && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new Error("The file content does not match its DOCX type.");
  }
}

function assertSafeDocxArchive(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  let end = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0 || end + 22 + view.getUint16(end + 20, true) !== bytes.byteLength) {
    throw new Error("The DOCX archive is invalid.");
  }
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    entries === 0 ||
    entries !== entriesOnDisk ||
    entries > MAX_DOCX_ENTRIES ||
    centralOffset + centralSize !== end
  ) throw new Error("The DOCX archive exceeds safe structure limits.");

  let offset = centralOffset;
  let expanded = 0;
  let compressed = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("The DOCX archive is invalid.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const localOffset = view.getUint32(offset + 42, true);
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) throw new Error("The DOCX archive uses an unsupported or encrypted entry.");
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff) throw new Error("ZIP64 DOCX archives are not supported.");
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("The DOCX archive is invalid.");
    const dataOffset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataOffset + compressedSize > centralOffset) throw new Error("The DOCX archive is invalid.");

    let actualSize: number;
    try {
      actualSize = method === 0
        ? compressedSize
        : inflateRawSync(bytes.subarray(dataOffset, dataOffset + compressedSize), {
            maxOutputLength: MAX_DOCX_EXPANDED_BYTES - expanded,
          }).byteLength;
    } catch {
      throw new Error("The DOCX archive content exceeds safe expansion limits.");
    }
    if (actualSize !== expandedSize) throw new Error("The DOCX archive content sizes are inconsistent.");
    compressed += compressedSize;
    expanded += actualSize;
    if (expanded > MAX_DOCX_EXPANDED_BYTES || expanded > Math.max(1, compressed) * 200) {
      throw new Error("The DOCX archive expansion exceeds safe limits.");
    }
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (offset !== centralOffset + centralSize) throw new Error("The DOCX archive is invalid.");
}

export async function extractResumeImport(file: ResumeImportFile): Promise<ExtractedResumeImport> {
  if (file.bytes.byteLength === 0) throw new Error("The resume file is empty.");
  if (file.bytes.byteLength > MAX_RESUME_BYTES) throw new Error("Resume files must be no larger than 4 MiB.");

  const originalFilename = sanitizeOriginalFilename(file.originalName);
  const extension = extname(originalFilename).toLowerCase();
  const mediaType = file.mediaType.split(";", 1)[0].trim().toLowerCase();
  const expectedType = TYPES_BY_EXTENSION.get(extension);
  if (!expectedType || mediaType !== expectedType) {
    throw new Error("Resume file extension and media type must identify PDF, DOCX, or UTF-8 TXT.");
  }
  assertMagic(extension, file.bytes);
  if (extension === ".docx") assertSafeDocxArchive(file.bytes);

  let extracted: string;
  try {
    if (extension === ".txt") {
      extracted = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    } else if (extension === ".docx") {
      extracted = (await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) })).value;
    } else {
      const result = await extractText(file.bytes, { mergePages: true });
      extracted = result.text;
    }
  } catch (error) {
    if (error instanceof TypeError && extension === ".txt") throw new Error("TXT resumes must use valid UTF-8 encoding.");
    throw new Error(`Unable to extract text from the ${extension.slice(1).toUpperCase()} resume.`, { cause: error });
  }

  const text = normalizeImportedText(extracted);
  if (!text) throw new Error("No selectable text was found. Scanned or image-only resumes are not supported.");
  if (new TextEncoder().encode(text).byteLength > MAX_EXTRACTED_TEXT_BYTES) throw new Error("The extracted resume text exceeds safe limits.");
  return { originalFilename, mediaType, text };
}
