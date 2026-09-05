import { describe, expect, it, vi } from "vitest";
import {
  CodexOAuthError,
  CodexOAuthClient,
  CodexResponsesProvider,
  extractAccessTokenExpiry,
  extractChatGptAccountId,
} from "./codex-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jwt(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    exp: 4_000_000_000,
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  const signature = Buffer.from("signature").toString("base64url");
  return `${header}.${payload}.${signature}`;
}

describe("request construction safety", () => {
  it.each(["poll", "authorization", "refresh", "model"] as const)(
    "normalizes %s request serialization failures before fetch",
    async (operation) => {
      const secret = "SYNTHETIC_SERIALIZATION_SECRET";
      const request = vi.fn<typeof fetch>();
      const client = new CodexOAuthClient({ fetch: request });
      const invalid = { toJSON() { throw new Error(secret); }, toString() { throw new Error(secret); } };
      const call = operation === "poll"
        ? client.pollDeviceAuthorization({
            get deviceAuthId(): string { throw new Error(secret); },
            userCode: "synthetic", pollIntervalSeconds: 5,
          })
        : operation === "authorization"
          ? client.exchangeAuthorization({
              status: "authorized", authorizationCode: invalid as unknown as string,
              codeVerifier: "synthetic",
            })
          : operation === "refresh"
            ? client.refreshTokens(invalid as unknown as string)
            : new CodexResponsesProvider({ accessToken: "opaque", model: "test", fetch: request })
                .generate({ achievements: [], requirements: Object.assign([], { toJSON: invalid.toJSON }) });
      const error = await call.catch((caught) => caught);
      expect(error).toBeInstanceOf(CodexOAuthError);
      expect(error).toMatchObject({ kind: "protocol", message: "Codex request construction failed." });
      expect(error.message).not.toContain(secret);
      expect(error.stack).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(error).not.toHaveProperty("cause");
      expect(request).not.toHaveBeenCalled();
    },
  );
  it.each(["\r", "\n", "\0", "\u0100"])(
    "normalizes native Headers failures for direct provider tokens (%j)",
    async (unsafe) => {
      const secret = `SYNTHETIC_DIRECT_SECRET${unsafe}invalid`;
      expect(() => new Headers({ authorization: `Bearer ${secret}` })).toThrow(TypeError);
      const request = vi.fn<typeof fetch>();
      const provider = new CodexResponsesProvider({ accessToken: secret, model: "test", fetch: request });
      const error = await provider.generate({ achievements: [], requirements: [] }).catch((caught) => caught);
      expect(error).toBeInstanceOf(CodexOAuthError);
      expect(error).toMatchObject({ kind: "protocol", message: "Codex request construction failed." });
      expect(error.message).not.toContain("SYNTHETIC_DIRECT_SECRET");
      expect(error.stack).not.toContain("SYNTHETIC_DIRECT_SECRET");
      expect(JSON.stringify(error)).not.toContain("SYNTHETIC_DIRECT_SECRET");
      expect(error).not.toHaveProperty("cause");
      expect(request).not.toHaveBeenCalled();
    },
  );
});

