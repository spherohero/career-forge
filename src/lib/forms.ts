import { jobInputSchema, profileInputSchema, type JobInput, type ProfileInput } from "./domain";

export type FormErrors = Record<string, string[]>;
export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; errors: FormErrors };

function value(formData: FormData, key: string): string {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function errorsFor(error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } }): FormErrors {
  const entries = Object.entries(error.flatten().fieldErrors).filter(
    (entry): entry is [string, string[]] => Boolean(entry[1]?.length),
  );
  return Object.fromEntries(entries);
}

export function parseJobForm(formData: FormData): ParseResult<JobInput> {
  const url = value(formData, "url");
  const result = jobInputSchema.safeParse({
    title: value(formData, "title"),
    company: value(formData, "company"),
    location: value(formData, "location"),
    workModel: value(formData, "workModel") || "unknown",
    url: url || undefined,
    description: value(formData, "description"),
    source: "manual",
  });
  return result.success
    ? { success: true, data: result.data }
    : { success: false, errors: errorsFor(result.error) };
}

function blocks(text: string): string[][] {
  return text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((block) => block.length > 0);
}

function nullableDate(input: string): string | null {
  return !input || /^(present|current|now)$/i.test(input) ? null : input;
}

function formatError(field: string, expected: string): ParseResult<never> {
  return { success: false, errors: { [field]: [`Use this format: ${expected}`] } };
}

function achievementFromLine(line: string) {
  const content = line.replace(/^[-*•]\s*/, "");
  const separator = content.indexOf("::");
  const text = (separator < 0 ? content : content.slice(0, separator)).trim();
  const evidence = separator < 0 ? "" : content.slice(separator + 2).trim();
  return { text, evidence: evidence || null, skills: [], verified: true };
}

export function parseProfileForm(formData: FormData): ParseResult<ProfileInput> {
  const skills = value(formData, "skills")
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, category: "General", verified: true }));

  const experiences = [];
  for (const block of blocks(value(formData, "experiences"))) {
    const fields = block[0].split("|").map((item) => item.trim());
    if (fields.length !== 5 || !fields[0] || !fields[1] || block.slice(1).some((line) => !/^[-*•]\s*/.test(line))) {
      return formatError("experiences", "Organization | Role | Start | End | Location, followed by - evidence bullets");
    }
    experiences.push({
      organization: fields[0],
      role: fields[1],
      startDate: nullableDate(fields[2]),
      endDate: nullableDate(fields[3]),
      location: fields[4] ?? "",
      achievements: block.slice(1).map(achievementFromLine),
    });
  }

  const projects = [];
  for (const block of blocks(value(formData, "projects"))) {
    const fields = block[0].split("|").map((item) => item.trim());
    if (fields.length !== 4 || !fields[0]) {
      return formatError("projects", "Name | URL | Start | End, then a summary and - evidence bullets");
    }
    const detailLines = block.slice(1);
    const summary = detailLines.filter((line) => !/^[-*•]\s*/.test(line)).join("\n");
    projects.push({
      name: fields[0],
      url: fields[1] || null,
      startDate: nullableDate(fields[2] ?? ""),
      endDate: nullableDate(fields[3] ?? ""),
      summary,
      achievements: detailLines
        .filter((line) => /^[-*•]\s*/.test(line))
        .map(achievementFromLine),
    });
  }

  const education = [];
  for (const block of blocks(value(formData, "education"))) {
    const fields = block[0].split("|").map((item) => item.trim());
    if (fields.length !== 5 || !fields[0]) {
      return formatError("education", "Institution | Degree | Field | Start | End, then optional details");
    }
    education.push({
      institution: fields[0],
      degree: fields[1],
      field: fields[2],
      startDate: nullableDate(fields[3]),
      endDate: nullableDate(fields[4]),
      details: block.slice(1).join("\n"),
    });
  }

  const result = profileInputSchema.safeParse({
    fullName: value(formData, "fullName"),
    email: value(formData, "email"),
    phone: value(formData, "phone"),
    location: value(formData, "location"),
    headline: value(formData, "headline"),
    summary: value(formData, "summary"),
    skills,
    experiences,
    projects,
    education,
  });
  return result.success
    ? { success: true, data: result.data }
    : { success: false, errors: errorsFor(result.error) };
}
