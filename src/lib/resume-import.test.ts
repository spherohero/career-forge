import { Document, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractResumeImport, MAX_RESUME_BYTES } from "./resume-import";

async function makeDocx(text: string): Promise<Uint8Array> {
  const document = new Document({ sections: [{ children: [new Paragraph(text)] }] });
  return new Uint8Array(await Packer.toBuffer(document));
}

async function makePdf(text?: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage();
  if (text) page.drawText(text, { font: await document.embedFont(StandardFonts.Helvetica) });
  return document.save();
}

describe("extractResumeImport", () => {
  it("extracts supported UTF-8 TXT, DOCX, and selectable PDF text", async () => {
    const txt = await extractResumeImport({
      originalName: "../Ada résumé.txt",
      mediaType: "text/plain",
      bytes: new TextEncoder().encode("Ada\r\nEngineer\u0000\u0007"),
    });
    const docx = await extractResumeImport({
      originalName: "resume.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await makeDocx("Built reliable firmware"),
    });
    const pdf = await extractResumeImport({
      originalName: "resume.pdf",
      mediaType: "application/pdf",
      bytes: await makePdf("Selectable systems engineer"),
    });

    expect(txt).toMatchObject({ originalFilename: "Ada résumé.txt", mediaType: "text/plain", text: "Ada\nEngineer" });
    expect(docx.text).toContain("Built reliable firmware");
    expect(pdf.text).toContain("Selectable systems engineer");
  });

  it("rejects oversize, mismatched, invalid UTF-8, and no-text documents", async () => {
    await expect(extractResumeImport({ originalName: "resume.txt", mediaType: "text/plain", bytes: new Uint8Array(MAX_RESUME_BYTES + 1) })).rejects.toThrow(/4 MiB/i);
    await expect(extractResumeImport({ originalName: "resume.pdf", mediaType: "text/plain", bytes: new TextEncoder().encode("not pdf") })).rejects.toThrow(/type/i);
    await expect(extractResumeImport({ originalName: "resume.txt", mediaType: "text/plain", bytes: new Uint8Array([0xc3, 0x28]) })).rejects.toThrow(/UTF-8/i);
    await expect(extractResumeImport({ originalName: "scan.pdf", mediaType: "application/pdf", bytes: await makePdf() })).rejects.toThrow(/scanned|text/i);
  });

  it("rejects a DOCX archive claiming unsafe expanded content", async () => {
    const bytes = new Uint8Array(await makeDocx("Safe text"));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let changed = false;
    for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 32 * 1024 * 1024, true);
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
    await expect(extractResumeImport({ originalName: "resume.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes })).rejects.toThrow(/archive (?:expansion|content)/i);
  });

  it("does not accept a forged ZIP end record inside the real archive comment", async () => {
    const original = new Uint8Array(await makeDocx("Safe text"));
    const bytes = new Uint8Array(original.byteLength + 22);
    bytes.set(original);
    const view = new DataView(bytes.buffer);
    let realEnd = -1;
    for (let offset = original.byteLength - 22; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) { realEnd = offset; break; }
    }
    expect(realEnd).toBeGreaterThanOrEqual(0);
    view.setUint16(realEnd + 20, 22, true);
    view.setUint32(original.byteLength, 0x06054b50, true);
    await expect(extractResumeImport({ originalName: "resume.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes })).rejects.toThrow(/archive/i);
  });

  it("bounded-decompresses DOCX entries instead of trusting declared sizes", async () => {
    const bytes = new Uint8Array(await makeDocx("Safe text"));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let changed = false;
    for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50 && view.getUint16(offset + 10, true) === 8 && view.getUint32(offset + 24, true) > 1) {
        view.setUint32(offset + 24, 1, true);
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
    await expect(extractResumeImport({ originalName: "resume.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes })).rejects.toThrow(/archive content/i);
  });
});
