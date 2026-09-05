import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CareerRepository } from "./repository";

let repository: CareerRepository;

beforeEach(() => {
  repository = CareerRepository.inMemory();
});

afterEach(() => {
  repository.close();
});

describe("CareerRepository jobs", () => {
  it("creates and retrieves a job workspace", () => {
    const created = repository.createJob({
      title: "Embedded Software Intern",
      company: "Acme Avionics",
      location: "Example City",
      workModel: "hybrid",
      url: "https://example.test/jobs/embedded-intern",
      description: "Develop C firmware and test SPI device drivers.",
      source: "manual",
    });

    expect(repository.getJob(created.id)).toMatchObject({
      title: "Embedded Software Intern",
      company: "Acme Avionics",
      status: "saved",
      workModel: "hybrid",
    });
    expect(repository.listJobs()).toHaveLength(1);
  });

  it("records each application status transition", () => {
    const job = repository.createJob({
      title: "Firmware Engineer",
      company: "Signal Labs",
      location: "Remote",
      workModel: "remote",
      description: "Build production firmware in C++.",
      source: "manual",
    });

    repository.updateJobStatus(job.id, "tailoring", "Started resume review");
    repository.updateJobStatus(job.id, "applied", "Submitted on company site");

    expect(repository.getJob(job.id)?.status).toBe("applied");
    expect(repository.listApplicationEvents(job.id)).toEqual([
      expect.objectContaining({
        fromStatus: "saved",
        toStatus: "tailoring",
        note: "Started resume review",
      }),
      expect.objectContaining({
        fromStatus: "tailoring",
        toStatus: "applied",
        note: "Submitted on company site",
      }),
    ]);
  });

  it("returns null instead of mutating a missing job", () => {
    expect(repository.updateJobStatus("missing", "applied")).toBeNull();
  });
});

describe("CareerRepository profile", () => {
  it("stores verified resume facts with stable provenance ids", () => {
    const saved = repository.saveProfile({
      fullName: "Example Candidate",
      email: "candidate@example.test",
      phone: "",
      location: "Example City",
      headline: "Computer Engineering Student",
      summary: "Embedded systems and low-level software engineer.",
      skills: [
        { name: "C++", category: "Languages" },
        { name: "FreeRTOS", category: "Embedded" },
      ],
      experiences: [
        {
          organization: "Example Transit Project",
          role: "Electrical Harness Engineer",
          location: "Example City",
          startDate: "2025-08",
          endDate: null,
          achievements: [
            {
              text: "Designed and documented a vehicle electrical harness.",
              evidence: "Example Transit Project project documentation",
              skills: ["wiring", "documentation"],
            },
          ],
        },
      ],
      projects: [],
      education: [],
    });

    const loaded = repository.getProfile();

    expect(loaded).toEqual(saved);
    expect(loaded?.skills[0]).toMatchObject({
      name: "C++",
      verified: true,
    });
    expect(loaded?.experiences[0].id).toBeTruthy();
    expect(loaded?.experiences[0].achievements[0]).toMatchObject({
      text: "Designed and documented a vehicle electrical harness.",
      verified: true,
    });
    expect(loaded?.experiences[0].achievements[0].id).toBeTruthy();
  });

  it("preserves provenance ids when the structured profile is saved again", () => {
    const input = {
      fullName: "Example Engineer",
      email: "engineer@example.test",
      phone: "",
      location: "Example City",
      headline: "Engineer",
      summary: "Verified profile.",
      skills: [{ name: "C++", category: "General", verified: true }],
      experiences: [{
        organization: "Engines",
        role: "Engineer",
        location: "Example City",
        startDate: "2024",
        endDate: null,
        achievements: [{ text: "Built firmware.", evidence: "Repository", skills: [], verified: true }],
      }],
      projects: [],
      education: [],
    };
    const first = repository.saveProfile(input);
    const second = repository.saveProfile(input);

    expect(second.skills[0].id).toBe(first.skills[0].id);
    expect(second.experiences[0].id).toBe(first.experiences[0].id);
    expect(second.experiences[0].achievements[0].id).toBe(first.experiences[0].achievements[0].id);
  });
});

