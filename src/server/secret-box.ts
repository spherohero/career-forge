import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";

export interface CredentialContext {
  identity: string;
  provider: "openai-codex";
  purpose: "connection" | "device-flow";
  recordId: string;
}

export interface CredentialBox {
  seal(plaintext: string, context: CredentialContext): string;
  open(ciphertext: string, context: CredentialContext): string;
}

function contextAad(context: CredentialContext): Buffer {
  const identity = context.identity.normalize("NFC").trim().toLowerCase();
  const recordId = context.recordId.normalize("NFC").trim();
  if (
    !identity || identity.length > 320 ||
    !recordId || recordId.length > 320 || recordId !== context.recordId
  ) {
    throw new Error("A valid credential context is required.");
  }
  return Buffer.from(JSON.stringify([
    "career-forge",
    "credential",
    VERSION,
    identity,
    context.provider,
    context.purpose,
    recordId,
  ]), "utf8");
}

function decodeKey(encodedKey: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey) || encodedKey.length % 4 !== 0) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function decodeBase64Url(encoded: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Invalid Base64URL encoding.");
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded) {
    throw new Error("Noncanonical Base64URL encoding.");
  }
  return decoded;
}

export function createCredentialBox(encodedKey: string): CredentialBox {
  const key = decodeKey(encodedKey);
  return {
    seal(plaintext: string, context: CredentialContext): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(contextAad(context));
      const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        VERSION,
        iv.toString("base64url"),
        encrypted.toString("base64url"),
        tag.toString("base64url"),
      ].join(".");
    },

    open(ciphertext: string, context: CredentialContext): string {
      try {
        const [version, encodedIv, encodedCiphertext, encodedTag, extra] =
          ciphertext.split(".");
        if (
          version !== VERSION ||
          !encodedIv ||
          !encodedCiphertext ||
          !encodedTag ||
          extra
        ) {
          throw new Error("Invalid encrypted credential format.");
        }
        const iv = decodeBase64Url(encodedIv);
        const encrypted = decodeBase64Url(encodedCiphertext);
        const tag = decodeBase64Url(encodedTag);
        if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
          throw new Error("Invalid encrypted credential payload.");
        }
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(contextAad(context));
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new Error("Unable to decrypt credential.");
      }
    },
  };
}
