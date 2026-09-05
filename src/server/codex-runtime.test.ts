import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CODEX_MODEL, CodexConnectionService } from "./codex-connection";
import { getRepository } from "./database";
import {
  getCodexConnectionService,
  getCodexRuntimeStatus,
  resetCodexRuntimeForTests,
} from "./codex-runtime";

const runtimeMocks = vi.hoisted(() => ({
  serviceConstructorError: undefined as Error | undefined,
}));

vi.mock("./codex-connection", async () => {
  const actual = await vi.importActual<typeof import("./codex-connection")>(
    "./codex-connection",
  );
  const defaultModel = actual.DEFAULT_CODEX_MODEL;
  class MockCodexConnectionService {
    readonly defaultModel: string;

    constructor(options: { defaultModel?: string }) {
      if (runtimeMocks.serviceConstructorError) {
        throw runtimeMocks.serviceConstructorError;
      }
      this.defaultModel = options.defaultModel ?? defaultModel;
    }
  }

  return {
    DEFAULT_CODEX_MODEL: defaultModel,
    CodexConnectionService: MockCodexConnectionService,
  };
});

vi.mock("./database", () => ({
  getRepository: vi.fn(() => ({})),
}));

describe("Codex runtime", () => {
  afterEach(() => {
    resetCodexRuntimeForTests();
    runtimeMocks.serviceConstructorError = undefined;
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each(["false", "TRUE", "1", " true", "true "])(
    "is unavailable when the OAuth flag is %j",
    (flag) => {
      vi.stubEnv("CODEX_OAUTH_ENABLED", flag);

      expect(getCodexConnectionService()).toBeNull();
      expect(getCodexRuntimeStatus()).toEqual({
        available: false,
        reason: "disabled",
      });
      expect(getRepository).not.toHaveBeenCalled();
    },
  );

  it("reports unavailable without throwing when the encryption key is missing", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");

    expect(getCodexRuntimeStatus()).toEqual({
      available: false,
      reason: "misconfigured",
    });
  });

  it("does not create a service from an invalid encryption key", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "not-a-valid-key");

    expect(getCodexConnectionService()).toBeNull();
    expect(getCodexRuntimeStatus()).toEqual({
      available: false,
      reason: "misconfigured",
    });
  });

  it("rejects an invalid configured model consistently", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv(
      "CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 10).toString("base64"),
    );
    vi.stubEnv("CODEX_MODEL", "invalid model");

    expect(getCodexRuntimeStatus()).toEqual({
      available: false,
      reason: "misconfigured",
    });
    expect(getCodexConnectionService()).toBeNull();
    expect(getRepository).not.toHaveBeenCalled();
  });

  it("trims a valid configured model", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv(
      "CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 12).toString("base64"),
    );
    vi.stubEnv("CODEX_MODEL", "  openai/gpt-5.6:codex_latest  ");

    const service = getCodexConnectionService();

    expect(service).toMatchObject({
      defaultModel: "openai/gpt-5.6:codex_latest",
    });
    expect(getCodexRuntimeStatus()).toEqual({ available: true });
  });

  it("rebuilds the cached service when the encryption key changes", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv(
      "CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 13).toString("base64"),
    );
    vi.stubEnv("CODEX_MODEL", "gpt-5.6-sol");
    const first = getCodexConnectionService();

    vi.stubEnv(
      "CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 14).toString("base64"),
    );
    const second = getCodexConnectionService();

    expect(second).not.toBe(first);
    expect(getRepository).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the cached service when the configured model changes", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv(
      "CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 15).toString("base64"),
    );
    vi.stubEnv("CODEX_MODEL", "gpt-5.6-sol");
    const first = getCodexConnectionService();

    vi.stubEnv("CODEX_MODEL", "gpt-5.6-codex");
    const second = getCodexConnectionService();

    expect(second).not.toBe(first);
    expect(second).toMatchObject({ defaultModel: "gpt-5.6-codex" });
    expect(getRepository).toHaveBeenCalledTimes(2);
  });

  it("retires the cached service across disable and re-enable", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv(
      "CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 16).toString("base64"),
    );
    vi.stubEnv("CODEX_MODEL", "gpt-5.6-sol");
    const first = getCodexConnectionService();

    vi.stubEnv("CODEX_OAUTH_ENABLED", "false");
    expect(getCodexConnectionService()).toBeNull();
    expect(getCodexRuntimeStatus()).toEqual({
      available: false,
      reason: "disabled",
    });

    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    const second = getCodexConnectionService();

    expect(second).not.toBe(first);
    expect(getRepository).toHaveBeenCalledTimes(2);
  });

  it("propagates repository initialization failures without exposing details in status", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv(
      "CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 17).toString("base64"),
    );
    vi.stubEnv("CODEX_MODEL", "gpt-5.6-sol");
    const operationalError = new Error("sqlite migration included a private path");
    vi.mocked(getRepository).mockImplementationOnce(() => {
      throw operationalError;
    });

    expect(getCodexRuntimeStatus()).toEqual({ available: true });
    expect(() => getCodexConnectionService()).toThrow(operationalError);
  });

  it("propagates unexpected service constructor failures", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv(
      "CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 18).toString("base64"),
    );
    vi.stubEnv("CODEX_MODEL", "gpt-5.6-sol");
    const operationalError = new Error("unexpected constructor failure");
    runtimeMocks.serviceConstructorError = operationalError;

    expect(() => getCodexConnectionService()).toThrow(operationalError);
  });

  it.each([
    {
      name: "disabled runtime",
      enabled: "false",
      key: Buffer.alloc(32, 19).toString("base64"),
      model: "gpt-5.6-sol",
      available: false,
    },
    {
      name: "invalid key",
      enabled: "true",
      key: "invalid-key",
      model: "gpt-5.6-sol",
      available: false,
    },
    {
      name: "invalid model",
      enabled: "true",
      key: Buffer.alloc(32, 20).toString("base64"),
      model: "invalid model",
      available: false,
    },
    {
      name: "valid configuration",
      enabled: "true",
      key: Buffer.alloc(32, 21).toString("base64"),
      model: "gpt-5.6-sol",
      available: true,
    },
  ])("keeps status and factory availability aligned for $name", ({
    enabled,
    key,
    model,
    available,
  }) => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", enabled);
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", key);
    vi.stubEnv("CODEX_MODEL", model);

    const status = getCodexRuntimeStatus();
    const service = getCodexConnectionService();

    expect(status.available).toBe(available);
    expect(service !== null).toBe(available);
  });

  it("creates one repository-backed service and uses the service model default", () => {
    vi.stubEnv("CODEX_OAUTH_ENABLED", "true");
    vi.stubEnv(
      "CREDENTIAL_ENCRYPTION_KEY",
      Buffer.alloc(32, 11).toString("base64"),
    );
    vi.stubEnv("CODEX_MODEL", "");

    const first = getCodexConnectionService();
    const second = getCodexConnectionService();

    expect(first).toBeInstanceOf(CodexConnectionService);
    expect(second).toBe(first);
    expect(getRepository).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ defaultModel: DEFAULT_CODEX_MODEL });
    expect(getCodexRuntimeStatus()).toEqual({ available: true });
  });
});