describe("CareerRepository resume imports", () => {
  it("stores unverified extracted text separately for review and returns the latest import", () => {
    const first = repository.createResumeImport({
      originalFilename: "resume.txt",
      mediaType: "text/plain",
      extractedText: "Unverified first draft",
    });
    const latest = repository.createResumeImport({
      originalFilename: "new-resume.pdf",
      mediaType: "application/pdf",
      extractedText: "Unverified latest draft",
    });

    expect(first.status).toBe("pending_review");
    expect(repository.getResumeImport(first.id)).toEqual(first);
    expect(repository.getLatestResumeImport()).toEqual(latest);
    expect(repository.getProfile()).toBeNull();
  });
});

describe("CareerRepository resume versions", () => {
  it("does not review a resume version through a different job", () => {
    const first = repository.createJob({
      title: "Firmware Engineer",
      company: "Signal Labs",
      location: "Remote",
      workModel: "remote",
      description: "Build production firmware in C++.",
      source: "manual",
    });
    const second = repository.createJob({
      title: "Systems Engineer",
      company: "Other Labs",
      location: "Remote",
      workModel: "remote",
      description: "Build reliable embedded systems and tooling.",
      source: "manual",
    });
    const version = repository.createResumeVersion(first.id, {
      jobId: first.id,
      mode: "deterministic",
      createdAt: "2026-09-03T00:00:00.000Z",
      suggestions: [{
        id: "suggestion-1",
        sourceAchievementId: "achievement-1",
        originalText: "Built firmware.",
        revisedText: "Built firmware.",
        rationale: "Relevant evidence.",
        matchedRequirementIds: [],
        evidence: null,
        status: "pending",
      }],
    });

    expect(
      repository.updateSuggestionStatusForJob(second.id, version.id, "suggestion-1", "accepted"),
    ).toBeNull();
    expect(repository.getLatestResumeVersion(first.id)?.suggestions[0].status).toBe("pending");
  });

  it("persists a per-job tailoring plan and review decisions", () => {
    const job = repository.createJob({
      title: "Embedded Software Intern",
      company: "Acme Avionics",
      location: "Example City",
      workModel: "hybrid",
      description: "Implement and test C++ firmware for embedded products.",
      source: "manual",
    });
    const version = repository.createResumeVersion(job.id, {
      jobId: job.id,
      mode: "deterministic",
      createdAt: "2026-09-03T00:00:00.000Z",
      suggestions: [
        {
          id: "suggestion-1",
          sourceAchievementId: "achievement-1",
          originalText: "Implemented C++ firmware for SPI sensors.",
          revisedText: "Implemented C++ firmware for SPI sensors.",
          rationale: "Supports the firmware requirement.",
          matchedRequirementIds: ["requirement-1"],
          evidence: "Repository",
          status: "pending",
        },
      ],
    });

    expect(repository.getLatestResumeVersion(job.id)).toMatchObject({
      id: version.id,
      jobId: job.id,
      suggestions: [expect.objectContaining({ status: "pending" })],
    });

    repository.updateSuggestionStatus(version.id, "suggestion-1", "accepted");

    expect(repository.getLatestResumeVersion(job.id)?.suggestions[0].status).toBe(
      "accepted",
    );
    expect(repository.getResumeVersion(version.id)?.id).toBe(version.id);
  });
});