describe("nonblocking stream cleanup", () => {
  it.each(["resolved", "rejecting", "never-settling"] as const)(
    "cancels wrong-content-type bodies before clearing the deadline with %s cleanup",
    async (cleanup) => {
      vi.useFakeTimers();
      const secret = "secret-from-wrong-content-type-cancel";
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        let timersAtCancel: number | undefined;
        const cancel = vi.fn(() => {
          timersAtCancel = vi.getTimerCount();
          if (cleanup === "rejecting") return Promise.reject(new Error(secret));
          if (cleanup === "never-settling") return new Promise<void>(() => {});
          return Promise.resolve();
        });
        const stream = new ReadableStream<Uint8Array>({ cancel });
        const provider = new CodexResponsesProvider({
          accessToken: jwt("account-123"),
          model: "gpt-5.6-sol",
          fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
            headers: { "content-type": "application/json" },
          })),
        });
        const settled = vi.fn();
        void provider.generate({ achievements: [], requirements: [] }).then(settled, settled);
        await vi.advanceTimersByTimeAsync(0);

        expect(settled).toHaveBeenCalledTimes(1);
        const error = settled.mock.calls[0][0];
        expect(error).toBeInstanceOf(CodexOAuthError);
        expect(error).toMatchObject({
          kind: "protocol",
          message: "Codex model response was not an event stream.",
        });
        expect(String(error)).not.toContain(secret);
        expect(JSON.stringify(error)).not.toContain(secret);
        expect(unhandled).toEqual([]);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(timersAtCancel).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        process.off("unhandledRejection", onUnhandled);
        vi.useRealTimers();
      }
    },
  );

  it.each(["auth", "SSE"] as const)(
    "cancels declared oversized %s bodies without waiting or masking the protocol error",
    async (path) => {
      vi.useFakeTimers();
      try {
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const stream = new ReadableStream<Uint8Array>({ cancel });
        const response = new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "content-length": String(256 * 1024 + 1),
          },
        });
        const request = vi.fn<typeof fetch>().mockResolvedValue(response);
        const operation = path === "auth"
          ? new CodexOAuthClient({ fetch: request }).refreshTokens("refresh-1")
          : new CodexResponsesProvider({
              accessToken: jwt("account-123"), model: "gpt-5.6-sol", fetch: request,
            }).generate({ achievements: [], requirements: [] });
        const settled = vi.fn();
        void operation.then(settled, settled);
        await vi.advanceTimersByTimeAsync(0);

        expect(settled).toHaveBeenCalledTimes(1);
        expect(settled.mock.calls[0][0]).toBeInstanceOf(CodexOAuthError);
        expect(settled.mock.calls[0][0]).toMatchObject({
          kind: "protocol",
          message: "Upstream response exceeded the size limit.",
        });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(["auth overflow", "SSE parser failure", "DONE success"] as const)(
    "settles %s even when cancellation never settles",
    async (path) => {
      vi.useFakeTimers();
      try {
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const content = '{"proposals":[]}';
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(path === "auth overflow"
              ? new Uint8Array(64 * 1024 + 1)
              : new TextEncoder().encode(path === "SSE parser failure"
                ? "data: {not-json}\n\n"
                : [
                    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: content })}`,
                    `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
                    "data: [DONE]",
                    "",
                  ].join("\n\n")));
          },
          cancel,
        });
        const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        }));
        const operation = path === "auth overflow"
          ? new CodexOAuthClient({ fetch: request }).refreshTokens("refresh-1")
          : new CodexResponsesProvider({
              accessToken: jwt("account-123"), model: "gpt-5.6-sol", fetch: request,
            }).generate({ achievements: [], requirements: [] });
        const settled = vi.fn();
        void operation.then(settled, settled);
        await vi.advanceTimersByTimeAsync(0);

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(settled).toHaveBeenCalledTimes(1);
        if (path === "DONE success") {
          expect(settled).toHaveBeenCalledWith(content);
        } else {
          expect(settled.mock.calls[0][0]).toBeInstanceOf(CodexOAuthError);
          expect(settled.mock.calls[0][0]).toMatchObject({
            kind: "protocol",
            message: path === "auth overflow"
              ? "Upstream response exceeded the size limit."
              : "Codex model request returned an invalid response.",
          });
        }
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

