import { createHash } from "node:crypto";
import {
  DEFAULT_CODEX_MODEL,
  CodexConnectionService,
} from "./codex-connection";
import { getRepository } from "./database";
import { createCredentialBox } from "./secret-box";

export type CodexRuntimeStatus =
  | { available: true }
  | { available: false; reason: "disabled" | "misconfigured" };

interface CodexRuntimeConfig {
  encryptionKey: string;
  model: string;
  fingerprint: string;
}

let codexConnectionService: CodexConnectionService | undefined;
let codexConfigFingerprint: string | undefined;

function clearCachedService(): void {
  codexConnectionService = undefined;
  codexConfigFingerprint = undefined;
}

export function resetCodexRuntimeForTests(): void {
  clearCachedService();
}

function parseCodexRuntimeConfig(): CodexRuntimeConfig | null {
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY ?? "";
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encryptionKey) ||
    encryptionKey.length % 4 !== 0
  ) {
    return null;
  }

  const decodedKey = Buffer.from(encryptionKey, "base64");
  if (
    decodedKey.length !== 32 ||
    decodedKey.toString("base64") !== encryptionKey
  ) {
    return null;
  }

  const model = process.env.CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL;
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) {
    return null;
  }

  return {
    encryptionKey,
    model,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([encryptionKey, model]))
      .digest("hex"),
  };
}

export function getCodexRuntimeStatus(): CodexRuntimeStatus {
  if (process.env.CODEX_OAUTH_ENABLED !== "true") {
    clearCachedService();
    return {
      available: false,
      reason: "disabled",
    };
  }

  if (!parseCodexRuntimeConfig()) {
    clearCachedService();
    return {
      available: false,
      reason: "misconfigured",
    };
  }

  return { available: true };
}

export function getCodexConnectionService(): CodexConnectionService | null {
  if (process.env.CODEX_OAUTH_ENABLED !== "true") {
    clearCachedService();
    return null;
  }

  const config = parseCodexRuntimeConfig();
  if (!config) {
    clearCachedService();
    return null;
  }

  if (
    !codexConnectionService ||
    codexConfigFingerprint !== config.fingerprint
  ) {
    const credentialBox = createCredentialBox(config.encryptionKey);
    codexConnectionService = new CodexConnectionService({
      repository: getRepository(),
      credentialBox,
      defaultModel: config.model,
    });
    codexConfigFingerprint = config.fingerprint;
  }
  return codexConnectionService;
}
