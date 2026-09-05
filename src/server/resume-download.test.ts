import { describe, expect, it } from "vitest";
import { CareerRepository } from "./repository";
import { prepareResumeDownload } from "./resume-download";

function seed(repository: CareerRepository) {
  const profile = repository.saveProfile({ fullName: "Ada Lovelace", email: "ada@example.com", phone: "", location: "London", headline: "Engineer", summary: "",
    skills: [], projects: [], education: [], experiences: [{ organization: "Lab", role: "Engineer", location: "", startDate: "2024", endDate: null,
      achievements: [{ text: "Built firmware.", evidence: null, skills: [], verified: true }] }],
  });
  const job = repository.createJob({ title: "Engineer", company: "Acme / Labs", location: "", workModel: "unknown", description: "Build reliable firmware systems.", source: "manual" });
  const version = repository.createResumeVersion(job.id, { jobId: job.id, mode: "deterministic", createdAt: new Date().toISOString(), suggestions: [] });
  return { profile, job, version };
}

describe("prepareResumeDownload", () => {
  it("re-authorizes request headers and returns no-store attachment metadata", async () => {
    const repository = CareerRepository.inMemory();
    const { version } = seed(repository);
    const auth = { mode: "authelia" as const, allowedGroups: ["admins"], allowedUsers: [] };
    const denied = await prepareResumeDownload(new Request("http://localhost"), version.id, "pdf", repository, auth);
    const allowed = await prepareResumeDownload(new Request("http://localhost", { headers: { "remote-user": "ada", "remote-groups": "admins" } }), version.id, "docx", repository, auth);
    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(allowed.headers.get("content-disposition")).toMatch(/^attachment; filename="Ada-Lovelace-Acme-Labs-Engineer\.docx"$/);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
    expect((await allowed.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    repository.close();
  });

  it("validates UUID and requires the version, job, and profile", async () => {
    const repository = CareerRepository.inMemory();
    const auth = { mode: "disabled" as const, allowedGroups: [], allowedUsers: [] };
    expect((await prepareResumeDownload(new Request("http://localhost"), "not-a-uuid", "pdf", repository, auth)).status).toBe(400);
    expect((await prepareResumeDownload(new Request("http://localhost"), "00000000-0000-4000-8000-000000000000", "pdf", repository, auth)).status).toBe(404);
    repository.close();
  });
});