describe("Codex OAuth client", () => {
  it.each(["\r", "\n", "\0", "\u0100"])(
    "rejects header-unsafe access tokens at parsing (%j)",
    async (unsafe) => {
      const secret = `SYNTHETIC_HEADER_SECRET${unsafe}invalid`;
      expect(() => new Headers({ authorization: `Bearer ${secret}` })).toThrow(TypeError);
      const request = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        access_token: secret, refresh_token: "synthetic-refresh",
      }));
      const modelFetch = vi.fn<typeof fetch>();
      const error = await new CodexOAuthClient({ fetch: request })
        .refreshTokens("synthetic-old")
        .then((tokens) => new CodexResponsesProvider({
          accessToken: tokens.accessToken, model: "test", fetch: modelFetch,
        }).generate({ achievements: [], requirements: [] }))
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(CodexOAuthError);
      expect(error).toMatchObject({
        kind: "protocol", message: "Codex token exchange returned an invalid response.",
      });
      expect(error.message).not.toContain("SYNTHETIC_HEADER_SECRET");
      expect(error.stack).not.toContain("SYNTHETIC_HEADER_SECRET");
      expect(JSON.stringify(error)).not.toContain("SYNTHETIC_HEADER_SECRET");
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("issues");
      expect(request).toHaveBeenCalledTimes(1);
      expect(modelFetch).not.toHaveBeenCalled();
    },
  );
  it("keeps the deadline active while reading a slow auth JSON body", async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({
            user_code: "ABCD-EFGH",
            device_auth_id: "device-1",
            interval: 5,
          })));
          controller.close();
        }, 50);
      },
      cancel() {
        if (timer) clearTimeout(timer);
      },
    });
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
      timeoutMs: 10,
    });

    await expect(client.requestDeviceCode()).rejects.toThrow(/abort|timed? out/i);
  });

  it("swallows auth deadline cancellation rejection without leaking its secret", async () => {
    const secret = "secret-from-auth-deadline-cancel";
    const cancel = vi.fn(() => Promise.reject(new Error(secret)));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const client = new CodexOAuthClient({
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
        timeoutMs: 5,
      });

      const error = await client.refreshTokens("refresh-1").catch((caught) => caught);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(error).toBeInstanceOf(CodexOAuthError);
      expect(error).toMatchObject({
        kind: "transient",
        message: "Codex upstream request timed out.",
      });
      expect(String(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(unhandled).toEqual([]);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("runs the device-code request, pending poll, and authorization exchange", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        user_code: "ABCD-EFGH",
        device_auth_id: "device-1",
        interval: "5",
      }))
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }, 403))
      .mockResolvedValueOnce(jsonResponse({
        authorization_code: "authorization-1",
        code_verifier: "verifier-1",
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
      }));
    const client = new CodexOAuthClient({ fetch: request });

    const device = await client.requestDeviceCode();
    expect(device).toEqual({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-1",
      pollIntervalSeconds: 5,
    });
    expect(await client.pollDeviceAuthorization(device)).toEqual({ status: "pending" });
    const authorized = await client.pollDeviceAuthorization(device);
    expect(authorized).toEqual({
      status: "authorized",
      authorizationCode: "authorization-1",
      codeVerifier: "verifier-1",
    });
    if (authorized.status !== "authorized") throw new Error("Expected authorization.");
    expect(await client.exchangeAuthorization(authorized)).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresInSeconds: 3600,
    });

    expect(request.mock.calls[0][0]).toBe(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
    );
    expect(request.mock.calls[1][0]).toBe(
      "https://auth.openai.com/api/accounts/deviceauth/token",
    );
    const exchangeBody = request.mock.calls[3][1]?.body;
    expect(exchangeBody).toBeInstanceOf(URLSearchParams);
    expect(String(exchangeBody)).toContain("grant_type=authorization_code");
    expect(String(exchangeBody)).toContain("code_verifier=verifier-1");
  });

  it("uses and preserves rotated refresh tokens", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      access_token: "access-2",
      refresh_token: "refresh-2",
      expires_in: 7200,
    }));
    const client = new CodexOAuthClient({ fetch: request });

    expect(await client.refreshTokens("refresh-1")).toEqual({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresInSeconds: 7200,
    });
    const refreshInit = request.mock.calls[0][1];
    expect(new Headers(refreshInit?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(refreshInit?.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    });
  });

  it("classifies invalid_grant refresh rejection as definitive", async () => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ error: "invalid_grant", error_description: "Refresh rejected" }, 400),
      ),
    });

    const error = await client.refreshTokens("refresh-1").catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "credential_rejected",
      code: "invalid_grant",
    });
    expect(error).not.toHaveProperty("upstreamMessage");
  });

  it("classifies HTTP 500 before a terminal-looking invalid_grant refresh error", async () => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ error: "invalid_grant", error_description: "Refresh rejected" }, 500),
      ),
    });

    const error = await client.refreshTokens("refresh-1").catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "transient",
      code: "invalid_grant",
      httpStatus: 500,
    });
    expect(error).not.toHaveProperty("upstreamMessage");
  });

  it("never retains a refresh token echoed by the token endpoint", async () => {
    const refreshToken = "refresh-secret-that-must-never-escape";
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        error: {
          code: "invalid_grant",
          message: refreshToken,
        },
        error_description: refreshToken,
        message: refreshToken,
      }, 400)),
    });

    const error = await client.refreshTokens(refreshToken).catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({ kind: "credential_rejected", code: "invalid_grant" });
    expect(String(error)).not.toContain(refreshToken);
    expect(JSON.stringify(error)).not.toContain(refreshToken);
    expect(Object.values(error)).not.toContain(refreshToken);
    expect(error).not.toHaveProperty("upstreamMessage");
  });

  it("drops an untrusted token endpoint code that echoes the refresh token", async () => {
    const refreshToken = "refresh-secret-echoed-as-code";
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        error: { code: refreshToken, message: refreshToken },
        error_description: refreshToken,
      }, 401)),
    });

    const error = await client.refreshTokens(refreshToken).catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({ kind: "credential_rejected", httpStatus: 401 });
    expect(error.code).toBeUndefined();
    expect(String(error)).not.toContain(refreshToken);
    expect(JSON.stringify(error)).not.toContain(refreshToken);
  });

  it("never retains a refresh token echoed by an auth body reader rejection", async () => {
    const refreshToken = "refresh-secret-echoed-by-reader";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(`Codex Responses reader failed: ${refreshToken}`));
      },
    });
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    });

    const error = await client.refreshTokens(refreshToken).catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "transient",
      message: "Codex upstream response body failed.",
    });
    expect(String(error)).not.toContain(refreshToken);
    expect(JSON.stringify(error)).not.toContain(refreshToken);
    expect(Object.values(error)).not.toContain(refreshToken);
  });

  it("classifies a terminated auth body stream as transient", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    });
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    });

    const error = await client.refreshTokens("refresh-1").catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "transient",
      message: "Codex upstream response body failed.",
    });
  });

  it("classifies refresh network failures as transient", async () => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network unavailable")),
    });

    const error = await client.refreshTokens("refresh-1").catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({ kind: "transient" });
  });

  it("classifies HTTP 429 as transient and exposes bounded Retry-After seconds", async () => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({ error: "invalid_token" }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "120",
          },
        },
      )),
    });

    const error = await client.refreshTokens("refresh-1").catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "transient",
      code: "invalid_token",
      httpStatus: 429,
      retryAfterSeconds: 120,
    });
  });

  it("omits malformed or excessive Retry-After values", async () => {
    for (const retryAfter of ["1.5", "99999", "-1", "not-a-delay"]) {
      const client = new CodexOAuthClient({
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(
          JSON.stringify({ error: "rate_limit_exceeded" }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": retryAfter,
            },
          },
        )),
      });

      const error = await client.refreshTokens("refresh-1").catch((caught) => caught);
      expect(error).toMatchObject({ kind: "transient", httpStatus: 429 });
      expect(error.retryAfterSeconds).toBeUndefined();
    }
  });

  it("preserves the auth size-limit error when reader cancellation rejects", async () => {
    const secret = "secret-from-auth-cancel-rejection";
    const cancel = vi.fn(() => Promise.reject(new Error(secret)));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel,
    });
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    });

    const error = await client.refreshTokens("refresh-1").catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "protocol",
      message: "Upstream response exceeded the size limit.",
    });
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("classifies malformed token responses as protocol errors", async () => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ access_token: 42 })),
    });

    const error = await client.refreshTokens("refresh-1").catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({ kind: "protocol" });
  });

  it("classifies the official HTTP 401 authorization_declined poll as denied", async () => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ error: "authorization_declined" }, 401),
      ),
    });

    const error = await client.pollDeviceAuthorization({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-1",
      pollIntervalSeconds: 5,
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "denied",
      code: "authorization_declined",
      httpStatus: 401,
    });
  });

  it.each([
    [429, "authorization_declined"],
    [500, "access_denied"],
  ])("classifies transient HTTP %i before terminal-looking %s poll errors", async (status, code) => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: code }, status)),
    });

    const error = await client.pollDeviceAuthorization({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-1",
      pollIntervalSeconds: 5,
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({ kind: "transient", code, httpStatus: status });
  });

  it.each(
    [429, 500, 503, 599].flatMap((status) => [
      [status, "authorization_pending"],
      [status, "slow_down"],
    ] as const),
  )("classifies transient HTTP %i before %s poll responses", async (status, code) => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: code }, status)),
    });

    const error = await client.pollDeviceAuthorization({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-1",
      pollIntervalSeconds: 5,
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({ kind: "transient", code, httpStatus: status });
  });

  it.each(
    [400, 403, 404].flatMap((status) => [
      [status, "authorization_pending", { status: "pending" }],
      [status, "slow_down", { status: "pending", slowDown: true }],
    ] as const),
  )("keeps expected HTTP %i %s poll responses pending", async (status, code, expected) => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: code }, status)),
    });

    await expect(client.pollDeviceAuthorization({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-1",
      pollIntervalSeconds: 5,
    })).resolves.toEqual(expected);
  });

  it("does not mistake unexpected polling failures for a pending login", async () => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "blocked" }, 500)),
    });

    await expect(client.pollDeviceAuthorization({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-1",
      pollIntervalSeconds: 5,
    })).rejects.toThrow(/poll/i);
  });

  it("rejects denied and unexpected 403/404 polls instead of reporting pending", async () => {
    for (const [status, error] of [[403, "access_denied"], [404, "not_found"]] as const) {
      const client = new CodexOAuthClient({
        fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error }, status)),
      });

      const caught = await client.pollDeviceAuthorization({
        userCode: "ABCD-EFGH",
        deviceAuthId: "device-1",
        pollIntervalSeconds: 5,
      }).catch((value) => value);
      expect(caught).toBeInstanceOf(CodexOAuthError);
      if (error === "access_denied") {
        expect(caught).toMatchObject({ kind: "denied", code: "access_denied" });
      } else {
        expect(caught).toMatchObject({ kind: "protocol" });
        expect(caught.code).toBeUndefined();
        expect(String(caught)).not.toContain(error);
      }
    }
  });

  it("classifies expired device authorization explicitly", async () => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ error: "expired_token", error_description: "Code expired" }, 403),
      ),
    });

    const error = await client.pollDeviceAuthorization({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-1",
      pollIntervalSeconds: 5,
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "expired",
      code: "expired_token",
    });
    expect(error).not.toHaveProperty("upstreamMessage");
  });

  it("reports an explicit slow_down polling response", async () => {
    const client = new CodexOAuthClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ error: "slow_down" }, 403),
      ),
    });

    await expect(client.pollDeviceAuthorization({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-1",
      pollIntervalSeconds: 5,
    })).resolves.toEqual({ status: "pending", slowDown: true });
  });
});

