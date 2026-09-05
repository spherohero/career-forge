import { describe, expect, it, vi } from "vitest";
import type { TailoringProvider } from "@/lib/model";
import { CodexOAuthError } from "./codex-client";
import { CodexConnectionService } from "./codex-connection";
import { CareerRepository } from "./repository";
import { createCredentialBox } from "./secret-box";

const key = Buffer.alloc(32, 9).toString("base64");
const box = createCredentialBox(key);

function authorizedClient(expiresInSeconds = 3600) {
  return {
    requestDeviceCode: vi.fn(async () => ({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-secret",
      pollIntervalSeconds: 5,
    })),
    pollDeviceAuthorization: vi.fn()
      .mockResolvedValueOnce({ status: "pending" as const })
      .mockResolvedValueOnce({
        status: "authorized" as const,
        authorizationCode: "authorization-secret",
        codeVerifier: "verifier-secret",
      }),
    exchangeAuthorization: vi.fn(async () => ({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresInSeconds,
    })),
    refreshTokens: vi.fn(async () => ({
      accessToken: "access-refreshed",
      refreshToken: "refresh-rotated",
      expiresInSeconds: 7200,
    })),
  };
}

describe("CodexConnectionService", () => {
  it("fails closed on a malformed persisted device-flow expiry", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    const flowId = "11111111-1111-4111-8111-111111111111";
    const flow = repository.createAiDeviceFlow({
      id: flowId,
      identity: "alex",
      provider: "openai-codex",
      stateCiphertext: box.seal(JSON.stringify({
        userCode: "ABCD-EFGH",
        deviceAuthId: "device-secret",
        pollIntervalSeconds: 5,
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "device-flow",
        recordId: flowId,
      }),
      expiresAt: "invalid-date",
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    await expect(service.complete("alex", flow.id)).rejects.toThrow(/invalid|expired/i);
    expect(client.pollDeviceAuthorization).not.toHaveBeenCalled();
    repository.close();
  });

  it("fails closed on a malformed persisted next allowed poll time", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    const flowId = "22222222-2222-4222-8222-222222222222";
    const flow = repository.createAiDeviceFlow({
      id: flowId,
      identity: "alex",
      provider: "openai-codex",
      stateCiphertext: box.seal(JSON.stringify({
        userCode: "ABCD-EFGH",
        deviceAuthId: "device-secret",
        pollIntervalSeconds: 5,
        nextAllowedPollAt: "not-an-iso-date",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "device-flow",
        recordId: flowId,
      }),
      expiresAt: "2026-09-04T00:15:00.000Z",
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    await expect(service.complete("alex", flow.id)).rejects.toThrow(/date|state|poll/i);
    expect(client.pollDeviceAuthorization).not.toHaveBeenCalled();
    repository.close();
  });

  it("deletes a device flow after the official HTTP 401 authorization_declined response", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockRejectedValueOnce(new CodexOAuthError(
      "Codex device authorization was denied.",
      "denied",
      "authorization_declined",
      401,
    ));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const started = await service.start("Alex");

    await expect(service.complete(" ALEX ", started.flowId)).rejects.toMatchObject({
      kind: "denied",
    });
    expect(repository.getAiDeviceFlow(started.flowId, "alex")).toBeNull();
    repository.close();
  });

  it("deletes a device flow when authorization expires upstream", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockRejectedValueOnce(new CodexOAuthError(
      "Codex device authorization expired.",
      "expired",
      "expired_token",
      403,
    ));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const started = await service.start("alex");

    await expect(service.complete("alex", started.flowId)).rejects.toMatchObject({
      kind: "expired",
    });
    expect(repository.getAiDeviceFlow(started.flowId, "alex")).toBeNull();
    repository.close();
  });

  it("deletes a device flow after a polling protocol error", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockRejectedValueOnce(new CodexOAuthError(
      "Codex device authorization returned an invalid response.",
      "protocol",
    ));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const started = await service.start("alex");

    await expect(service.complete("alex", started.flowId)).rejects.toMatchObject({
      kind: "protocol",
    });
    expect(repository.getAiDeviceFlow(started.flowId, "alex")).toBeNull();
    repository.close();
  });

  it("deletes a device flow after definitive authorization-code rejection", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockResolvedValueOnce({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    client.exchangeAuthorization.mockRejectedValueOnce(new CodexOAuthError(
      "Codex token exchange failed: invalid_grant.",
      "credential_rejected",
      "invalid_grant",
      400,
    ));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const started = await service.start("alex");

    await expect(service.complete("alex", started.flowId)).rejects.toMatchObject({
      kind: "credential_rejected",
    });
    expect(repository.getAiDeviceFlow(started.flowId, "alex")).toBeNull();
    repository.close();
  });

  it("deletes a device flow after an authorization-code protocol error", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockResolvedValueOnce({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    client.exchangeAuthorization.mockRejectedValueOnce(new CodexOAuthError(
      "Codex token exchange returned an invalid response.",
      "protocol",
    ));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const started = await service.start("alex");

    await expect(service.complete("alex", started.flowId)).rejects.toMatchObject({
      kind: "protocol",
    });
    expect(repository.getAiDeviceFlow(started.flowId, "alex")).toBeNull();
    repository.close();
  });

  it("throttles an immediate retry after a transient authorization-code exchange failure", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockResolvedValue({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    client.exchangeAuthorization.mockRejectedValueOnce(new CodexOAuthError(
      "Codex upstream request failed.",
      "transient",
    ));
    let now = new Date("2026-09-04T00:00:00.000Z");
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => now,
    });
    const started = await service.start("alex");

    await expect(service.complete("alex", started.flowId)).rejects.toMatchObject({
      kind: "transient",
    });
    expect(repository.getAiDeviceFlow(started.flowId, "alex")).not.toBeNull();

    await expect(service.complete("alex", started.flowId)).resolves.toEqual({
      status: "pending",
    });
    expect(client.pollDeviceAuthorization).toHaveBeenCalledTimes(1);
    expect(client.exchangeAuthorization).toHaveBeenCalledTimes(1);

    now = new Date("2026-09-04T00:00:05.000Z");
    await expect(service.complete("alex", started.flowId)).resolves.toMatchObject({
      status: "connected",
    });
    expect(client.pollDeviceAuthorization).toHaveBeenCalledTimes(2);
    expect(client.exchangeAuthorization).toHaveBeenCalledTimes(2);
    repository.close();
  });

  it("preserves a device flow after a transient polling failure", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockRejectedValueOnce(new CodexOAuthError(
      "Codex upstream request failed.",
      "transient",
    ));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const started = await service.start("alex");

    await expect(service.complete("alex", started.flowId)).rejects.toMatchObject({
      kind: "transient",
    });
    expect(repository.getAiDeviceFlow(started.flowId, "alex")).not.toBeNull();
    repository.close();
  });

  it("coalesces concurrent completion attempts for one device flow", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockResolvedValue({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const started = await service.start("Alex");

    const results = await Promise.all([
      service.complete("alex", started.flowId),
      service.complete(" ALEX ", started.flowId),
    ]);

    expect(results).toEqual([
      { status: "connected", model: "gpt-5.6-sol" },
      { status: "connected", model: "gpt-5.6-sol" },
    ]);
    expect(client.pollDeviceAuthorization).toHaveBeenCalledTimes(1);
    expect(client.exchangeAuthorization).toHaveBeenCalledTimes(1);
    repository.close();
  });

  it("does not connect a superseded flow whose token exchange finishes late", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockResolvedValue({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    let releaseExchange!: () => void;
    client.exchangeAuthorization.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseExchange = resolve; });
      return {
        accessToken: "access-from-superseded-flow",
        refreshToken: "refresh-from-superseded-flow",
        expiresInSeconds: 3600,
      };
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const flowA = await service.start("alex");

    const completionA = service.complete("alex", flowA.flowId);
    await vi.waitFor(() => expect(client.exchangeAuthorization).toHaveBeenCalledTimes(1));
    const flowB = await service.start("alex");
    releaseExchange();

    await expect(completionA).rejects.toThrow(/flow|superseded/i);
    expect(repository.getAiConnection("alex")).toBeNull();
    expect(repository.getAiDeviceFlow(flowB.flowId, "alex")).not.toBeNull();
    repository.close();
  });

  it("does not recreate a connection after disconnect during token exchange", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockResolvedValue({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    let releaseExchange!: () => void;
    client.exchangeAuthorization.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseExchange = resolve; });
      return {
        accessToken: "access-after-disconnect",
        refreshToken: "refresh-after-disconnect",
        expiresInSeconds: 3600,
      };
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const flow = await service.start("alex");

    const completion = service.complete("alex", flow.flowId);
    await vi.waitFor(() => expect(client.exchangeAuthorization).toHaveBeenCalledTimes(1));
    expect(service.disconnect("alex")).toBe(false);
    releaseExchange();

    await expect(completion).rejects.toThrow(/flow|disconnected/i);
    expect(repository.getAiConnection("alex")).toBeNull();
    expect(repository.getAiDeviceFlow(flow.flowId, "alex")).toBeNull();
    repository.close();
  });

  it("persists and enforces the next allowed device poll time", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    let now = new Date("2026-09-04T00:00:00.000Z");
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => now,
    });
    const started = await service.start("alex");

    await expect(service.complete("alex", started.flowId)).resolves.toEqual({
      status: "pending",
    });
    await expect(service.complete("ALEX", started.flowId)).resolves.toEqual({
      status: "pending",
    });
    expect(client.pollDeviceAuthorization).toHaveBeenCalledTimes(1);

    now = new Date("2026-09-04T00:00:05.000Z");
    await expect(service.complete("alex", started.flowId)).resolves.toMatchObject({
      status: "connected",
    });
    expect(client.pollDeviceAuthorization).toHaveBeenCalledTimes(2);
    repository.close();
  });

  it("extends and persists the poll delay after slow_down", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset()
      .mockResolvedValueOnce({ status: "pending", slowDown: true })
      .mockResolvedValueOnce({
        status: "authorized",
        authorizationCode: "authorization-secret",
        codeVerifier: "verifier-secret",
      });
    let now = new Date("2026-09-04T00:00:00.000Z");
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => now,
    });
    const started = await service.start("alex");

    await expect(service.complete("alex", started.flowId)).resolves.toEqual({
      status: "pending",
    });
    now = new Date("2026-09-04T00:00:05.000Z");
    await expect(service.complete("alex", started.flowId)).resolves.toEqual({
      status: "pending",
    });
    expect(client.pollDeviceAuthorization).toHaveBeenCalledTimes(1);
    now = new Date("2026-09-04T00:00:10.000Z");
    await expect(service.complete("alex", started.flowId)).resolves.toMatchObject({
      status: "connected",
    });
    expect(client.pollDeviceAuthorization).toHaveBeenCalledTimes(2);
    repository.close();
  });

  it("prefers a valid access-token exp claim over expires_in", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient(60);
    client.pollDeviceAuthorization.mockReset().mockResolvedValue({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    const expirySeconds = Date.parse("2030-01-02T03:04:05.000Z") / 1000;
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ exp: expirySeconds })).toString("base64url");
    const signature = Buffer.from("signature").toString("base64url");
    client.exchangeAuthorization.mockResolvedValueOnce({
      accessToken: `${header}.${payload}.${signature}`,
      refreshToken: "refresh-secret",
      expiresInSeconds: 60,
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const started = await service.start("alex");
    await service.complete("alex", started.flowId);

    expect(repository.getAiConnection("alex")?.expiresAt).toBe(
      "2030-01-02T03:04:05.000Z",
    );
    repository.close();
  });

  it("falls back to expires_in when token header and signature are malformed", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient(60);
    client.pollDeviceAuthorization.mockReset().mockResolvedValue({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    const payload = Buffer.from(JSON.stringify({
      exp: Date.parse("2030-01-02T03:04:05.000Z") / 1000,
    })).toString("base64url");
    client.exchangeAuthorization.mockResolvedValueOnce({
      accessToken: `!!.${payload}.!!`,
      refreshToken: "refresh-secret",
      expiresInSeconds: 60,
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const started = await service.start("alex");
    await service.complete("alex", started.flowId);

    expect(repository.getAiConnection("alex")?.expiresAt).toBe(
      "2026-09-04T00:01:00.000Z",
    );
    repository.close();
  });

  it("encrypts device and token state while enforcing identity ownership", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    let now = new Date("2026-09-04T00:00:00.000Z");
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => now,
    });

    const started = await service.start("alex");
    expect(started).toMatchObject({
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device",
    });
    const storedFlow = repository.getAiDeviceFlow(started.flowId, "alex");
    expect(storedFlow?.stateCiphertext).not.toContain("device-secret");
    expect(storedFlow?.stateCiphertext).not.toContain("ABCD-EFGH");
    await expect(service.complete("other-user", started.flowId)).rejects.toThrow(/flow/i);
    expect(client.pollDeviceAuthorization).not.toHaveBeenCalled();

    expect(await service.complete("alex", started.flowId)).toEqual({ status: "pending" });
    now = new Date("2026-09-04T00:00:05.000Z");
    expect(await service.complete("alex", started.flowId)).toEqual({
      status: "connected",
      model: "gpt-5.6-sol",
    });
    const connection = repository.getAiConnection("alex");
    expect(connection?.credentialCiphertext).not.toContain("access-secret");
    expect(connection?.credentialCiphertext).not.toContain("refresh-secret");
    expect(repository.getAiDeviceFlow(started.flowId, "alex")).toBeNull();
    expect(service.getStatus("alex")).toMatchObject({
      enabled: true,
      connected: true,
      model: "gpt-5.6-sol",
    });
    repository.close();
  });

  it("refreshes expiring credentials and persists the rotated refresh token", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient(60);
    let now = new Date("2026-09-04T00:00:00.000Z");
    const provider = { generate: vi.fn(async () => "provider-output") } satisfies TailoringProvider;
    const providerFactory = vi.fn(() => provider);
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory,
      now: () => now,
    });
    const started = await service.start("alex");
    await service.complete("alex", started.flowId);
    now = new Date("2026-09-04T00:00:05.000Z");
    await service.complete("alex", started.flowId);

    now = new Date("2026-09-04T00:00:30.000Z");
    const managedProvider = await service.getProvider("alex");
    expect(await managedProvider?.generate({ achievements: [], requirements: [] })).toBe(
      "provider-output",
    );
    expect(client.refreshTokens).toHaveBeenCalledWith("refresh-secret");
    expect(providerFactory).toHaveBeenCalledWith({
      accessToken: "access-refreshed",
      model: "gpt-5.6-sol",
    });
    const encrypted = repository.getAiConnection("alex")?.credentialCiphertext;
    expect(encrypted).toBeTruthy();
    expect(JSON.parse(box.open(encrypted!, {
      identity: "alex",
      provider: "openai-codex",
      purpose: "connection",
      recordId: "alex",
    }))).toEqual({
      accessToken: "access-refreshed",
      refreshToken: "refresh-rotated",
    });
    repository.close();
  });

  it("does not overwrite credentials replaced while a refresh is in flight", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    let releaseRefresh!: () => void;
    client.refreshTokens.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseRefresh = resolve; });
      return {
        accessToken: "access-stale-refresh",
        refreshToken: "refresh-stale-refresh",
        expiresInSeconds: 7200,
      };
    });
    const oldCiphertext = box.seal(JSON.stringify({
      accessToken: "access-old",
      refreshToken: "refresh-old",
    }), {
      identity: "alex",
      provider: "openai-codex",
      purpose: "connection",
      recordId: "alex",
    });
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: oldCiphertext,
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T00:00:00.000Z",
      status: "connected",
    });
    const providerFactory = vi.fn(() => ({
      generate: vi.fn(async () => "provider-output"),
    } satisfies TailoringProvider));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory,
      now: () => new Date("2026-09-04T00:00:30.000Z"),
    });

    const providerPromise = service.getProvider("alex");
    await vi.waitFor(() => expect(client.refreshTokens).toHaveBeenCalledTimes(1));
    const newerCiphertext = box.seal(JSON.stringify({
      accessToken: "access-newer",
      refreshToken: "refresh-newer",
    }), {
      identity: "alex",
      provider: "openai-codex",
      purpose: "connection",
      recordId: "alex",
    });
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: newerCiphertext,
      model: "gpt-5.6-sol-newer",
      expiresAt: "2026-09-04T02:00:00.000Z",
      status: "connected",
    });
    releaseRefresh();

    await expect(providerPromise).resolves.toBeTruthy();
    expect(repository.getAiConnection("alex")).toMatchObject({
      credentialCiphertext: newerCiphertext,
      model: "gpt-5.6-sol-newer",
      status: "connected",
    });
    expect(providerFactory).toHaveBeenCalledWith({
      accessToken: "access-newer",
      model: "gpt-5.6-sol-newer",
    });
    repository.close();
  });

  it("preserves a model changed while the same credentials refresh", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    let releaseRefresh!: () => void;
    client.refreshTokens.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseRefresh = resolve; });
      return {
        accessToken: "access-refreshed",
        refreshToken: "refresh-rotated",
        expiresInSeconds: 7200,
      };
    });
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: box.seal(JSON.stringify({
        accessToken: "access-old",
        refreshToken: "refresh-old",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "connection",
        recordId: "alex",
      }),
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T00:00:00.000Z",
      status: "connected",
    });
    const providerFactory = vi.fn(() => ({
      generate: vi.fn(async () => "provider-output"),
    } satisfies TailoringProvider));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory,
      now: () => new Date("2026-09-04T00:00:30.000Z"),
    });

    const providerPromise = service.getProvider("alex");
    await vi.waitFor(() => expect(client.refreshTokens).toHaveBeenCalledTimes(1));
    repository.updateAiConnectionModel("alex", "gpt-5.6-sol-updated");
    releaseRefresh();

    await expect(providerPromise).resolves.toBeTruthy();
    expect(repository.getAiConnection("alex")?.model).toBe("gpt-5.6-sol-updated");
    expect(providerFactory).toHaveBeenCalledWith({
      accessToken: "access-refreshed",
      model: "gpt-5.6-sol-updated",
    });
    repository.close();
  });

  it("coalesces concurrent refreshes by canonical identity", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient(60);
    client.pollDeviceAuthorization.mockReset().mockResolvedValue({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    let releaseRefresh!: () => void;
    client.refreshTokens.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseRefresh = resolve; });
      return {
        accessToken: "access-refreshed",
        refreshToken: "refresh-rotated",
        expiresInSeconds: 7200,
      };
    });
    const provider = { generate: vi.fn(async () => "provider-output") } satisfies TailoringProvider;
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory: () => provider,
      now: () => new Date("2026-09-04T00:00:30.000Z"),
    });
    const started = await service.start("Alex");
    await service.complete("alex", started.flowId);

    const first = service.getProvider("alex");
    const second = service.getProvider(" ALEX ");
    await vi.waitFor(() => expect(client.refreshTokens).toHaveBeenCalledTimes(1));
    releaseRefresh();

    const providers = await Promise.all([first, second]);
    expect(providers.every(Boolean)).toBe(true);
    await expect(Promise.all(providers.map((managed) => managed!.generate({
      achievements: [],
      requirements: [],
    })))).resolves.toEqual(["provider-output", "provider-output"]);
    expect(client.refreshTokens).toHaveBeenCalledTimes(1);
    repository.close();
  });

  it("marks rejected refresh credentials for reauthentication", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient(60);
    client.pollDeviceAuthorization.mockReset().mockResolvedValue({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    client.refreshTokens.mockRejectedValueOnce(new CodexOAuthError(
      "Codex token exchange failed: invalid_grant.",
      "credential_rejected",
      "invalid_grant",
      400,
    ));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:30.000Z"),
    });
    const started = await service.start("alex");
    await service.complete("alex", started.flowId);

    await expect(service.getProvider("alex")).resolves.toBeNull();
    expect(repository.getAiConnection("alex")?.status).toBe("reauth_required");
    repository.close();
  });

  it("preserves connected status and returns null on transient refresh failure", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.refreshTokens.mockRejectedValueOnce(new CodexOAuthError(
      "Codex token exchange failed (HTTP 503).",
      "transient",
      "temporarily_unavailable",
      503,
    ));
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: box.seal(JSON.stringify({
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "connection",
        recordId: "alex",
      }),
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T00:00:00.000Z",
      status: "connected",
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:30.000Z"),
    });

    await expect(service.getProvider("alex")).resolves.toBeNull();
    expect(repository.getAiConnection("alex")?.status).toBe("connected");
    repository.close();
  });

  it("leaves the connection intact and does not refresh after a model 403", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: box.seal(JSON.stringify({
        accessToken: "access-old",
        refreshToken: "refresh-old",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "connection",
        recordId: "alex",
      }),
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T01:00:00.000Z",
      status: "connected",
    });
    const forbidden = new CodexOAuthError(
      "Codex model request failed (HTTP 403).",
      "credential_rejected",
      "forbidden",
      403,
    );
    const providerFactory = vi.fn(() => ({
      generate: vi.fn(async () => { throw forbidden; }),
    } satisfies TailoringProvider));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const provider = await service.getProvider("alex");
    await expect(provider!.generate({ achievements: [], requirements: [] })).rejects.toBe(forbidden);
    expect(client.refreshTokens).not.toHaveBeenCalled();
    expect(repository.getAiConnection("alex")?.status).toBe("connected");
    repository.close();
  });

  it("forces one refresh and retries once after a model 401", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: box.seal(JSON.stringify({
        accessToken: "access-old",
        refreshToken: "refresh-old",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "connection",
        recordId: "alex",
      }),
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T01:00:00.000Z",
      status: "connected",
    });
    const providerFactory = vi.fn(({ accessToken }: { accessToken: string; model: string }) => ({
      generate: vi.fn(async () => {
        if (accessToken === "access-old") {
          throw new CodexOAuthError("Model rejected token.", "credential_rejected", "invalid_token", 401);
        }
        return "retried-output";
      }),
    } satisfies TailoringProvider));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const provider = await service.getProvider("alex");
    await expect(provider?.generate({ achievements: [], requirements: [] })).resolves.toBe(
      "retried-output",
    );
    expect(client.refreshTokens).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledTimes(2);
    expect(repository.getAiConnection("alex")?.status).toBe("connected");
    repository.close();
  });

  it("does not mark reauthentication when a model retry returns 403", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: box.seal(JSON.stringify({
        accessToken: "access-old",
        refreshToken: "refresh-old",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "connection",
        recordId: "alex",
      }),
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T01:00:00.000Z",
      status: "connected",
    });
    const providerFactory = vi.fn(({ accessToken }: { accessToken: string; model: string }) => ({
      generate: vi.fn(async () => {
        throw new CodexOAuthError(
          "Model rejected request.",
          "credential_rejected",
          accessToken === "access-old" ? "invalid_token" : "forbidden",
          accessToken === "access-old" ? 401 : 403,
        );
      }),
    } satisfies TailoringProvider));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const provider = await service.getProvider("alex");
    await expect(provider!.generate({ achievements: [], requirements: [] })).rejects.toMatchObject({
      httpStatus: 403,
    });
    expect(client.refreshTokens).toHaveBeenCalledTimes(1);
    expect(repository.getAiConnection("alex")?.status).toBe("connected");
    repository.close();
  });

  it("serializes concurrent reactive refreshes after model 401 responses", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    let releaseRefresh!: () => void;
    client.refreshTokens.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseRefresh = resolve; });
      return {
        accessToken: "access-refreshed",
        refreshToken: "refresh-rotated",
        expiresInSeconds: 7200,
      };
    });
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: box.seal(JSON.stringify({
        accessToken: "access-old",
        refreshToken: "refresh-old",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "connection",
        recordId: "alex",
      }),
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T01:00:00.000Z",
      status: "connected",
    });
    const providerFactory = ({ accessToken }: { accessToken: string; model: string }) => ({
      generate: vi.fn(async () => {
        if (accessToken === "access-old") {
          throw new CodexOAuthError("Unauthorized.", "credential_rejected", "invalid_token", 401);
        }
        return "retried-output";
      }),
    } satisfies TailoringProvider);
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const provider = await service.getProvider("alex");

    const first = provider!.generate({ achievements: [], requirements: [] });
    const second = provider!.generate({ achievements: [], requirements: [] });
    await vi.waitFor(() => expect(client.refreshTokens).toHaveBeenCalledTimes(1));
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toEqual([
      "retried-output",
      "retried-output",
    ]);
    expect(client.refreshTokens).toHaveBeenCalledTimes(1);
    repository.close();
  });

  it("marks reauthentication after the one model-401 retry also fails", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: box.seal(JSON.stringify({
        accessToken: "access-old",
        refreshToken: "refresh-old",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "connection",
        recordId: "alex",
      }),
      model: "gpt-5.6-sol",
      expiresAt: "2026-09-04T01:00:00.000Z",
      status: "connected",
    });
    const providerFactory = vi.fn(() => ({
      generate: vi.fn(async () => {
        throw new CodexOAuthError("Unauthorized.", "credential_rejected", "invalid_token", 401);
      }),
    } satisfies TailoringProvider));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const provider = await service.getProvider("alex");

    await expect(provider!.generate({ achievements: [], requirements: [] })).rejects.toThrow(
      /unauthorized/i,
    );
    expect(client.refreshTokens).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledTimes(2);
    expect(repository.getAiConnection("alex")?.status).toBe("reauth_required");
    repository.close();
  });

  it("fails closed on a malformed persisted credential expiry", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: box.seal(JSON.stringify({
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "connection",
        recordId: "alex",
      }),
      model: "gpt-5.6-sol",
      expiresAt: "not-an-iso-date",
      status: "connected",
    });
    const providerFactory = vi.fn(() => ({
      generate: vi.fn(async () => "unexpected"),
    } satisfies TailoringProvider));
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      providerFactory,
      now: () => new Date("2026-09-04T00:00:30.000Z"),
    });

    await expect(service.getProvider("alex")).resolves.toBeNull();
    expect(service.getStatus("alex")).toMatchObject({
      connected: false,
      reauthRequired: false,
    });
    expect(client.refreshTokens).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
    repository.close();
  });

  it("reports a corrupt persisted model as disconnected without exposing it", () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    const corruptModel = "bad model containing refresh-secret";
    repository.upsertAiConnection({
      identity: "alex",
      provider: "openai-codex",
      credentialCiphertext: box.seal(JSON.stringify({
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
      }), {
        identity: "alex",
        provider: "openai-codex",
        purpose: "connection",
        recordId: "alex",
      }),
      model: corruptModel,
      expiresAt: "2026-09-04T01:00:00.000Z",
      status: "connected",
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });

    const status = service.getStatus("alex");
    expect(status).toMatchObject({ connected: false, reauthRequired: false });
    expect(status.model).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain(corruptModel);
    expect(JSON.stringify(status)).not.toContain("refresh-secret");
    repository.close();
  });

  it("validates model identifiers and disconnects only the current identity", async () => {
    const repository = CareerRepository.inMemory();
    const client = authorizedClient();
    client.pollDeviceAuthorization.mockReset().mockResolvedValue({
      status: "authorized",
      authorizationCode: "authorization-secret",
      codeVerifier: "verifier-secret",
    });
    const service = new CodexConnectionService({
      repository,
      credentialBox: box,
      client,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const started = await service.start("alex");
    await service.complete("alex", started.flowId);

    expect(() => service.updateModel("alex", "bad model; rm -rf /")).toThrow(/model/i);
    expect(service.disconnect("other-user")).toBe(false);
    expect(service.disconnect("alex")).toBe(true);
    expect(service.getStatus("alex")).toMatchObject({ connected: false });
    repository.close();
  });
});
