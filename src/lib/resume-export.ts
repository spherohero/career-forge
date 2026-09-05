import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { ResumeVersion, TailoringSuggestion } from "./analysis";
import type { Achievement, Job, Profile } from "./domain";

export function assembleTailoredResume(profile: Profile, job: Job, version: ResumeVersion): Profile {
  if (version.jobId !== job.id) throw new Error("Resume version does not belong to this job.");
  const accepted = new Map<string, TailoringSuggestion>();
  for (const suggestion of version.suggestions) {
    if (suggestion.status === "accepted" && !accepted.has(suggestion.sourceAchievementId)) {
      accepted.set(suggestion.sourceAchievementId, suggestion);
    }
  }
  const tailor = (items: Achievement[]): Achievement[] => items
    .map((item, index) => {
      const candidate = accepted.get(item.id);
      const suggestion = candidate?.originalText === item.text ? candidate : undefined;
      return {
        item: suggestion ? { ...item, text: suggestion.revisedText } : { ...item },
        index,
        priority: suggestion && suggestion.matchedRequirementIds.length > 0 ? 0 : 1,
      };
    })
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ item }) => item);

  return {
    ...profile,
    skills: profile.skills.map((item) => ({ ...item })),
    experiences: profile.experiences.map((item) => ({ ...item, achievements: tailor(item.achievements) })),
    projects: profile.projects.map((item) => ({ ...item, achievements: tailor(item.achievements) })),
    education: profile.education.map((item) => ({ ...item })),
  };
}

function dateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  return `${start ?? ""} - ${end ?? "Present"}`;
}

function docxHeading(text: string): Paragraph {
  return new Paragraph({
    text: text.toUpperCase(),
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 220, after: 80 },
  });
}

function docxBullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 50 } });
}

export async function createResumeDocx(profile: Profile): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: profile.fullName, bold: true, size: 32 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      text: [profile.email, profile.phone, profile.location].filter(Boolean).join(" | "),
    }),
  ];
  if (profile.headline) children.push(new Paragraph({ alignment: AlignmentType.CENTER, text: profile.headline }));
  if (profile.summary) children.push(docxHeading("Summary"), new Paragraph(profile.summary));
  if (profile.skills.length) {
    children.push(docxHeading("Skills"), new Paragraph(profile.skills.filter((item) => item.verified).map((item) => item.name).join(", ")));
  }
  if (profile.experiences.length) {
    children.push(docxHeading("Experience"));
    for (const experience of profile.experiences) {
      children.push(new Paragraph({
        keepNext: true,
        children: [
          new TextRun({ text: `${experience.role} - ${experience.organization}`, bold: true }),
          new TextRun({ text: [experience.location, dateRange(experience.startDate, experience.endDate)].filter(Boolean).join(" | "), break: 1 }),
        ],
      }));
      children.push(...experience.achievements.filter((item) => item.verified).map((item) => docxBullet(item.text)));
    }
  }
  if (profile.projects.length) {
    children.push(docxHeading("Projects"));
    for (const project of profile.projects) {
      children.push(new Paragraph({ keepNext: true, children: [new TextRun({ text: project.name, bold: true }), new TextRun({ text: dateRange(project.startDate, project.endDate), break: 1 })] }));
      if (project.summary) children.push(new Paragraph(project.summary));
      children.push(...project.achievements.filter((item) => item.verified).map((item) => docxBullet(item.text)));
    }
  }
  if (profile.education.length) {
    children.push(docxHeading("Education"));
    for (const education of profile.education) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: education.institution, bold: true }),
          new TextRun({ text: [education.degree, education.field].filter(Boolean).join(", "), break: 1 }),
          new TextRun({ text: dateRange(education.startDate, education.endDate), break: 1 }),
          ...(education.details ? [new TextRun({ text: education.details, break: 1 })] : []),
        ],
      }));
    }
  }

  const document = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 21 }, paragraph: { spacing: { line: 240 } } } } },
    sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }],
  });
  return Packer.toBuffer(document);
}

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function pdfSafeText(text: string, font: PDFFont): string {
  return [...text].map((character) => {
    try { font.encodeText(character); return character; } catch { return "?"; }
  }).join("");
}

export async function createResumePdf(profile: Profile): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const width = 612;
  const height = 792;
  const margin = 54;
  let page: PDFPage = document.addPage([width, height]);
  let y = height - margin;

  const addLine = (raw: string, options: { size?: number; bold?: boolean; indent?: number; gap?: number } = {}) => {
    const size = options.size ?? 10.5;
    const selectedFont = options.bold ? bold : regular;
    const indent = options.indent ?? 0;
    const lines = wrapText(pdfSafeText(raw, selectedFont), selectedFont, size, width - margin * 2 - indent);
    for (const line of lines.length ? lines : [""]) {
      if (y < margin + size) { page = document.addPage([width, height]); y = height - margin; }
      page.drawText(line, { x: margin + indent, y, size, font: selectedFont, color: rgb(0.08, 0.1, 0.1) });
      y -= size * 1.35;
    }
    y -= options.gap ?? 0;
  };
  const heading = (text: string) => { y -= 5; addLine(text.toUpperCase(), { size: 11, bold: true, gap: 3 }); };
  const bullet = (text: string) => addLine(`- ${text}`, { indent: 10, gap: 1 });

  addLine(profile.fullName, { size: 18, bold: true, gap: 2 });
  addLine([profile.email, profile.phone, profile.location].filter(Boolean).join(" | "), { size: 9.5, gap: 2 });
  if (profile.headline) addLine(profile.headline, { size: 10.5 });
  if (profile.summary) { heading("Summary"); addLine(profile.summary); }
  const verifiedSkills = profile.skills.filter((item) => item.verified);
  if (verifiedSkills.length) { heading("Skills"); addLine(verifiedSkills.map((item) => item.name).join(", ")); }
  if (profile.experiences.length) {
    heading("Experience");
    for (const item of profile.experiences) {
      addLine(`${item.role} - ${item.organization}`, { bold: true });
      addLine([item.location, dateRange(item.startDate, item.endDate)].filter(Boolean).join(" | "), { size: 9.5, gap: 1 });
      item.achievements.filter((achievement) => achievement.verified).forEach((achievement) => bullet(achievement.text));
    }
  }
  if (profile.projects.length) {
    heading("Projects");
    for (const item of profile.projects) {
      addLine(item.name, { bold: true });
      if (item.summary) addLine(item.summary);
      item.achievements.filter((achievement) => achievement.verified).forEach((achievement) => bullet(achievement.text));
    }
  }
  if (profile.education.length) {
    heading("Education");
    for (const item of profile.education) {
      addLine(item.institution, { bold: true });
      addLine([[item.degree, item.field].filter(Boolean).join(", "), dateRange(item.startDate, item.endDate)].filter(Boolean).join(" | "));
      if (item.details) addLine(item.details);
    }
  }
  document.setTitle(`${profile.fullName} Resume`);
  document.setProducer("Career Forge");
  return document.save({ useObjectStreams: false });
}

export function sanitizeExportFilename(value: string): string {
  const safe = value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return safe || "resume";
}