describe("Codex Responses provider", () => {
  it("cancels the SSE reader on malformed JSON without masking the parser error", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {not-json}\n\n"));
      },
      cancel,
    });
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).rejects.toThrow(
      /invalid response/i,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels the SSE reader when an event fails schema validation", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: 42 })}\n\n`,
        ));
      },
      cancel,
    });
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels the SSE reader when an event follows the terminal event", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode([
          `data: ${JSON.stringify({
            type: "response.completed",
            response: { status: "completed" },
          })}`,
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "late" })}`,
          "",
        ].join("\n\n")));
      },
      cancel,
    });
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).rejects.toThrow(
      /after completion/i,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("preserves an allowlisted SSE error code without its message", async () => {
    const stream = `data: ${JSON.stringify({
      type: "error",
      code: "server_error",
      message: "Try again later",
    })}\n\n`;
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    const error = await provider.generate({ achievements: [], requirements: [] })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "transient",
      code: "server_error",
    });
    expect(String(error)).not.toContain("Try again later");
    expect(JSON.stringify(error)).not.toContain("Try again later");
    expect(error).not.toHaveProperty("upstreamMessage");
  });

  it("never retains an access token echoed by an SSE body reader rejection", async () => {
    const accessToken = jwt("account-reader-secret");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(`Codex Responses reader failed: ${accessToken}`));
      },
    });
    const provider = new CodexResponsesProvider({
      accessToken,
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    const error = await provider.generate({ achievements: [], requirements: [] })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "transient",
      message: "Codex upstream response body failed.",
    });
    expect(String(error)).not.toContain(accessToken);
    expect(JSON.stringify(error)).not.toContain(accessToken);
    expect(Object.values(error)).not.toContain(accessToken);
  });

  it("classifies a terminated SSE body stream as transient", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    });
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    const error = await provider.generate({ achievements: [], requirements: [] })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "transient",
      message: "Codex upstream response body failed.",
    });
  });

  it("drops secret-bearing SSE error fields and cancels the reader", async () => {
    const secret = "access-secret-echoed-by-stream";
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "error", code: secret, message: secret })}\n\n`,
        ));
      },
      cancel,
    });
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    const error = await provider.generate({ achievements: [], requirements: [] })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({ kind: "transient" });
    expect(error.code).toBeUndefined();
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("classifies a model HTTP 401 as definitive credential rejection", async () => {
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ error: "invalid_token", message: "Expired" }, 401),
      ),
    });

    const error = await provider.generate({ achievements: [], requirements: [] })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(CodexOAuthError);
    expect(error).toMatchObject({
      kind: "credential_rejected",
      code: "invalid_token",
      httpStatus: 401,
    });
  });

  it("parses blank-line-delimited SSE events with multiline data", async () => {
    const stream = [
      'data: {"type":"response.output_text.delta",',
      'data: "delta":"{\\"proposals\\":[]}"}',
      "",
      'data: {"type":"response.completed",',
      'data: "response":{"status":"completed"}}',
      "",
    ].join("\n");
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).resolves.toBe(
      '{"proposals":[]}',
    );
  });

  it("accepts a completed SSE body terminated by EOF", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode([
          `data: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: '{"proposals":[]}',
          })}`,
          `data: ${JSON.stringify({
            type: "response.completed",
            response: { status: "completed" },
          })}`,
          "",
        ].join("\n\n")));
        controller.close();
      },
    });
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      timeoutMs: 25,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).resolves.toBe(
      '{"proposals":[]}',
    );
  });

  it("sends account-bound identity headers and returns completed SSE text", async () => {
    const content = '{"proposals":[]}';
    const stream = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: content })}`,
      `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const accessToken = jwt("account-123");
    const provider = new CodexResponsesProvider({
      accessToken,
      model: "gpt-5.6-sol",
      fetch: request,
    });

    expect(await provider.generate({ achievements: [], requirements: [] })).toBe(content);
    const headers = new Headers(request.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${accessToken}`);
    expect(headers.get("ChatGPT-Account-ID")).toBe("account-123");
    expect(headers.get("originator")).toBe("career-forge");
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: "gpt-5.6-sol", store: false, stream: true });
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body.input[0].content[0].type).toBe("input_text");
  });

  it("fails closed when the stream has no successful terminal event", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: request,
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).rejects.toThrow(
      /terminal|completed/i,
    );
  });

  it("rejects malformed or non-completed terminal events", async () => {
    for (const response of [{}, { status: "failed" }, { status: "incomplete" }]) {
      const stream = [
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}`,
        `data: ${JSON.stringify({ type: "response.completed", response })}`,
        "",
      ].join("\n\n");
      const provider = new CodexResponsesProvider({
        accessToken: jwt("account-123"),
        model: "gpt-5.6-sol",
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })),
      });

      await expect(provider.generate({ achievements: [], requirements: [] })).rejects.toThrow();
    }
  });

  it("rejects events received after the completed terminal event", async () => {
    const stream = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "complete" })}`,
      `data: ${JSON.stringify({
        type: "response.completed",
        response: { status: "completed" },
      })}`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "late" })}`,
      "",
    ].join("\n\n");
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).rejects.toThrow(
      /after completion/i,
    );
  });

  it("rejects a delayed chunk received after the completed terminal event", async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode([
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "complete" })}`,
          `data: ${JSON.stringify({
            type: "response.completed",
            response: { status: "completed" },
          })}`,
          "",
        ].join("\n\n")));
        timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({
              type: "response.output_text.delta",
              delta: "late",
            })}\n\n`,
          ));
          controller.close();
        }, 10);
      },
      cancel() {
        if (timer) clearTimeout(timer);
      },
    });
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      timeoutMs: 100,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).rejects.toThrow(
      /after completion/i,
    );
  });

  it("accepts equal delta, output-item, and completed-response output", async () => {
    const content = '{"proposals":[]}';
    const message = {
      type: "message",
      content: [{ type: "output_text", text: content }],
    };
    const stream = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: content })}`,
      `data: ${JSON.stringify({ type: "response.output_item.done", item: message })}`,
      `data: ${JSON.stringify({
        type: "response.completed",
        response: { status: "completed", output: [message] },
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).resolves.toBe(content);
  });

  it("rejects inconsistent delta and completed-response output", async () => {
    const stream = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}`,
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "different" }],
          }],
        },
      })}`,
      "",
    ].join("\n\n");
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).rejects.toThrow(
      /inconsistent/i,
    );
  });

  it("rejects oversized responses before parsing them", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("small", {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "content-length": String(300 * 1024),
      },
    }));
    const provider = new CodexResponsesProvider({
      accessToken: jwt("account-123"),
      model: "gpt-5.6-sol",
      fetch: request,
    });

    await expect(provider.generate({ achievements: [], requirements: [] })).rejects.toThrow(
      /size limit/i,
    );
  });
});

