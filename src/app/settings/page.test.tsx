import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { getCodexConnectionService, getCodexRuntimeStatus } from "@/server/codex-runtime";
import { CodexConnectionPanel } from "@/components/codex-connection-panel";
import SettingsPage from "./page";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/server/codex-runtime", () => ({ getCodexConnectionService: vi.fn(), getCodexRuntimeStatus: vi.fn() }));
vi.mock("@/components/codex-connection-panel", () => ({ CodexConnectionPanel: vi.fn(() => <div>Safe connection panel</div>) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "authelia");
  vi.stubEnv("AUTH_ALLOWED_GROUPS", "test-admins");
  vi.stubEnv("AUTH_ALLOWED_USERS", "");
});
afterEach(() => vi.unstubAllEnvs());
async function request(user?: string, groups?: string) {
  vi.mocked(headers).mockResolvedValue(new Headers({ ...(user ? { "remote-user": user } : {}), ...(groups ? { "remote-groups": groups } : {}) }) as Awaited<ReturnType<typeof headers>>);
  render(await SettingsPage());
}
describe("SettingsPage authorization", () => {
  it.each(["disabled", "misconfigured"] as const)("does not construct a service when %s", async (reason) => {
    vi.mocked(getCodexRuntimeStatus).mockReturnValue({ available: false, reason });
    await request("demo-user", "test-admins");
    expect(getCodexConnectionService).not.toHaveBeenCalled();
    expect(vi.mocked(CodexConnectionPanel).mock.calls[0][0]).toEqual({ status: { available: false, reason } });
  });
  it.each(["runtime", "factory", "status", "null-service"])("fails safely on %s unavailability", async (failure) => {
    vi.mocked(getCodexRuntimeStatus).mockImplementation(() => { if (failure === "runtime") throw new Error("SECRET-runtime"); return { available: true }; });
    vi.mocked(getCodexConnectionService).mockImplementation(() => {
      if (failure === "factory") throw new Error("SECRET-factory");
      if (failure === "null-service") return null;
      return { getStatus: () => { throw new Error("SECRET-status"); } } as unknown as NonNullable<ReturnType<typeof getCodexConnectionService>>;
    });
    await request("demo-user", "test-admins");
    expect(vi.mocked(CodexConnectionPanel).mock.calls[0][0]).toEqual({ status: { available: false, reason: "unavailable" } });
    expect(document.body.textContent).not.toContain("SECRET");
  });
  it("projects only safe status fields for the canonical authenticated identity", async () => {
    const getStatus = vi.fn().mockReturnValue({ enabled: true, connected: true, reauthRequired: false, model: "configured-model", connectedAt: "2026-09-01T00:00:00.000Z", credentialCiphertext: "SECRET-CIPHERTEXT", accessToken: "SECRET-TOKEN" });
    vi.mocked(getCodexRuntimeStatus).mockReturnValue({ available: true });
    vi.mocked(getCodexConnectionService).mockReturnValue({ getStatus } as unknown as NonNullable<ReturnType<typeof getCodexConnectionService>>);
    await request("  DEMO-USER  ", "test-admins");
    expect(getStatus).toHaveBeenCalledExactlyOnceWith("demo-user");
    expect(vi.mocked(CodexConnectionPanel).mock.calls[0][0]).toEqual({ status: { available: true, connected: true, reauthRequired: false, model: "configured-model", connectedAt: "2026-09-01T00:00:00.000Z" } });
    expect(JSON.stringify(vi.mocked(CodexConnectionPanel).mock.calls)).not.toContain("SECRET");
  });
  it.each([[undefined, undefined], ["demo-user", "outsiders"]])("denies %s/%s before any runtime or connection read", async (user, groups) => {
    await request(user, groups);
    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    expect(getCodexRuntimeStatus).not.toHaveBeenCalled();
    expect(getCodexConnectionService).not.toHaveBeenCalled();
    expect(CodexConnectionPanel).not.toHaveBeenCalled();
    expect(screen.queryByText(/database file/i)).not.toBeInTheDocument();
  });
});
