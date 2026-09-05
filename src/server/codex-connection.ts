import { z } from "zod";
import { randomUUID } from "node:crypto";
import { canonicalizeIdentity } from "@/lib/auth";
import type { TailoringProvider } from "@/lib/model";
import {
  CODEX_VERIFICATION_URL,
  CodexOAuthClient,
  CodexOAuthError,
  CodexResponsesProvider,
  extractAccessTokenExpiry,
  type CodexAuthorizationPoll,
  type CodexDeviceAuthorization,
  type CodexTokens,
} from "./codex-client";
import type { AiConnection, CareerRepository } from "./repository";
import type { CredentialBox } from "./secret-box";

const FLOW_LIFETIME_MS = 15 * 60 * 1000;
const REFRESH_SKEW_MS = 2 * 60 * 1000;
export const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";

const deviceStateSchema = z.object({
  userCode: z.string().min(1),
  deviceAuthId: z.string().min(1),
  pollIntervalSeconds: z.number().int().min(3).max(60),
  nextAllowedPollAt: z.string().refine(
    (value) => parseIsoTimestamp(value) !== undefined,
    "Invalid ISO timestamp.",
  ).optional(),
}).strict();

const credentialSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
}).strict();

interface CodexClient {
  requestDeviceCode(): Promise<CodexDeviceAuthorization>;
  pollDeviceAuthorization(
    device: CodexDeviceAuthorization,
  ): Promise<CodexAuthorizationPoll>;
  exchangeAuthorization(
    authorization: Extract<CodexAuthorizationPoll, { status: "authorized" }>,
  ): Promise<CodexTokens>;
  refreshTokens(refreshToken: string): Promise<CodexTokens>;
}

interface ServiceOptions {
  repository: CareerRepository;
  credentialBox: CredentialBox;
  client?: CodexClient;
  providerFactory?: (options: {
    accessToken: string;
    model: string;
  }) => TailoringProvider;
  now?: () => Date;
  defaultModel?: string;
}

export interface CodexConnectionStatus {
  enabled: true;
  connected: boolean;
  reauthRequired: boolean;
  model?: string;
  connectedAt?: string;
}

function validateIdentity(identity: string): string {
  const normalized = canonicalizeIdentity(identity);
  if (!normalized || normalized.length > 320) {
    throw new Error("A valid authenticated identity is required.");
  }
  return normalized;
}

function validateModel(model: string): string {
  const normalized = model.trim();
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(normalized)) {
    throw new Error("Enter a valid Codex model identifier.");
  }
  return normalized;
}

function parseIsoTimestamp(value: string): number | undefined {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  try {
    return new Date(timestamp).toISOString() === value ? timestamp : undefined;
  } catch {
    return undefined;
  }
}

export class CodexConnectionService {
  private readonly repository: CareerRepository;
  private readonly credentialBox: CredentialBox;
  private readonly client: CodexClient;
  private readonly providerFactory: ServiceOptions["providerFactory"];
  private readonly now: () => Date;
  private readonly defaultModel: string;
  private readonly completionPromises = new Map<
    string,
    Promise<{ status: "pending" } | { status: "connected"; model: string }>
  >();
  private readonly refreshPromises = new Map<string, Promise<AiConnection | null>>();

  constructor(options: ServiceOptions) {
    this.repository = options.repository;
    this.credentialBox = options.credentialBox;
    this.client = options.client ?? new CodexOAuthClient();
    this.providerFactory = options.providerFactory ?? ((providerOptions) => (
      new CodexResponsesProvider(providerOptions)
    ));
    this.now = options.now ?? (() => new Date());
    this.defaultModel = validateModel(options.defaultModel ?? DEFAULT_CODEX_MODEL);
  }

  async start(identity: string): Promise<{
    flowId: string;
    userCode: string;
    verificationUrl: string;
    expiresAt: string;
  }> {
    const owner = validateIdentity(identity);
    const device = await this.client.requestDeviceCode();
    const flowId = randomUUID();
    const expiresAt = new Date(this.now().getTime() + FLOW_LIFETIME_MS).toISOString();
    const flow = this.repository.createAiDeviceFlow({
      id: flowId,
      identity: owner,
      provider: "openai-codex",
      stateCiphertext: this.credentialBox.seal(JSON.stringify(device), {
        identity: owner,
        provider: "openai-codex",
        purpose: "device-flow",
        recordId: flowId,
      }),
      expiresAt,
    });
    return {
      flowId: flow.id,
      userCode: device.userCode,
      verificationUrl: CODEX_VERIFICATION_URL,
      expiresAt,
    };
  }

