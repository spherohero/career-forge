import { describe, expect, it } from "vitest";
import { parseResumePrefill } from "./resume-prefill";

describe("resume prefill (unverified form values)", () => {
  it("extracts explicit contact and supported sections without attesting claims", () => {
    const draft = parseResumePrefill(`Example Candidate
Firmware Engineer
candidate@example.test | +1 (202) 555-0123 | Sample City, ST
https://github.com/example-candidate
Summary
Contributed to firmware testing.
Skills
C++, Python, Git, Python
Experience
Example Lab | Firmware Intern | 2025-05 | 2025-08 | Remote
- Tested SPI drivers.
Projects
Sensor demo | https://example.test/demo | 2025 | 2025
A classroom demo.
- Measured sensor readings.
Education
Example University | BS | Electrical Engineering | 2021 | 2025`);
    expect(draft).toMatchObject({fullName:"Example Candidate", email:"candidate@example.test",phone:"+1 (202) 555-0123",location:"Sample City, ST",headline:"Firmware Engineer",links:"https://github.com/example-candidate",summary:"Contributed to firmware testing.",skills:"C++\nPython\nGit"});
    expect(draft.experiences).toContain("Example Lab | Firmware Intern | 2025-05 | 2025-08 | Remote\n- Tested SPI drivers.");
    expect(draft.education).toContain("Example University | BS | Electrical Engineering | 2021 | 2025");
    expect(draft.projects).toContain("A classroom demo.");
    expect(JSON.stringify(draft)).not.toContain('"verified":true');
  });
  it("keeps paragraph-spaced DOCX evidence with its role", () => {
    const draft = parseResumePrefill("Example Candidate\n\nExperience\n\nExample Lab | Firmware Intern | 2025 | 2026 | Remote\n\n- Tested SPI drivers.\n\n- Built Python tests.");
    expect(draft.experiences).toContain("Remote\n- Tested SPI drivers.\n- Built Python tests.");
    expect(draft.warnings).toEqual([]);
  });
  it("leaves uncertain contact fields blank and retains ambiguous sections for manual correction", () => {
    const draft = parseResumePrefill("RESUME\nSkills\nPython\nExperience\nUnclear role description without an employer");
    expect(draft.fullName).toBe(""); expect(draft.email).toBe(""); expect(draft.location).toBe("");
    expect(draft.headline).toBe(""); expect(draft.experiences).toBe("");
    expect(draft.warnings.join(" ")).toMatch(/Experience/);
  });
});
