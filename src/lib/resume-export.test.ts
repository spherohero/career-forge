import mammoth from "mammoth";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import type { ResumeVersion } from "./analysis";
import type { Job, Profile } from "./domain";
import { assembleTailoredResume, createResumeDocx, createResumePdf } from "./resume-export";

const profile: Profile = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+1 555 0100",
  location: "London",
  headline: "Systems Engineer",
  summary: "Builds dependable systems.",
  skills: [{ id: "skill-1", name: "C++", category: "Languages", verified: true }],
  experiences: [{
    id: "experience-1",
    organization: "Signal Labs",
    role: "Engineer",
    location: "Remote",
    startDate: "2024",
    endDate: null,
    achievements: [
      { id: "achievement-unmatched", text: "Documented test procedures.", evidence: null, skills: [], verified: true },
      { id: "achievement-accepted", text: "Built 3 firmware tools in C++.", evidence: "repo", skills: ["C++"], verified: true },
      { id: "achievement-pending", text: "Tested SPI devices.", evidence: null, skills: ["SPI"], verified: true },
    ],
  }],
  projects: [],
  education: [{ id: "education-1", institution: "University", degree: "B.S.", field: "Engineering", startDate: "2022", endDate: "2026", details: "Honors" }],
  updatedAt: "2026-09-03T00:00:00.000Z",
};

const job: Job = {
  id: "job-1", title: "Firmware Engineer", company: "Acme", location: "Remote", workModel: "remote",
  url: null, description: "C++ firmware", source: "manual", salary: null, notes: null, status: "saved",
  createdAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z",
};

const version: ResumeVersion = {
  id: "version-1", jobId: job.id, name: "Acme Firmware v1", mode: "ai",
  createdAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z",
  suggestions: [
    { id: "accepted", sourceAchievementId: "achievement-accepted", originalText: "Built 3 firmware tools in C++.", revisedText: "Built 3 C++ firmware tools.", rationale: "Match", matchedRequirementIds: ["requirement-1"], evidence: "repo", status: "accepted" },
    { id: "pending", sourceAchievementId: "achievement-pending", originalText: "Tested SPI devices.", revisedText: "Fabricated rewrite.", rationale: "Pending", matchedRequirementIds: ["requirement-1"], evidence: null, status: "pending" },
  ],
};

describe("assembleTailoredResume", () => {
  it("replaces only accepted linked wording, ranks it first, and retains every original fact", () => {
    const resume = assembleTailoredResume(profile, job, version);
    expect(resume.experiences[0].achievements.map((item) => item.text)).toEqual([
      "Built 3 C++ firmware tools.",
      "Documented test procedures.",
      "Tested SPI devices.",
    ]);
    expect(profile.experiences[0].achievements[1].text).toBe("Built 3 firmware tools in C++.");
  });

  it("does not apply accepted wording after its immutable source fact changes", () => {
    const changedProfile: Profile = {
      ...profile,
      experiences: profile.experiences.map((experience) => ({
        ...experience,
        achievements: experience.achievements.map((achievement) =>
          achievement.id === "achievement-accepted" ? { ...achievement, text: "Maintained one internal script." } : achievement,
        ),
      })),
    };
    const resume = assembleTailoredResume(changedProfile, job, version);
    expect(resume.experiences[0].achievements.map((item) => item.text)).toContain("Maintained one internal script.");
    expect(resume.experiences[0].achievements.map((item) => item.text)).not.toContain("Built 3 C++ firmware tools.");
  });
});

describe("ATS document generation", () => {
  it("creates selectable one-column DOCX and PDF containing accepted and original wording", async () => {
    const resume = assembleTailoredResume(profile, job, version);
    const docxText = (await mammoth.extractRawText({ buffer: await createResumeDocx(resume) })).value;
    const pdfResult = await extractText(await createResumePdf(resume), { mergePages: true });
    const pdfText = pdfResult.text;

    for (const text of [docxText, pdfText]) {
      expect(text).toContain("Ada Lovelace");
      expect(text).toContain("Built 3 C++ firmware tools.");
      expect(text).toContain("Tested SPI devices.");
      expect(text).not.toContain("Fabricated rewrite.");
    }
  });
});
