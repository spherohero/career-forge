import { describe, expect, it } from "vitest";
import { authorizeRequest, getAuthConfig } from "./auth";

describe("authorizeRequest", () => {
  it("allows local development when auth is disabled", () => {
    expect(
      authorizeRequest(new Headers(), {
        mode: "disabled",
        allowedGroups: ["admins"],
        allowedUsers: [],
      }),
    ).toEqual({ allowed: true, identity: "local-development" });
  });

  it("rejects an Authelia request with no identity", () => {
    expect(
      authorizeRequest(new Headers(), {
        mode: "authelia",
        allowedGroups: ["admins"],
        allowedUsers: [],
      }),
    ).toEqual({ allowed: false, reason: "missing-identity" });
  });

  it("allows a member of an authorized group", () => {
    const headers = new Headers({
      "remote-user": "group-member@example.test",
      "remote-groups": "dev, admins",
    });

    expect(
      authorizeRequest(headers, {
        mode: "authelia",
        allowedGroups: ["admins"],
        allowedUsers: [],
      }),
    ).toEqual({ allowed: true, identity: "group-member@example.test" });
  });

  it("rejects an authenticated user outside authorized groups", () => {
    const headers = new Headers({
      "remote-user": "viewer@example.test",
      "remote-groups": "readers, guests",
    });

    expect(
      authorizeRequest(headers, {
        mode: "authelia",
        allowedGroups: ["admins"],
        allowedUsers: [],
      }),
    ).toEqual({ allowed: false, reason: "insufficient-access" });
  });

  it("can authorize an explicitly allowed user", () => {
    const headers = new Headers({ "remote-user": "allowed-user@example.test" });

    expect(
      authorizeRequest(headers, {
        mode: "authelia",
        allowedGroups: [],
        allowedUsers: ["allowed-user@example.test"],
      }),
    ).toEqual({ allowed: true, identity: "allowed-user@example.test" });
  });

  it("returns a trimmed lowercase NFC identity", () => {
    const values = new Map([
      ["remote-user", "  CAFE\u0301@Example.TEST  "],
      ["remote-groups", "ADMINS"],
    ]);
    const headers = { get: (name: string) => values.get(name) ?? null } as Headers;

    expect(authorizeRequest(headers, {
      mode: "authelia",
      allowedGroups: ["admins"],
      allowedUsers: [],
    })).toEqual({ allowed: true, identity: "caf\u00e9@example.test" });
  });
});

describe("getAuthConfig", () => {
  it("fails closed to Authelia in production when AUTH_MODE is omitted", () => {
    expect(getAuthConfig({ NODE_ENV: "production" })).toMatchObject({
      mode: "authelia",
      allowedGroups: ["admins"],
    });
  });

  it("uses the local bypass only outside production", () => {
    expect(getAuthConfig({ NODE_ENV: "development" }).mode).toBe("disabled");
  });
});
