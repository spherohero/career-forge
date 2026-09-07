// Deliberately conservative: these are editable strings, never verified profile facts.
export const prefillFields = ["fullName", "email", "phone", "location", "headline", "links", "summary", "skills", "experiences", "projects", "education"] as const;
export type PrefillField = typeof prefillFields[number];
export type ResumePrefill = Record<PrefillField, string> & { warnings: string[] };
const sections: Record<string, PrefillField> = {
  summary: "summary", "professional summary": "summary", profile: "summary",
  skills: "skills", "technical skills": "skills", experience: "experiences",
  "work experience": "experiences", "professional experience": "experiences",
  projects: "projects", "selected projects": "projects", education: "education",
};

export function parseResumePrefill(text: string): ResumePrefill {
  const result: ResumePrefill = { fullName: "", email: "", phone: "", location: "", headline: "", links: "", summary: "", skills: "", experiences: "", projects: "", education: "", warnings: [] };
  const lines = text.replace(/\r/g, "").split("\n").map(line => line.trim());
  const header: string[] = [];
  const content: Partial<Record<PrefillField, string[]>> = {};
  let section: PrefillField | undefined;
  for (const line of lines) {
    const heading = sections[line.toLowerCase().replace(/:$/, "")];
    if (heading) { section = heading; content[section] ??= []; }
    else if (section) content[section]!.push(line);
    else if (line) header.push(line);
  }
  const contact = header.join("\n");
  result.email = contact.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? "";
  result.phone = contact.match(/(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\b\d{3})[ .-]\d{3}[ .-]\d{4}\b/)?.[0] ?? "";
  result.links = [...new Set(contact.match(/https?:\/\/[^\s|<>]+/g) ?? [])].join("\n");
  for (const part of header.flatMap(line => line.split(/\s*[|•]\s*/))) {
    if (/^(?:location|based in):\s*\S/i.test(part)) result.location = part.replace(/^[^:]+:\s*/, "");
    else if (/^[\p{L} .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?$/u.test(part)) result.location = part;
  }
  const first = header[0]?.replace(/^name:\s*/i, "") ?? "";
  if (/^[\p{L}][\p{L} .'-]+\s[\p{L}][\p{L} .'-]*$/u.test(first) && !/resume|curriculum vitae|engineer|developer|designer/i.test(first) && first.length <= 160) result.fullName = first;
  const headline = header.find(line => /^headline:\s*\S/i.test(line));
  if (headline) result.headline = headline.replace(/^headline:\s*/i, "");
  else if (result.fullName && /\b(engineer|developer|designer|analyst|student|specialist|manager|technician|intern)\b/i.test(header[1] ?? "") && !/[@|]|https?:/.test(header[1])) result.headline = header[1];
  result.summary = (content.summary ?? []).join("\n").trim();
  result.skills = [...new Set((content.skills ?? []).flatMap(line => line.replace(/^[-*•]\s*/, "").split(/[,;|]/)).map(s => s.trim()).filter(Boolean))].join("\n");
  for (const key of ["experiences", "projects", "education"] as const) {
    const raw = (content[key] ?? []).join("\n").trim();
    if (!raw) continue;
    // DOCX extraction separates paragraphs with blank lines, including bullets.
    // Join only explicit evidence bullets; keep ambiguous prose blocks separate.
    const blocks = raw.replace(/\n\s*\n(?=[-*•]\s)/g, "\n").split(/\n\s*\n/);
    const accepted: string[] = [];
    for (const block of blocks) {
      const rows = block.split("\n");
      const fields = rows[0].split("|").map(s => s.trim());
      if (fields.length === (key === "projects" ? 4 : 5) && fields[0] && (key !== "experiences" || fields[1])) accepted.push(block);
      else if (key === "projects" && rows[0] && !/^[-*•]/.test(rows[0])) accepted.push(`${rows[0]} | | |\n${rows.slice(1).join("\n")}`);
      else if (key === "education" && /\b(university|college|institute|school)\b/i.test(rows[0])) accepted.push(`${rows[0]} | | | |\n${rows.slice(1).join("\n")}`);
      else if (key === "experiences" && /^.+\s+at\s+.+$/i.test(rows[0]) && rows.slice(1).every(row => /^[-*•]/.test(row))) {
        const [role, organization] = rows[0].split(/\s+at\s+/i);
        accepted.push(`${organization} | ${role} | | |\n${rows.slice(1).join("\n")}`);
      } else result.warnings.push(`${key === "experiences" ? "Experience" : key}: an ambiguous block was not mapped. Copy and correct it from the original text.`);
    }
    result[key] = accepted.join("\n\n");
  }
  return result;
}