  complete(
    identity: string,
    flowId: string,
  ): Promise<{ status: "pending" } | { status: "connected"; model: string }> {
    const owner = validateIdentity(identity);
    const key = `${owner}\0${flowId}`;
    const existing = this.completionPromises.get(key);
    if (existing) return existing;
    const pending = this.completeOnce(owner, flowId);
    this.completionPromises.set(key, pending);
    void pending.finally(() => {
      if (this.completionPromises.get(key) === pending) {
        this.completionPromises.delete(key);
      }
    }).catch(() => undefined);
    return pending;
  }

  private async completeOnce(
    owner: string,
    flowId: string,
  ): Promise<{ status: "pending" } | { status: "connected"; model: string }> {
    const flow = this.repository.getAiDeviceFlow(flowId, owner);
    if (!flow) throw new Error("Codex authorization flow was not found.");
    const flowExpiry = parseIsoTimestamp(flow.expiresAt);
    if (flowExpiry === undefined) {
      this.repository.deleteAiDeviceFlow(flow.id, owner);
      throw new Error("Codex authorization flow has invalid persisted state.");
    }
    if (flowExpiry <= this.now().getTime()) {
      this.repository.deleteAiDeviceFlow(flow.id, owner);
      throw new Error("Codex authorization flow expired. Start again.");
    }

    const device = deviceStateSchema.parse(JSON.parse(
      this.credentialBox.open(flow.stateCiphertext, {
        identity: owner,
        provider: "openai-codex",
        purpose: "device-flow",
        recordId: flow.id,
      }),
    ));
    if (
      device.nextAllowedPollAt &&
      new Date(device.nextAllowedPollAt).getTime() > this.now().getTime()
    ) return { status: "pending" };
    let authorization: CodexAuthorizationPoll;
    try {
      authorization = await this.client.pollDeviceAuthorization(device);
    } catch (error) {
      if (error instanceof CodexOAuthError &&
          (error.kind === "denied" || error.kind === "expired" ||
            error.kind === "protocol")) {
        this.repository.deleteAiDeviceFlow(flow.id, owner);
      }
      throw error;
    }
    if (authorization.status === "pending") {
      const pollIntervalSeconds = authorization.slowDown
        ? Math.min(60, device.pollIntervalSeconds + 5)
        : device.pollIntervalSeconds;
      const nextState = {
        userCode: device.userCode,
        deviceAuthId: device.deviceAuthId,
        pollIntervalSeconds,
        nextAllowedPollAt: new Date(
          this.now().getTime() + pollIntervalSeconds * 1000,
        ).toISOString(),
      };
      this.repository.updateAiDeviceFlowState(
        flow.id,
        owner,
        this.credentialBox.seal(JSON.stringify(nextState), {
          identity: owner,
          provider: "openai-codex",
          purpose: "device-flow",
          recordId: flow.id,
        }),
      );
      return { status: "pending" };
    }

    const nextExchangeAttemptState = {
      userCode: device.userCode,
      deviceAuthId: device.deviceAuthId,
      pollIntervalSeconds: device.pollIntervalSeconds,
      nextAllowedPollAt: new Date(
        this.now().getTime() + device.pollIntervalSeconds * 1000,
      ).toISOString(),
    };
    const updatedFlow = this.repository.updateAiDeviceFlowState(
      flow.id,
      owner,
      this.credentialBox.seal(JSON.stringify(nextExchangeAttemptState), {
        identity: owner,
        provider: "openai-codex",
        purpose: "device-flow",
        recordId: flow.id,
      }),
    );
    if (!updatedFlow) {
      throw new Error("Codex authorization flow was not found.");
    }

    let tokens: CodexTokens;
    try {
      tokens = await this.client.exchangeAuthorization(authorization);
    } catch (error) {
      if (error instanceof CodexOAuthError &&
          (error.kind === "credential_rejected" || error.kind === "protocol")) {
        this.repository.deleteAiDeviceFlow(flow.id, owner);
      }
      throw error;
    }
    const existingModel = this.repository.getAiConnection(owner)?.model;
    const model = validateModel(existingModel ?? this.defaultModel);
    const connection = this.repository.consumeAiDeviceFlowAndUpsertConnection({
      flowId: flow.id,
      identity: owner,
      expectedStateCiphertext: updatedFlow.stateCiphertext,
      connection: this.buildConnection(owner, model, tokens, "connected"),
    });
    if (!connection) {
      throw new Error("Codex authorization flow was superseded or disconnected.");
    }
    return { status: "connected", model };
  }

