export type AuthMode = "disabled" | "authelia";

export interface AuthConfig {
  mode: AuthMode;
  allowedGroups: string[];
  allowedUsers: string[];
}

export type AuthorizationResult =
  | { allowed: true; identity: string }
  | { allowed: false; reason: "missing-identity" | "insufficient-access" };

export function canonicalizeIdentity(identity: string): string {
  return identity.normalize("NFC").trim().toLowerCase();
}

function normalizeValues(values: string[]): string[] {
  return values.map(canonicalizeIdentity).filter(Boolean);
}

export function authorizeRequest(
  headers: Headers,
  config: AuthConfig,
): AuthorizationResult {
  if (config.mode === "disabled") {
    return { allowed: true, identity: "local-development" };
  }

  const identity = canonicalizeIdentity(headers.get("remote-user") ?? "");
  if (!identity) {
    return { allowed: false, reason: "missing-identity" };
  }

  const allowedUsers = normalizeValues(config.allowedUsers);
  const allowedGroups = new Set(normalizeValues(config.allowedGroups));
  const requestGroups = normalizeValues(
    (headers.get("remote-groups") ?? "").split(","),
  );

  if (
    allowedUsers.includes(identity) ||
    requestGroups.some((group) => allowedGroups.has(group))
  ) {
    return { allowed: true, identity };
  }

  return { allowed: false, reason: "insufficient-access" };
}

function parseList(value: string | undefined): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const mode =
    env.AUTH_MODE === "authelia" || env.NODE_ENV === "production"
      ? "authelia"
      : "disabled";

  return {
    mode,
    allowedGroups: parseList(env.AUTH_ALLOWED_GROUPS ?? "admins"),
    allowedUsers: parseList(env.AUTH_ALLOWED_USERS),
  };
}
