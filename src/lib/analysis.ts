import type { Achievement, Job, Profile } from "./domain";

export type RequirementImportance =
  | "required"
  | "preferred"
  | "responsibility";

export interface JobRequirement {
  id: string;
  text: string;
  importance: RequirementImportance;
  skills: string[];
}

export interface RequirementMatch extends JobRequirement {
  evidenceIds: string[];
}

export interface JobAnalysis {
  score: number;
  requirements: JobRequirement[];
  matched: RequirementMatch[];
  missing: JobRequirement[];
  analyzedAt: string;
}

export interface TailoringSuggestion {
  id: string;
  sourceAchievementId: string;
  originalText: string;
  revisedText: string;
  rationale: string;
  matchedRequirementIds: string[];
  evidence: string | null;
  status: "pending" | "accepted" | "rejected";
}

export interface TailoringPlan {
  jobId: string;
  mode: "deterministic" | "ai";
  diagnostic?: string;
  suggestions: TailoringSuggestion[];
  createdAt: string;
}

export interface ResumeVersion extends TailoringPlan {
  id: string;
  name: string;
  updatedAt: string;
}

const SKILL_ALIASES: Array<[string, RegExp]> = [
  ["C++", /(?:\bc\+\+(?!\+)|\bcpp\b|c\/c\+\+)/i],
  ["C", /(?:\bc language\b|\bc programming\b|\bc\b(?!\+))/i],
  ["Embedded Linux", /\bembedded linux\b/i],
  ["Linux", /\blinux\b/i],
  ["FreeRTOS", /\bfreertos\b/i],
  ["RTOS", /\brtos\b|real[- ]time operating system/i],
  ["SPI", /\bspi\b/i],
  ["I2C", /\bi2c\b|\bi²c\b/i],
  ["UART", /\buart\b/i],
  ["CAN", /\bcan bus\b|\bcan protocol\b/i],
  ["ARM", /\barm(?:32|64)?\b/i],
  ["STM32", /\bstm32\b/i],
  ["Zephyr", /\bzephyr\b/i],
  ["Python", /\bpython\b/i],
  ["Rust", /\brust\b/i],
  ["Git", /\bgit\b/i],
  ["CMake", /\bcmake\b/i],
  ["GDB", /\bgdb\b/i],
  ["JTAG", /\bjtag\b/i],
  ["Yocto", /\byocto\b/i],
  ["Device Drivers", /\bdevice drivers?\b/i],
  ["Microcontrollers", /\bmicrocontrollers?\b|\bmcus?\b/i],
  ["Oscilloscope", /\boscilloscopes?\b/i],
  ["Logic Analyzer", /\blogic analy[sz]ers?\b/i],
  ["SystemVerilog", /\bsystemverilog\b/i],
  ["Verilog", /\bverilog\b/i],
  ["VHDL", /\bvhdl\b/i],
  ["FPGA", /\bfpga\b/i],
  ["PCB", /\bpcbs?\b|printed circuit boards?/i],
  ["Soldering", /\bsolder(?:ing|ed)?\b/i],
];

const STOP_WORDS = new Set([
  "and",
  "the",
  "with",
  "for",
  "from",
  "that",
  "this",
  "you",
  "your",
  "our",
  "are",
  "will",
  "have",
  "has",
  "job",
  "role",
  "work",
  "experience",
  "knowledge",
  "ability",
  "required",
  "preferred",
  "qualifications",
]);

export function extractSkills(text: string): string[] {
  const found = SKILL_ALIASES.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name,
  );

  if (found.includes("Embedded Linux")) {
    return found.filter((skill) => skill !== "Linux");
  }
  if (found.includes("FreeRTOS")) {
    return found.filter((skill) => skill !== "RTOS");
  }
  if (found.includes("SystemVerilog")) {
    return found.filter((skill) => skill !== "Verilog");
  }
  return found;
}

