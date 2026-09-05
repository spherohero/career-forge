import { describe, expect, it, vi } from "vitest";
import { analyzeJobFit, type TailoringPlan } from "./analysis";
import type { Job, Profile } from "./domain";
import {
  generateGuardedTailoringPlan,
  OpenAICompatibleProvider,
  type TailoringProvider,
} from "./model";

const profile: Profile = {
  fullName: "Ada", email: "ada@example.com", phone: "", location: "", headline: "", summary: "",
  skills: [], projects: [], education: [], updatedAt: "2026-09-03T00:00:00.000Z",
  experiences: [{ id: "exp-1", organization: "Lab", role: "Engineer", location: "", startDate: "2024", endDate: null,
    achievements: [{ id: "achievement-1", text: "Built 3 C++ firmware test tools in 2025.", evidence: "repo", skills: ["C++"], verified: true }],
  }],
};
const job: Job = {
  id: "job-1", title: "Firmware Engineer", company: "Acme", location: "", workModel: "unknown", url: null,
  description: "Required qualifications:\n- Build C++ firmware test tools", source: "manual", salary: null, notes: null,
  status: "saved", createdAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z",
};
const analysis = analyzeJobFit(profile, job);
const response = (proposal: Record<string, unknown>) => JSON.stringify({ proposals: [proposal] });
const provider = (content: string | Error): TailoringProvider => ({
  generate: vi.fn(async () => { if (content instanceof Error) throw content; return content; }),
});

function expectDeterministic(plan: TailoringPlan, diagnostic: string) {
  expect(plan.mode).toBe("deterministic");
  expect(plan.suggestions[0].revisedText).toBe("Built 3 C++ firmware test tools in 2025.");
  expect(plan.diagnostic).toBe(diagnostic);
}