describe("CareerRepository AI credentials", () => {
  it("canonicalizes identity and preserves the caller-generated device-flow id", () => {
    const flowId = "11111111-1111-4111-8111-111111111111";
    const connection = repository.upsertAiConnection({
      identity: "  CAFE\u0301@Example.TEST ",
      provider: "openai-codex",
      credentialCiphertext: "encrypted-credential",
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T12:00:00.000Z",
      status: "connected",
    });
    const flow = repository.createAiDeviceFlow({
      id: flowId,
      identity: " CAFE\u0301@Example.TEST ",
      provider: "openai-codex",
      stateCiphertext: "encrypted-flow",
      expiresAt: "2026-09-04T12:00:00.000Z",
    });

    expect(connection.identity).toBe("caf\u00e9@example.test");
    expect(flow.id).toBe(flowId);
    expect(repository.getAiConnection("CAF\u00c9@EXAMPLE.TEST")?.identity).toBe(
      "caf\u00e9@example.test",
    );
    expect(repository.getAiDeviceFlow(flow.id, "caf\u00e9@example.test")?.identity).toBe(
      "caf\u00e9@example.test",
    );
  });

  it("scopes encrypted Codex connections to the authenticated identity", () => {
    const connection = repository.upsertAiConnection({
      identity: "owner@example.test",
      provider: "openai-codex",
      credentialCiphertext: "encrypted-credential",
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T12:00:00.000Z",
      status: "connected",
    });

    expect(repository.getAiConnection("owner@example.test")).toEqual(connection);
    expect(repository.getAiConnection("other-user@example.test")).toBeNull();
    expect(repository.updateAiConnectionModel("other-user@example.test", "gpt-5.6-sol-pro")).toBeNull();
    expect(repository.updateAiConnectionModel("owner@example.test", "gpt-5.6-sol-pro")?.model).toBe(
      "gpt-5.6-sol-pro",
    );
    expect(repository.deleteAiConnection("other-user@example.test")).toBe(false);
    expect(repository.deleteAiConnection("owner@example.test")).toBe(true);
    expect(repository.getAiConnection("owner@example.test")).toBeNull();
  });

  it("prevents one identity from completing another identity's device flow", () => {
    const flow = repository.createAiDeviceFlow({
      id: "22222222-2222-4222-8222-222222222222",
      identity: "owner@example.test",
      provider: "openai-codex",
      stateCiphertext: "encrypted-device-state",
      expiresAt: "2026-09-04T12:00:00.000Z",
    });

    expect(repository.getAiDeviceFlow(flow.id, "other-user@example.test")).toBeNull();
    expect(repository.getAiDeviceFlow(flow.id, "owner@example.test")).toEqual(flow);
    expect(repository.deleteAiDeviceFlow(flow.id, "other-user@example.test")).toBe(false);
    expect(repository.deleteAiDeviceFlow(flow.id, "owner@example.test")).toBe(true);
    expect(repository.getAiDeviceFlow(flow.id, "owner@example.test")).toBeNull();
  });

  it("consumes an exact device-flow state and upserts its connection atomically", () => {
    const flow = repository.createAiDeviceFlow({
      id: "33333333-3333-4333-8333-333333333333",
      identity: "owner@example.test",
      provider: "openai-codex",
      stateCiphertext: "expected-encrypted-state",
      expiresAt: "2026-09-04T12:00:00.000Z",
    });
    const connection = {
      provider: "openai-codex" as const,
      credentialCiphertext: "encrypted-credential",
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T13:00:00.000Z",
      status: "connected" as const,
    };

    expect(repository.consumeAiDeviceFlowAndUpsertConnection({
      flowId: flow.id,
      identity: "owner@example.test",
      expectedStateCiphertext: "stale-encrypted-state",
      connection,
    })).toBeNull();
    expect(repository.getAiConnection("owner@example.test")).toBeNull();
    expect(repository.getAiDeviceFlow(flow.id, "owner@example.test")).toEqual(flow);

    expect(repository.consumeAiDeviceFlowAndUpsertConnection({
      flowId: flow.id,
      identity: "owner@example.test",
      expectedStateCiphertext: "expected-encrypted-state",
      connection,
    })).toMatchObject({ identity: "owner@example.test", credentialCiphertext: "encrypted-credential" });
    expect(repository.getAiDeviceFlow(flow.id, "owner@example.test")).toBeNull();
  });

  it("disconnects a connection and all of its active device flows atomically", () => {
    repository.upsertAiConnection({
      identity: "owner@example.test",
      provider: "openai-codex",
      credentialCiphertext: "encrypted-credential",
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T13:00:00.000Z",
      status: "connected",
    });
    const flow = repository.createAiDeviceFlow({
      id: "44444444-4444-4444-8444-444444444444",
      identity: "owner@example.test",
      provider: "openai-codex",
      stateCiphertext: "encrypted-state",
      expiresAt: "2026-09-04T12:00:00.000Z",
    });

    expect(repository.deleteAiConnectionAndDeviceFlows("owner@example.test")).toBe(true);
    expect(repository.getAiConnection("owner@example.test")).toBeNull();
    expect(repository.getAiDeviceFlow(flow.id, "owner@example.test")).toBeNull();
  });
});
