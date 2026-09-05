// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeJobFit, buildDeterministicTailoringPlan } from "@/lib/analysis";
import type { Job, Profile } from "@/lib/domain";
import { CareerRepository } from "@/server/repository";
import { generatePlanAction } from "./actions";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(), revalidate: vi.fn(), repository: vi.fn(),
  runtime: vi.fn(), status: vi.fn(), getProvider: vi.fn(), request: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/server/database", () => ({ getRepository: mocks.repository }));
vi.mock("@/server/codex-runtime", () => ({
  getCodexConnectionService: mocks.runtime, getCodexRuntimeStatus: mocks.status,
}));

let repository: CareerRepository;
let job: Job;
let profile: Profile;
function form(jobId = job.id) {
  const data = new FormData();
  data.set("jobId", jobId);
  data.set("identity", "bob");
  data.set("remote-user", "bob");
  return data;
}
function proposal() {
  const achievement = profile.experiences[0].achievements[0];
  return JSON.stringify({ proposals: [{
    sourceAchievementId: achievement.id,
    revisedText: achievement.text.replace(/\.$/, ""),
    rationale: "Presentation cleanup from Alice's provider.",
  }] });
}
function expectNoProviderWork() {
  expect(mocks.status).not.toHaveBeenCalled();
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.getProvider).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
  expect(repository.getLatestResumeVersion(job.id)).toBeNull();
}