describe("generateGuardedTailoringPlan", () => {
  it("uses a meaning-preserving model wording revision while retaining server-owned provenance", async () => {
    const plan = await generateGuardedTailoringPlan(profile, job, analysis, {
      provider: provider(response({ sourceAchievementId: "achievement-1", revisedText: "Built 3 C++ firmware test tools in 2025", rationale: "Removes trailing punctuation." })),
    });
    expect(plan).toMatchObject({ mode: "ai", diagnostic: undefined });
    expect(plan.suggestions[0]).toMatchObject({ sourceAchievementId: "achievement-1", originalText: profile.experiences[0].achievements[0].text, revisedText: "Built 3 C++ firmware test tools in 2025", status: "pending" });
  });

  it("falls back completely when model configuration has no key", async () => {
    expectDeterministic(await generateGuardedTailoringPlan(profile, job, analysis, { env: { MODEL_BASE_URL: "https://model.example/v1", MODEL_NAME: "safe-model" } }), "model_not_configured");
  });

  it("fails closed on a fabricated metric", async () => {
    expectDeterministic(await generateGuardedTailoringPlan(profile, job, analysis, { provider: provider(response({ sourceAchievementId: "achievement-1", revisedText: "Built 30 C++ firmware test tools in 2025.", rationale: "Stronger." })) }), "proposal_validation_failed");
  });

  it("fails closed on an unknown source id", async () => {
    expectDeterministic(await generateGuardedTailoringPlan(profile, job, analysis, { provider: provider(response({ sourceAchievementId: "unknown", revisedText: "Built 3 C++ firmware test tools in 2025.", rationale: "Match." })) }), "proposal_validation_failed");
  });

  it("fails closed on an injected extra JSON field", async () => {
    expectDeterministic(await generateGuardedTailoringPlan(profile, job, analysis, { provider: provider(response({ sourceAchievementId: "achievement-1", revisedText: "Built 3 C++ firmware test tools in 2025.", rationale: "Match.", status: "accepted" })) }), "model_response_invalid");
  });

  it("fails closed on network or timeout errors", async () => {
    const network = new OpenAICompatibleProvider({ baseUrl: "https://model.example/v1", apiKey: "test-key", model: "test-model", fetch: vi.fn(async () => { throw new TypeError("offline"); }) });
    expectDeterministic(await generateGuardedTailoringPlan(profile, job, analysis, { provider: network }), "model_request_failed");
    const hangingFetch: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true });
    });
    const timeout = new OpenAICompatibleProvider({ baseUrl: "https://model.example/v1", apiKey: "test-key", model: "test-model", timeoutMs: 5, fetch: hangingFetch });
    expectDeterministic(await generateGuardedTailoringPlan(profile, job, analysis, { provider: timeout }), "model_request_failed");
  });

  it("fails closed on fabricated technology and stronger production ownership", async () => {
    expectDeterministic(await generateGuardedTailoringPlan(profile, job, analysis, { provider: provider(response({ sourceAchievementId: "achievement-1", revisedText: "Led production Rust delivery of 3 firmware test tools in 2025.", rationale: "Match." })) }), "proposal_validation_failed");
  });

  it("fails closed on arbitrary new claim vocabulary outside the source", async () => {
    expectDeterministic(await generateGuardedTailoringPlan(profile, job, analysis, { provider: provider(response({ sourceAchievementId: "achievement-1", revisedText: "Managed and patented 3 Elixir firmware test tools in 2025.", rationale: "Match." })) }), "proposal_validation_failed");
  });

  it("fails closed when a rewrite deletes a negation or other claim word", async () => {
    const negatedProfile: Profile = {
      ...profile,
      experiences: [{ ...profile.experiences[0], achievements: [{ ...profile.experiences[0].achievements[0], text: "Never owned production deployment for 3 C++ tools in 2025." }] }],
    };
    const negatedAnalysis = analyzeJobFit(negatedProfile, job);
    const plan = await generateGuardedTailoringPlan(negatedProfile, job, negatedAnalysis, {
      provider: provider(response({ sourceAchievementId: "achievement-1", revisedText: "Owned production deployment for 3 C++ tools in 2025.", rationale: "Match." })),
    });
    expect(plan).toMatchObject({ mode: "deterministic", diagnostic: "proposal_validation_failed" });
    expect(plan.suggestions[0].revisedText).toBe("Never owned production deployment for 3 C++ tools in 2025.");
  });

  it("fails closed when identical words are reassociated into a different claim", async () => {
    const reassociationProfile: Profile = {
      ...profile,
      experiences: [{
        ...profile.experiences[0],
        achievements: [{
          ...profile.experiences[0].achievements[0],
          text: "Built safe firmware, not unsafe tools.",
          skills: [],
        }],
      }],
    };
    const reassociationJob: Job = {
      ...job,
      description: "Required qualifications:\n- Build safe firmware tools",
    };
    const reassociationAnalysis = analyzeJobFit(reassociationProfile, reassociationJob);
    const plan = await generateGuardedTailoringPlan(
      reassociationProfile,
      reassociationJob,
      reassociationAnalysis,
      {
        provider: provider(response({
          sourceAchievementId: "achievement-1",
          revisedText: "Built unsafe firmware, not safe tools.",
          rationale: "Reordered wording.",
        })),
      },
    );

    expect(plan).toMatchObject({
      mode: "deterministic",
      diagnostic: "proposal_validation_failed",
    });
    expect(plan.suggestions[0].revisedText).toBe(
      "Built safe firmware, not unsafe tools.",
    );
  });

  it("treats language and rating suffixes as meaningful claim content", async () => {
    const symbolProfile: Profile = {
      ...profile,
      experiences: [{
        ...profile.experiences[0],
        achievements: [{
          ...profile.experiences[0].achievements[0],
          text: "Built C# services with an A+ reliability rating.",
          skills: ["C#"],
        }],
      }],
    };
    const symbolJob: Job = {
      ...job,
      description: "Required qualifications:\n- Build reliable services",
    };
    const symbolAnalysis = analyzeJobFit(symbolProfile, symbolJob);
    const plan = await generateGuardedTailoringPlan(
      symbolProfile,
      symbolJob,
      symbolAnalysis,
      {
        provider: provider(response({
          sourceAchievementId: "achievement-1",
          revisedText: "Built C services with an A reliability rating.",
          rationale: "Simplified wording.",
        })),
      },
    );

    expect(plan).toMatchObject({
      mode: "deterministic",
      diagnostic: "proposal_validation_failed",
    });
  });

  it("preserves relational words that determine claim direction", async () => {
    const directionalProfile: Profile = {
      ...profile,
      experiences: [{
        ...profile.experiences[0],
        achievements: [{
          ...profile.experiences[0].achievements[0],
          text: "Migrated data from AWS to Azure.",
          skills: ["AWS", "Azure"],
        }],
      }],
    };
    const directionalJob: Job = {
      ...job,
      description: "Required qualifications:\n- Move data from AWS to Azure",
    };
    const directionalAnalysis = analyzeJobFit(directionalProfile, directionalJob);
    const plan = await generateGuardedTailoringPlan(
      directionalProfile,
      directionalJob,
      directionalAnalysis,
      {
        provider: provider(response({
          sourceAchievementId: "achievement-1",
          revisedText: "Migrated data to AWS from Azure.",
          rationale: "Reordered wording.",
        })),
      },
    );

    expect(plan).toMatchObject({
      mode: "deterministic",
      diagnostic: "proposal_validation_failed",
    });
  });

  it("preserves internal punctuation that determines attribution", async () => {
    const attributionProfile: Profile = {
      ...profile,
      experiences: [{
        ...profile.experiences[0],
        achievements: [{
          ...profile.experiences[0].achievements[0],
          text: 'The manager said, "I built C++ tools."',
          skills: ["C++"],
        }],
      }],
    };
    const attributionJob: Job = {
      ...job,
      description: "Required qualifications:\n- Build C++ tools",
    };
    const attributionAnalysis = analyzeJobFit(attributionProfile, attributionJob);
    const plan = await generateGuardedTailoringPlan(
      attributionProfile,
      attributionJob,
      attributionAnalysis,
      {
        provider: provider(response({
          sourceAchievementId: "achievement-1",
          revisedText: "The manager said I built C++ tools.",
          rationale: "Removed punctuation.",
        })),
      },
    );

    expect(plan).toMatchObject({
      mode: "deterministic",
      diagnostic: "proposal_validation_failed",
    });
  });
});