  getStatus(identity: string): CodexConnectionStatus {
    const owner = validateIdentity(identity);
    const connection = this.repository.getAiConnection(owner);
    let usable = false;
    let model: string | undefined;
    try {
      if (connection) model = validateModel(connection.model);
    } catch {
      model = undefined;
    }
    if (connection?.status === "connected" &&
        model !== undefined &&
        parseIsoTimestamp(connection.expiresAt) !== undefined) {
      try {
        credentialSchema.parse(JSON.parse(this.credentialBox.open(
          connection.credentialCiphertext,
          {
            identity: owner,
            provider: "openai-codex",
            purpose: "connection",
            recordId: owner,
          },
        )));
        usable = true;
      } catch {
        usable = false;
      }
    }
    return {
      enabled: true,
      connected: usable,
      reauthRequired: connection?.status === "reauth_required",
      model,
      connectedAt: connection?.connectedAt,
    };
  }

  async getProvider(identity: string): Promise<TailoringProvider | null> {
    try {
      return await this.resolveProvider(validateIdentity(identity));
    } catch {
      return null;
    }
  }

  private async resolveProvider(owner: string): Promise<TailoringProvider | null> {
    let connection = this.repository.getAiConnection(owner);
    if (!connection || connection.status !== "connected") return null;
    const expiresAt = parseIsoTimestamp(connection.expiresAt);
    if (expiresAt === undefined) return null;

    let credentials = credentialSchema.parse(JSON.parse(
      this.credentialBox.open(connection.credentialCiphertext, {
        identity: owner,
        provider: "openai-codex",
        purpose: "connection",
        recordId: owner,
      }),
    ));
    if (expiresAt <= this.now().getTime() + REFRESH_SKEW_MS) {
      const staleCiphertext = connection.credentialCiphertext;
      try {
        connection = await this.refreshConnection(owner);
        if (!connection) return null;
        credentials = credentialSchema.parse(JSON.parse(
          this.credentialBox.open(connection.credentialCiphertext, {
            identity: owner,
            provider: "openai-codex",
            purpose: "connection",
            recordId: owner,
          }),
        ));
      } catch (error) {
        if (error instanceof CodexOAuthError && error.kind === "credential_rejected") {
          this.markReauthenticationRequired(owner, staleCiphertext);
        }
        return null;
      }
    }

    return this.createManagedProvider(owner, connection, credentials);
  }

  private createManagedProvider(
    owner: string,
    connection: AiConnection,
    credentials: z.infer<typeof credentialSchema>,
  ): TailoringProvider {
    const initial = this.providerFactory!({
      accessToken: credentials.accessToken,
      model: connection.model,
    });
    return {
      generate: async (input) => {
        try {
          return await initial.generate(input);
        } catch (error) {
          if (!(error instanceof CodexOAuthError) ||
              error.kind !== "credential_rejected" || error.httpStatus !== 401) {
            throw error;
          }

          let refreshed: AiConnection | null;
          try {
            refreshed = await this.refreshConnection(
              owner,
              true,
              connection.credentialCiphertext,
            );
          } catch (refreshError) {
            if (refreshError instanceof CodexOAuthError &&
                refreshError.kind === "credential_rejected") {
              this.markReauthenticationRequired(owner, connection.credentialCiphertext);
            }
            throw refreshError;
          }
          if (!refreshed) throw error;
          const refreshedCredentials = credentialSchema.parse(JSON.parse(
            this.credentialBox.open(refreshed.credentialCiphertext, {
              identity: owner,
              provider: "openai-codex",
              purpose: "connection",
              recordId: owner,
            }),
          ));
          const retry = this.providerFactory!({
            accessToken: refreshedCredentials.accessToken,
            model: refreshed.model,
          });
          try {
            return await retry.generate(input);
          } catch (retryError) {
            if (retryError instanceof CodexOAuthError &&
                retryError.kind === "credential_rejected" &&
                retryError.httpStatus === 401) {
              this.markReauthenticationRequired(owner, refreshed.credentialCiphertext);
            }
            throw retryError;
          }
        }
      },
    };
  }

