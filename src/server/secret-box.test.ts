import { describe, expect, it } from "vitest";
import { createCredentialBox } from "./secret-box";

const key = Buffer.alloc(32, 7).toString("base64");
const connectionContext = {
  identity: "alex",
  provider: "openai-codex",
  purpose: "connection",
  recordId: "alex",
} as const;

describe("credential encryption", () => {
  it("round-trips a secret without storing plaintext", () => {
    const box = createCredentialBox(key);
    const sealed = box.seal("oauth-access-token", connectionContext);

    expect(sealed).not.toContain("oauth-access-token");
    expect(box.open(sealed, connectionContext)).toBe("oauth-access-token");
  });

  it("rejects modified ciphertext", () => {
    const box = createCredentialBox(key);
    const sealed = box.seal("oauth-refresh-token", connectionContext);
    const replacement = sealed.endsWith("A") ? "B" : "A";

    expect(() => box.open(`${sealed.slice(0, -1)}${replacement}`, connectionContext)).toThrow(
      /decrypt/i,
    );
  });

  it("rejects ciphertext moved across users or record purposes", () => {
    const box = createCredentialBox(key);
    const sealed = box.seal("oauth-secret", connectionContext);

    expect(() => box.open(sealed, { ...connectionContext, identity: "blair" })).toThrow(
      /decrypt/i,
    );
    expect(() => box.open(sealed, { ...connectionContext, purpose: "device-flow" })).toThrow(
      /decrypt/i,
    );
  });

  it("rejects same-owner same-purpose ciphertext replayed into another record", () => {
    const box = createCredentialBox(key);
    const sealed = box.seal("oauth-secret", {
      ...connectionContext,
      purpose: "device-flow",
      recordId: "11111111-1111-4111-8111-111111111111",
    });

    expect(() => box.open(sealed, {
      ...connectionContext,
      purpose: "device-flow",
      recordId: "22222222-2222-4222-8222-222222222222",
    })).toThrow(/decrypt/i);
  });

  it("requires an exact 32-byte base64 key", () => {
    expect(() => createCredentialBox("not-a-key")).toThrow(/32-byte/i);
    expect(() => createCredentialBox(Buffer.alloc(31).toString("base64"))).toThrow(
      /32-byte/i,
    );
  });
});