function expectPersistedFallback(diagnostic = "model_not_configured") {
  const expected = buildDeterministicTailoringPlan(profile, job, analyzeJobFit(profile, job));
  expect(expected.suggestions.length).toBeGreaterThan(0);
  const persisted = repository.getLatestResumeVersion(job.id)!;
  expect(persisted).not.toBeNull();
  const { id, name, updatedAt, ...plan } = persisted;
  expect(id).toBeTruthy();
  expect(name).toBeTruthy();
  expect(updatedAt).toBe(expected.createdAt);
  expect(plan).toEqual({ ...expected, diagnostic });
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith(`/jobs/${job.id}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
  vi.stubEnv("AUTH_MODE", "authelia");
  vi.stubEnv("AUTH_ALLOWED_GROUPS", "admins");
  vi.stubEnv("AUTH_ALLOWED_USERS", "");
  vi.stubEnv("MODEL_BASE_URL", "https://admin-model.example/v1");
  vi.stubEnv("MODEL_API_KEY", "synthetic-test-key");
  vi.stubEnv("MODEL_NAME", "synthetic-model");
  vi.stubGlobal("fetch", mocks.request);
  mocks.request.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"proposals":[]}' } }] })));
  mocks.headers.mockResolvedValue(new Headers({ "remote-user": " ALICE ", "remote-groups": "admins" }));
  mocks.status.mockReturnValue({ available: true });
  mocks.runtime.mockReturnValue({ getProvider: mocks.getProvider });
  mocks.getProvider.mockResolvedValue(null);
  repository = CareerRepository.inMemory();
  mocks.repository.mockReturnValue(repository);
  job = repository.createJob({ title: "Firmware Engineer", company: "Example Lab", description: "Required qualifications:\n- Build C++ firmware test tools" });
  profile = repository.saveProfile({
    fullName: "Example Candidate", email: "candidate@example.com", skills: [], projects: [], education: [],
    experiences: [{ organization: "Example Lab", role: "Engineer", achievements: [
      { text: "Built 3 C++ firmware test tools in 2025.", skills: ["C++"], evidence: "Synthetic repository", verified: true },
      { text: "Tested C++ firmware tools.", skills: ["C++"], evidence: "Synthetic report", verified: true },
    ] }],
  });
});
afterEach(() => {
  repository.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generatePlanAction provider boundary", () => {
  it.each(["missing identity", "insufficient group"])("denies %s at the real authorization boundary before any provider work", async (reason) => {
    mocks.headers.mockResolvedValue(reason === "missing identity" ? new Headers() : new Headers({ "remote-user": "alice", "remote-groups": "guests" }));
    await expect(generatePlanAction(form())).rejects.toThrow("Unauthorized mutation request.");
    expect(mocks.repository).not.toHaveBeenCalled();
    expectNoProviderWork();
  });

  it.each(["invalid input", "missing job", "missing profile"])("rejects %s before provider resolution", async (reason) => {
    if (reason === "missing profile") vi.spyOn(repository, "getProfile").mockReturnValue(null);
    const data = form(reason === "invalid input" ? "not-a-uuid" : reason === "missing job" ? "11111111-1111-4111-8111-111111111111" : job.id);
    await expect(generatePlanAction(data)).rejects.toThrow(reason === "invalid input" ? "Invalid job." : reason === "missing job" ? "Job not found." : "A verified profile is required.");
    expectNoProviderWork();
  });

  it("fails closed if runtime status lookup itself throws", async () => {
    mocks.status.mockImplementation(() => { throw new Error("synthetic status failure"); });
    await generatePlanAction(form());
    expectPersistedFallback();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked OAuth", new Error("synthetic revoked credential"), "model_request_failed"],
    ["expired OAuth", new Error("synthetic expired credential"), "model_request_failed"],
    ["network failure", new TypeError("synthetic offline"), "model_request_failed"],
    ["malformed SSE rejection", new Error("synthetic protocol failure"), "model_request_failed"],
    ["malformed JSON", "{broken", "model_response_invalid"],
    ["schema rejection", '{"proposals":[],"unexpected":true}', "model_response_invalid"],
  ])("persists the complete deterministic plan on provider %s", async (_name, result, diagnostic) => {
    const generate = vi.fn(async () => { if (result instanceof Error) throw result; return result; });
    mocks.getProvider.mockResolvedValue({ generate });
    await generatePlanAction(form());
    expect(generate).toHaveBeenCalledOnce();
    expectPersistedFallback(diagnostic as string);
  });

  it("discards even earlier valid proposals when a later claim is rejected", async () => {
    const achievements = profile.experiences[0].achievements;
    mocks.getProvider.mockResolvedValue({ generate: async () => JSON.stringify({ proposals: [
      { sourceAchievementId: achievements[0].id, revisedText: achievements[0].text.replace(/\.$/, ""), rationale: "Valid cleanup." },
      { sourceAchievementId: achievements[1].id, revisedText: "Led production Rust delivery.", rationale: "Fabricated claim." },
    ] }) });
    await generatePlanAction(form());
    expectPersistedFallback("proposal_validation_failed");
  });

  it("preserves administrator environment selection only when runtime status explicitly says disabled", async () => {
    mocks.status.mockReturnValue({ available: false, reason: "disabled" });
    await generatePlanAction(form());
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.getProvider).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(String(mocks.request.mock.calls[0][0])).toBe("https://admin-model.example/v1/chat/completions");
    expect(repository.getLatestResumeVersion(job.id)?.mode).toBe("ai");
  });

  it.each(["factory", "service"])("persists deterministic output when the %s throws", async (failure) => {
    if (failure === "factory") mocks.runtime.mockImplementation(() => { throw new Error("synthetic factory failure"); });
    else mocks.getProvider.mockRejectedValue(new Error("synthetic lookup failure"));
    await generatePlanAction(form());
    expectPersistedFallback();
  });
  it.each(["null service", "null provider", "misconfigured"])("persists the complete deterministic plan without environment fallthrough for %s", async (failure) => {
    if (failure === "null service") mocks.runtime.mockReturnValue(null);
    if (failure === "misconfigured") {
      mocks.status.mockReturnValue({ available: false, reason: "misconfigured" });
      mocks.runtime.mockReturnValue(null);
    }
    await generatePlanAction(form());
    expectPersistedFallback();
  });

  it("uses only the canonical authenticated header owner's provider, ignoring submitted identity", async () => {
    const ownProvider = { generate: vi.fn(async () => proposal()) };
    const otherProvider = { generate: vi.fn(async () => proposal()) };
    mocks.getProvider.mockImplementation(async (identity: string) => identity === "alice" ? ownProvider : otherProvider);
    await generatePlanAction(form());
    expect(mocks.getProvider).toHaveBeenCalledExactlyOnceWith("alice");
    expect(ownProvider.generate).toHaveBeenCalledOnce();
    expect(otherProvider.generate).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(repository.getLatestResumeVersion(job.id)).toMatchObject({ mode: "ai", suggestions: [{ rationale: "Presentation cleanup from Alice's provider." }, {}] });
  });
});
