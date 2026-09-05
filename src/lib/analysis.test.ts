import { describe, expect, it } from "vitest";
import type { Job, Profile } from "./domain";
import {
  analyzeJobFit,
  buildDeterministicTailoringPlan,
  extractRequirements,
} from "./analysis";

const profile: Profile = {
  fullName: "Alex Morgan",
  email: "alex.morgan@example.test",
  phone: "",
  location: "Austin, TX",
  headline: "Embedded Systems Engineer",
  summary: "Embedded systems engineer.",
  skills: [
    { id: "skill-cpp", name: "C++", category: "Languages", verified: true },
    { id: "skill-spi", name: "SPI", category: "Embedded", verified: true },
    {
      id: "skill-linux",
      name: "Embedded Linux",
      category: "Embedded",
      verified: true,
    },
    {
      id: "skill-freertos",
      name: "FreeRTOS",
      category: "Embedded",
      verified: true,
    },
  ],
  experiences: [
    {
      id: "experience-1",
      organization: "Robotics Lab",
      role: "Embedded Developer",
      location: "Austin, TX",
      startDate: "2025-01",
      endDate: null,
      achievements: [
        {
          id: "achievement-1",
          text: "Implemented C++ firmware for SPI sensors running on FreeRTOS.",
          evidence: "Repository and bench test logs",
          skills: ["C++", "SPI", "FreeRTOS"],
          verified: true,
        },
      ],
    },
  ],
  projects: [],
  education: [],
  updatedAt: "2026-09-03T00:00:00.000Z",
};

const job: Job = {
  id: "job-1",
  title: "Embedded Software Intern",
  company: "Acme Avionics",
  location: "Orlando, FL",
  workModel: "hybrid",
  url: null,
  description: `Required qualifications:
- Proficiency in C or C++
- Experience with embedded Linux and SPI
Preferred qualifications:
- Familiarity with FreeRTOS`,
  source: "manual",
  salary: null,
  notes: null,
  status: "saved",
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
};

describe("extractRequirements", () => {
  it("preserves required and preferred qualification importance", () => {
    const requirements = extractRequirements(job.description);

    expect(requirements).toHaveLength(3);
    expect(requirements[0]).toMatchObject({
      importance: "required",
      skills: expect.arrayContaining(["C", "C++"]),
    });
    expect(requirements[1]).toMatchObject({
      importance: "required",
      skills: expect.arrayContaining(["Embedded Linux", "SPI"]),
    });
    expect(requirements[2]).toMatchObject({
      importance: "preferred",
      skills: ["FreeRTOS"],
    });
  });
});

describe("analyzeJobFit", () => {
  it("matches requirements only to verified profile evidence", () => {
    const analysis = analyzeJobFit(profile, job);

    expect(analysis.score).toBeGreaterThanOrEqual(70);
    expect(analysis.matched).toHaveLength(3);
    expect(analysis.missing).toHaveLength(0);
    expect(analysis.matched[2].evidenceIds).toContain("achievement-1");
  });

  it("does not count unverified profile skills", () => {
    const unverifiedProfile: Profile = {
      ...profile,
      skills: profile.skills.map((skill) =>
        skill.name === "FreeRTOS" ? { ...skill, verified: false } : skill,
      ),
      experiences: profile.experiences.map((experience) => ({
        ...experience,
        achievements: experience.achievements.map((achievement) => ({
          ...achievement,
          verified: false,
        })),
      })),
    };

    const analysis = analyzeJobFit(unverifiedProfile, job);

    expect(analysis.missing.some((item) => item.skills.includes("FreeRTOS"))).toBe(
      true,
    );
  });

  it("requires every AND group when a requirement also contains OR alternatives", () => {
    const withoutSpi: Profile = {
      ...profile,
      skills: profile.skills.filter((skill) => skill.name !== "SPI"),
      experiences: profile.experiences.map((experience) => ({
        ...experience,
        achievements: experience.achievements.map((achievement) => ({
          ...achievement,
          text: "Implemented C++ firmware running on FreeRTOS.",
          skills: ["C++", "FreeRTOS"],
        })),
      })),
    };
    const mixedRequirementJob: Job = {
      ...job,
      description: "Required qualifications:\n- Experience with C or C++ and SPI",
    };

    const analysis = analyzeJobFit(withoutSpi, mixedRequirementJob);

    expect(analysis.matched).toHaveLength(0);
    expect(analysis.missing).toHaveLength(1);
  });
});

describe("buildDeterministicTailoringPlan", () => {
  it("ranks relevant verified bullets without rewriting their claims", () => {
    const analysis = analyzeJobFit(profile, job);
    const plan = buildDeterministicTailoringPlan(profile, job, analysis);

    expect(plan.suggestions[0]).toMatchObject({
      sourceAchievementId: "achievement-1",
      originalText: profile.experiences[0].achievements[0].text,
      revisedText: profile.experiences[0].achievements[0].text,
      status: "pending",
    });
    expect(plan.suggestions[0].evidence).toBe("Repository and bench test logs");
  });
});