  private markReauthenticationRequired(owner: string, expectedCiphertext: string): void {
    const current = this.repository.getAiConnection(owner);
    if (current?.status !== "connected" ||
        current.credentialCiphertext !== expectedCiphertext) return;
    this.repository.upsertAiConnection({
      identity: owner,
      provider: "openai-codex",
      credentialCiphertext: current.credentialCiphertext,
      model: current.model,
      expiresAt: current.expiresAt,
      status: "reauth_required",
    });
  }

  private refreshConnection(
    owner: string,
    force = false,
    expectedCiphertext?: string,
  ): Promise<AiConnection | null> {
    const existing = this.refreshPromises.get(owner);
    if (existing) return existing;
    const pending = this.refreshConnectionOnce(owner, force, expectedCiphertext);
    this.refreshPromises.set(owner, pending);
    void pending.finally(() => {
      if (this.refreshPromises.get(owner) === pending) {
        this.refreshPromises.delete(owner);
      }
    }).catch(() => undefined);
    return pending;
  }

  private async refreshConnectionOnce(
    owner: string,
    force: boolean,
    expectedCiphertext?: string,
  ): Promise<AiConnection | null> {
    const connection = this.repository.getAiConnection(owner);
    if (!connection || connection.status !== "connected") return null;
    if (expectedCiphertext && connection.credentialCiphertext !== expectedCiphertext) {
      return connection;
    }
    const expiresAt = parseIsoTimestamp(connection.expiresAt);
    if (expiresAt === undefined) return null;
    if (!force && expiresAt > this.now().getTime() + REFRESH_SKEW_MS) {
      return connection;
    }
    const credentials = credentialSchema.parse(JSON.parse(
      this.credentialBox.open(connection.credentialCiphertext, {
        identity: owner,
        provider: "openai-codex",
        purpose: "connection",
        recordId: owner,
      }),
    ));
    const refreshed = await this.client.refreshTokens(credentials.refreshToken);
    const current = this.repository.getAiConnection(owner);
    if (!current || current.status !== "connected") return null;
    if (current.credentialCiphertext !== connection.credentialCiphertext) {
      return current;
    }
    return this.saveConnection(owner, current.model, refreshed, "connected");
  }

  updateModel(identity: string, model: string): AiConnection | null {
    return this.repository.updateAiConnectionModel(
      validateIdentity(identity),
      validateModel(model),
    );
  }

  disconnect(identity: string): boolean {
    return this.repository.deleteAiConnectionAndDeviceFlows(validateIdentity(identity));
  }

  private saveConnection(
    identity: string,
    model: string,
    tokens: CodexTokens,
    status: AiConnection["status"],
  ): AiConnection {
    return this.repository.upsertAiConnection({
      identity,
      ...this.buildConnection(identity, model, tokens, status),
    });
  }

  private buildConnection(
    identity: string,
    model: string,
    tokens: CodexTokens,
    status: AiConnection["status"],
  ): Omit<AiConnection, "identity" | "connectedAt" | "updatedAt"> {
    const expiresAt = new Date(
      extractAccessTokenExpiry(tokens.accessToken) ??
        this.now().getTime() + tokens.expiresInSeconds * 1000,
    ).toISOString();
    return {
      provider: "openai-codex",
      credentialCiphertext: this.credentialBox.seal(
        JSON.stringify({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),
        {
          identity,
          provider: "openai-codex",
          purpose: "connection",
          recordId: identity,
        },
      ),
      model,
      expiresAt,
      status,
    };
  }
}
