import { describe, expect, it } from "vitest";
import { parseJobForm, parseProfileForm } from "./forms";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("parseJobForm", () => {
  it("normalizes an optional blank URL and validates the posting", () => {
    const result = parseJobForm(
      form({
        title: " Firmware Engineer ",
        company: " Signal Labs ",
        location: "Remote",
        workModel: "remote",
        url: "",
        description: "Build and test embedded firmware for connected products.",
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        title: "Firmware Engineer",
        company: "Signal Labs",
        url: undefined,
        source: "manual",
      });
    }
  });

  it("returns field errors for invalid input", () => {
    const result = parseJobForm(
      form({ title: "", company: "", workModel: "remote", description: "short" }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.title).toBeTruthy();
      expect(result.errors.company).toBeTruthy();
      expect(result.errors.description).toBeTruthy();
    }
  });

  it("rejects non-web posting URL schemes", () => {
    const result = parseJobForm(form({
      title: "Firmware Engineer",
      company: "Signal Labs",
      workModel: "remote",
      url: "javascript:alert(1)",
      description: "Build and test embedded firmware for connected products.",
    }));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.url).toBeTruthy();
  });
});

describe("parseProfileForm", () => {
  it("turns human-editable fields into a verified profile", () => {
    const result = parseProfileForm(
      form({
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        phone: "555-0100",
        location: "London",
        headline: "Embedded engineer",
        summary: "Builds reliable systems.",
        skills: "C++, RTOS\nPython",
        experiences: "Analytical Engines | Engineer | 2024-01 | present | London\n- Built a deterministic scheduler :: Design notes",
        projects: "Telemetry Node | https://example.com/node | 2023-01 | 2023-08\nLow-power sensor platform\n- Implemented SPI drivers",
        education: "University of London | BSc | Computing | 2020 | 2024\nFirst class honours",
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills.map((skill) => skill.name)).toEqual(["C++", "RTOS", "Python"]);
      expect(result.data.skills.every((skill) => skill.verified)).toBe(true);
      expect(result.data.experiences[0]).toMatchObject({
        organization: "Analytical Engines",
        role: "Engineer",
        endDate: null,
        achievements: [
          expect.objectContaining({ text: "Built a deterministic scheduler", evidence: "Design notes", verified: true }),
        ],
      });
      expect(result.data.projects[0]).toMatchObject({ name: "Telemetry Node" });
      expect(result.data.education[0]).toMatchObject({ institution: "University of London" });
    }
  });

  it("reports malformed structured entries instead of silently dropping them", () => {
    const result = parseProfileForm(
      form({
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        phone: "",
        location: "",
        headline: "",
        summary: "",
        skills: "C++",
        experiences: "missing separators",
        projects: "",
        education: "",
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.experiences?.[0]).toMatch(/format/i);
  });

  it("rejects non-bullet experience detail lines", () => {
    const result = parseProfileForm(form({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "",
      location: "",
      headline: "",
      summary: "",
      skills: "C++",
      experiences: "Engines | Engineer | 2024 | present | London\nThis would be silently reinterpreted",
      projects: "",
      education: "",
    }));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.experiences).toBeTruthy();
  });
});