function cleanLine(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

export function extractRequirements(description: string): JobRequirement[] {
  const lines = description
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);
  const requirements: JobRequirement[] = [];
  let importance: RequirementImportance = "responsibility";

  for (const line of lines) {
    const normalized = line.toLowerCase().replace(/:$/, "");
    if (/^(required|minimum|basic)( qualifications?)?$/.test(normalized)) {
      importance = "required";
      continue;
    }
    if (/^(preferred|bonus|nice to have)( qualifications?)?$/.test(normalized)) {
      importance = "preferred";
      continue;
    }
    if (/^(responsibilities|what you(?:'|’)ll do|the role)$/.test(normalized)) {
      importance = "responsibility";
      continue;
    }
    if (line.length < 4) continue;

    requirements.push({
      id: `requirement-${requirements.length + 1}`,
      text: line,
      importance,
      skills: extractSkills(line),
    });
  }

  if (requirements.length === 0 && description.trim()) {
    return description
      .split(/(?<=[.!?])\s+/)
      .map(cleanLine)
      .filter((line) => line.length >= 20)
      .slice(0, 20)
      .map((text, index) => ({
        id: `requirement-${index + 1}`,
        text,
        importance: "responsibility" as const,
        skills: extractSkills(text),
      }));
  }

  return requirements.slice(0, 60);
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

function overlapScore(left: string, right: string): number {
  const leftWords = words(left);
  const rightWords = words(right);
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  return overlap / Math.min(leftWords.size, rightWords.size);
}

interface EvidenceItem {
  id: string;
  text: string;
  skills: string[];
}

function verifiedEvidence(profile: Profile): EvidenceItem[] {
  const skillEvidence = profile.skills
    .filter((skill) => skill.verified)
    .map((skill) => ({ id: skill.id, text: skill.name, skills: [skill.name] }));
  const achievementEvidence = [
    ...profile.experiences.flatMap((item) => item.achievements),
    ...profile.projects.flatMap((item) => item.achievements),
  ]
    .filter((achievement) => achievement.verified)
    .map((achievement) => ({
      id: achievement.id,
      text: achievement.text,
      skills: [...achievement.skills, ...extractSkills(achievement.text)],
    }));

  return [...skillEvidence, ...achievementEvidence];
}

function skillMatches(required: string, held: string): boolean {
  const left = required.toLowerCase();
  const right = held.toLowerCase();
  if (left === right) return true;
  if (left === "c" && right === "c++") return true;
  if (left === "rtos" && right === "freertos") return true;
  return false;
}

function evidenceFor(
  requirement: JobRequirement,
  evidence: EvidenceItem[],
): string[] {
  if (requirement.skills.length > 0) {
    const normalizedExpression = requirement.text.replace(
      /\band\s*\/\s*or\b/gi,
      "or",
    );
    const andGroups = normalizedExpression
      .split(/\band\b/i)
      .map(extractSkills)
      .filter((group) => group.length > 0);
    const skillGroups =
      andGroups.length > 1
        ? andGroups
        : /\bor\b/i.test(normalizedExpression)
          ? [requirement.skills]
          : requirement.skills.map((skill) => [skill]);
    const matchesByGroup = skillGroups.map((group) =>
      evidence.filter((item) =>
        group.some((requiredSkill) =>
          item.skills.some((heldSkill) => skillMatches(requiredSkill, heldSkill)),
        ),
      ),
    );
    const requirementSatisfied = matchesByGroup.every(
      (matches) => matches.length > 0,
    );
    if (!requirementSatisfied) return [];
    return [...new Set(matchesByGroup.flat().map((item) => item.id))];
  }

  return evidence
    .filter((item) => overlapScore(requirement.text, item.text) >= 0.35)
    .map((item) => item.id);
}

function importanceWeight(importance: RequirementImportance): number {
  if (importance === "required") return 3;
  if (importance === "preferred") return 1.5;
  return 1;
}

export function analyzeJobFit(profile: Profile, job: Job): JobAnalysis {
  const requirements = extractRequirements(job.description);
  const evidence = verifiedEvidence(profile);
  const matched: RequirementMatch[] = [];
  const missing: JobRequirement[] = [];
  let earnedWeight = 0;
  let totalWeight = 0;

  for (const requirement of requirements) {
    const weight = importanceWeight(requirement.importance);
    totalWeight += weight;
    const evidenceIds = evidenceFor(requirement, evidence);
    if (evidenceIds.length > 0) {
      earnedWeight += weight;
      matched.push({ ...requirement, evidenceIds });
    } else {
      missing.push(requirement);
    }
  }

  return {
    score: totalWeight === 0 ? 0 : Math.round((earnedWeight / totalWeight) * 100),
    requirements,
    matched,
    missing,
    analyzedAt: new Date().toISOString(),
  };
}

function verifiedAchievements(profile: Profile): Achievement[] {
  return [
    ...profile.experiences.flatMap((item) => item.achievements),
    ...profile.projects.flatMap((item) => item.achievements),
  ].filter((achievement) => achievement.verified);
}

export function buildDeterministicTailoringPlan(
  profile: Profile,
  job: Job,
  analysis: JobAnalysis,
): TailoringPlan {
  const relevantRequirementIds = new Map<string, string[]>();
  for (const match of analysis.matched) {
    for (const evidenceId of match.evidenceIds) {
      const current = relevantRequirementIds.get(evidenceId) ?? [];
      relevantRequirementIds.set(evidenceId, [...current, match.id]);
    }
  }

  const suggestions = verifiedAchievements(profile)
    .map((achievement) => {
      const direct = relevantRequirementIds.get(achievement.id) ?? [];
      const relevance =
        direct.length * 10 + overlapScore(achievement.text, job.description);
      return { achievement, direct, relevance };
    })
    .filter(({ relevance }) => relevance > 0)
    .sort((left, right) => right.relevance - left.relevance)
    .map(({ achievement, direct }, index): TailoringSuggestion => ({
      id: `suggestion-${index + 1}-${achievement.id}`,
      sourceAchievementId: achievement.id,
      originalText: achievement.text,
      revisedText: achievement.text,
      rationale:
        direct.length > 0
          ? "Selected because this verified achievement supports matched job requirements."
          : "Selected for its language overlap with the role.",
      matchedRequirementIds: direct,
      evidence: achievement.evidence,
      status: "pending",
    }));

  return {
    jobId: job.id,
    mode: "deterministic",
    suggestions,
    createdAt: new Date().toISOString(),
  };
}