describe("strict compact access tokens", () => {
  it("extracts expiry only when every compact-token segment is valid", () => {
    const token = jwt("account-123");
    const [header, payload, signature] = token.split(".");

    expect(extractAccessTokenExpiry(token)).toBe(4_000_000_000_000);
    expect(extractAccessTokenExpiry(`!!.${payload}.${signature}`)).toBeUndefined();
    expect(extractAccessTokenExpiry(`${header}.${payload}.!!`)).toBeUndefined();
  });
});

describe("ChatGPT account binding", () => {
  it("extracts the account id without accepting malformed tokens", () => {
    expect(extractChatGptAccountId(jwt("account-123"))).toBe("account-123");
    expect(extractChatGptAccountId("not-a-jwt")).toBeUndefined();
  });

  it("rejects malformed header and signature routing-hint segments", () => {
    const [header, payload, signature] = jwt("account-123").split(".");

    expect(extractChatGptAccountId(`!!.${payload}.${signature}`)).toBeUndefined();
    expect(extractChatGptAccountId(`%%.${payload}.${signature}`)).toBeUndefined();
    expect(extractChatGptAccountId(`${header}.${payload}.!!`)).toBeUndefined();
    expect(extractChatGptAccountId(`${header}.${payload}.%%`)).toBeUndefined();
    const nonJsonHeader = Buffer.from("not-json").toString("base64url");
    const invalidUtf8Header = Buffer.from([0xff]).toString("base64url");
    expect(extractChatGptAccountId(`${nonJsonHeader}.${payload}.${signature}`)).toBeUndefined();
    expect(extractChatGptAccountId(`${invalidUtf8Header}.${payload}.${signature}`)).toBeUndefined();
  });

  it("rejects noncanonical, oversized, and invalid routing-hint claims", () => {
    const valid = jwt("account-123");
    const [header, payload, signature] = valid.split(".");
    expect(extractChatGptAccountId(`${header}.${payload}.${signature}.extra`)).toBeUndefined();
    expect(extractChatGptAccountId(`${header}.${payload}=.${signature}`)).toBeUndefined();
    expect(extractChatGptAccountId(jwt("account id with spaces"))).toBeUndefined();

    const oversizedPayload = Buffer.from(JSON.stringify({
      padding: "x".repeat(20_000),
      "https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
    })).toString("base64url");
    expect(extractChatGptAccountId(`${header}.${oversizedPayload}.${signature}`)).toBeUndefined();

    const oversizedHeader = Buffer.from(JSON.stringify({
      padding: "x".repeat(5_000),
    })).toString("base64url");
    expect(extractChatGptAccountId(`${oversizedHeader}.${payload}.${signature}`)).toBeUndefined();

    const oversizedSignature = Buffer.alloc(9_000, 1).toString("base64url");
    expect(extractChatGptAccountId(`${header}.${payload}.${oversizedSignature}`)).toBeUndefined();

    const largeHeader = Buffer.from(JSON.stringify({
      padding: "x".repeat(3_800),
    })).toString("base64url");
    const largePayload = Buffer.from(JSON.stringify({
      padding: "x".repeat(15_000),
      "https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
    })).toString("base64url");
    const largeSignature = Buffer.alloc(6_000, 1).toString("base64url");
    expect(
      extractChatGptAccountId(`${largeHeader}.${largePayload}.${largeSignature}`),
    ).toBeUndefined();
  });
});