describe("OpenAICompatibleProvider URL policy", () => {
  it.each([
    ["//169.254.169.254/v1", "//169.254.169.254/v1"],
    ["//[fe80::1]/v1", "//[fe80::1]/v1"],
    ["//[::ffff:169.254.169.254]/v1", "//[::ffff:169.254.169.254]/v1"],
    ["//foreign.example:8443/v1", "//foreign.example:8443/v1"],
    ["//192.0.2.1/v1", "//192.0.2.1/v1"],
    ["//[2001:db8::1]/v1", "//[2001:db8::1]/v1"],
    ["///foreign.example/v1", "///foreign.example/v1"],
    [String.raw`/\169.254.169.254/v1`, "//169.254.169.254/v1"],
    [String.raw`\\[fe80::1]/v1`, "//[fe80::1]/v1"],
    [String.raw`/\[::ffff:169.254.169.254]/v1`, "//[::ffff:169.254.169.254]/v1"],
    [String.raw`\\foreign.example/v1`, "//foreign.example/v1"],
    ["/root/..//foreign.example/v1", "//foreign.example/v1"],
    ["//user:pass@foreign.example/v1", "//user:pass@foreign.example/v1"],
  ])("keeps authority-like path %s on the configured origin during generate", async (path, normalizedPath) => {
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    })));
    const adapter = new OpenAICompatibleProvider({
      baseUrl: `https://model.example:9443${path}`, apiKey: "test-key", model: "m", fetch: request,
    });

    await expect(adapter.generate({ achievements: [], requirements: [] })).resolves.toBe("ok");

    expect(request).toHaveBeenCalledTimes(1);
    const [input, init] = request.mock.calls[0];
    const endpoint = new URL(String(input));
    expect(endpoint.origin).toBe("https://model.example:9443");
    expect(endpoint.href).toBe(`https://model.example:9443${normalizedPath}/chat/completions`);
    expect(endpoint.username).toBe("");
    expect(endpoint.password).toBe("");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
  });

  it.each([
    ["https://model.example", "https://model.example/chat/completions"],
    ["https://model.example/api/v1/", "https://model.example/api/v1/chat/completions"],
    ["https://model.example/api/%2F/v1?version=1#fragment", "https://model.example/api/%2F/v1/chat/completions"],
    ["http://localhost:8080/api/v1?version=1", "http://localhost:8080/api/v1/chat/completions"],
  ])("preserves existing base path and query handling for %s", async (baseUrl, expected) => {
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    })));
    const adapter = new OpenAICompatibleProvider({
      baseUrl, apiKey: "test-key", model: "m", allowInsecureLocal: true, fetch: request,
    });
    await adapter.generate({ achievements: [], requirements: [] });
    expect(String(request.mock.calls[0][0])).toBe(expected);
  });

  it.each([
    ["https://169.254.169.254/v1/chat/completions", /link-local/i],
    ["https://[fe80::1]/v1/chat/completions", /link-local/i],
    ["https://[::ffff:169.254.169.254]/v1/chat/completions", /link-local/i],
    ["https://user:pass@model.example/v1/chat/completions", /credentials/i],
    ["http://model.example/v1/chat/completions", /HTTPS/i],
    ["https://foreign.example/v1/chat/completions", /origin/i],
    ["https://model.example:8443/v1/chat/completions", /origin/i],
  ])("validates the final constructed destination %s before fetch", async (destination, error) => {
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    })));
    const adapter = new OpenAICompatibleProvider({
      baseUrl: "https://model.example/v1", apiKey: "test-key", model: "m", fetch: request,
    });
    // Fault-inject endpoint construction to exercise the independent final-URL guard.
    // Normal URL setters cannot change origin; the preceding tests cover real inputs.
    const setter = vi.spyOn(URL.prototype, "pathname", "set").mockImplementationOnce(function (this: URL) {
      this.href = destination;
    });
    try {
      await expect(adapter.generate({ achievements: [], requirements: [] })).rejects.toThrow(error);
      expect(request).not.toHaveBeenCalled();
    } finally {
      setter.mockRestore();
    }
  });

  describe.each(["http", "https"])("%s link-local policy", (protocol) => {
    it.each([
      "169.254.0.0", "169.254.169.254", "169.254.255.255",
      "0xa9fea9fe", "2852039166", "0251.0376.0251.0376", "169.254.43518",
    ])("rejects IPv4 link-local literal %s before any request", (hostname) => {
      const request = vi.fn<typeof fetch>();
      for (const allowInsecureLocal of [true, false]) {
        expect(() => new OpenAICompatibleProvider({
          baseUrl: `${protocol}://${hostname}/v1`, apiKey: "test-key", model: "m",
          allowInsecureLocal, fetch: request,
        })).toThrow(/link-local/i);
      }
      expect(request).not.toHaveBeenCalled();
    });
    it.each([
      "[fe80::]", "[fe80::1]", "[fe90::1]", "[fea0::1]",
      "[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]", "[FE80:0000:0000:0000:0000:0000:0000:0001]",
    ])("rejects IPv6 link-local literal %s before any request", (hostname) => {
      const request = vi.fn<typeof fetch>();
      for (const allowInsecureLocal of [true, false]) {
        expect(() => new OpenAICompatibleProvider({
          baseUrl: `${protocol}://${hostname}/v1`, apiKey: "test-key", model: "m",
          allowInsecureLocal, fetch: request,
        })).toThrow(/link-local/i);
      }
      expect(request).not.toHaveBeenCalled();
    });
    it.each([
      "[::ffff:169.254.0.0]", "[::ffff:169.254.169.254]", "[::ffff:a9fe:ffff]",
      "[0:0:0:0:0:FFFF:A9FE:A9FE]",
    ])("rejects mapped IPv4 link-local literal %s before any request", (hostname) => {
      const request = vi.fn<typeof fetch>();
      for (const allowInsecureLocal of [true, false]) {
        expect(() => new OpenAICompatibleProvider({
          baseUrl: `${protocol}://${hostname}/v1`, apiKey: "test-key", model: "m",
          allowInsecureLocal, fetch: request,
        })).toThrow(/link-local/i);
      }
      expect(request).not.toHaveBeenCalled();
    });
  });

  it.each([
    "model.example", "169.254.model.example", "169.253.255.255", "169.255.0.0",
    "[fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff]", "[fec0::]",
    "[::ffff:169.253.255.255]", "[::ffff:169.255.0.0]", "[2001:db8::1]",
  ])("preserves HTTPS for non-link-local hostname %s", (hostname) => {
    expect(() => new OpenAICompatibleProvider({
      baseUrl: `https://${hostname}/v1`, apiKey: "test-key", model: "m", fetch: vi.fn<typeof fetch>(),
    })).not.toThrow();
  });

  it.each([
    "localhost", "model.localhost", "127.0.0.1", "127.1", "[::1]",
    "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "100.64.0.1", "100.127.255.255", "[fc00::1]", "[fdff::1]",
  ])("preserves opted-in local HTTP and HTTPS for %s", (hostname) => {
    const options = { apiKey: "test-key", model: "m", fetch: vi.fn<typeof fetch>() };
    expect(() => new OpenAICompatibleProvider({ ...options, baseUrl: `http://${hostname}/v1` })).toThrow(/HTTPS/i);
    expect(() => new OpenAICompatibleProvider({ ...options, baseUrl: `http://${hostname}/v1`, allowInsecureLocal: true })).not.toThrow();
    expect(() => new OpenAICompatibleProvider({ ...options, baseUrl: `https://${hostname}/v1` })).not.toThrow();
  });

  it.each(["http://user:pass@localhost/v1", "https://user:pass@model.example/v1", "https://user@169.254.169.254/v1"])("still rejects credential URL %s", (baseUrl) => {
    expect(() => new OpenAICompatibleProvider({
      baseUrl, apiKey: "test-key", model: "m", allowInsecureLocal: true, fetch: vi.fn<typeof fetch>(),
    })).toThrow(/credentials/i);
  });

  it("rejects public HTTP and permits explicitly enabled private HTTP", () => {
    expect(() => new OpenAICompatibleProvider({ baseUrl: "http://model.example/v1", apiKey: "x", model: "m", allowInsecureLocal: true })).toThrow(/HTTPS/i);
    expect(() => new OpenAICompatibleProvider({ baseUrl: "http://100.100.10.2/v1", apiKey: "x", model: "m", allowInsecureLocal: true })).not.toThrow();
  });

  it("disables redirects so transport and origin policy cannot be bypassed", async () => {
    let redirect: RequestRedirect | undefined;
    const request: typeof fetch = async (_input, init) => {
      redirect = init?.redirect;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"proposals\":[]}" } }] }), { status: 200 });
    };
    const adapter = new OpenAICompatibleProvider({ baseUrl: "https://model.example/v1", apiKey: "x", model: "m", fetch: request });
    await adapter.generate({ achievements: [], requirements: [] });
    expect(redirect).toBe("error");
  });
});
