// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexConnectionService } from "@/server/codex-connection";
import { CareerRepository } from "@/server/repository";
import { createCredentialBox } from "@/server/secret-box";
import * as actions from "./actions";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  runtime: vi.fn(),
  revalidate: vi.fn(),
  start: vi.fn(), complete: vi.fn(), updateModel: vi.fn(), disconnect: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/server/codex-runtime", () => ({ getCodexConnectionService: mocks.runtime }));

const idle = { status: "idle" as const };
const denied = { status: "error", message: "You are not authorized to manage this connection." };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "authelia");
  vi.stubEnv("AUTH_ALLOWED_GROUPS", "admins");
  vi.stubEnv("AUTH_ALLOWED_USERS", "");
  mocks.headers.mockResolvedValue(new Headers({ "remote-user": " ALICE ", "remote-groups": "admins" }));
  mocks.runtime.mockReturnValue(mocks);
});

const flowId = "c748de77-4090-4df2-8418-964be30d2bb9";
const flow = { flowId, userCode: "TEST-CODE", verificationUrl: "https://auth.openai.com/codex/device", expiresAt: "2026-09-06T00:00:00.000Z" };
const secrets = { accessToken: "secret-access", refreshToken: "secret-refresh", credentialCiphertext: "secret-cipher", stateCiphertext: "secret-state", identity: "bob" };
const forged = { status: "idle" as const, ...secrets, flow: { ...flow, verificationUrl: "https://evil.invalid" } };
const unavailable = { status: "unavailable", message: "Codex connection is unavailable on this deployment." };
const failed = { status: "error", message: "Unable to manage the Codex connection. Please try again." };

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

afterEach(() => vi.unstubAllEnvs());

const actionCases = [
  { name: "start", action: actions.startCodexConnectionAction, method: mocks.start },
  { name: "complete", action: actions.completeCodexConnectionAction, method: mocks.complete },
  { name: "update model", action: actions.updateCodexModelAction, method: mocks.updateModel },
  { name: "disconnect", action: actions.disconnectCodexAction, method: mocks.disconnect },
];

describe.each(actionCases)("$name security boundary", ({ action, method }) => {
  it.each(["missing identity", "insufficient group"])("denies %s even with forged state and form credentials", async (mode) => {
    mocks.headers.mockResolvedValue(mode === "missing identity" ? new Headers() : new Headers({ "remote-user": "bob", "remote-groups": "guests" }));
    expect(await action(forged, form({ identity: "alice", "remote-user": "alice", "remote-groups": "admins", flowId, model: "gpt-5.6-sol" }))).toEqual(denied);
    expect(mocks.headers).toHaveBeenCalledOnce();
    expect(mocks.runtime).not.toHaveBeenCalled();
    for (const item of actionCases) expect(item.method).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(["null", "factory throws", "service throws", "headers throw"])("returns only fixed safe text on %s", async (mode) => {
    const error = new Error(JSON.stringify(secrets), { cause: secrets });
    if (mode === "null") mocks.runtime.mockReturnValue(null);
    if (mode === "factory throws") mocks.runtime.mockImplementation(() => { throw error; });
    if (mode === "service throws") method.mockImplementation(() => { throw error; });
    if (mode === "headers throw") mocks.headers.mockRejectedValue(error);
    expect(await action(forged, form({ flowId, model: "gpt-5.6-sol" }))).toEqual(mode === "null" ? unavailable : failed);
    if (mode !== "service throws") expect(method).not.toHaveBeenCalled();
  });
});

describe("Codex settings actions", () => {
  it("revalidates completion failures because the service may delete expired flows", async () => {
    mocks.complete.mockRejectedValue(new Error("synthetic expired flow"));
    expect(await actions.completeCodexConnectionAction(idle, form({ flowId }))).toEqual(failed);
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/settings");
  });

  it("exports only the four asynchronous action entry points at runtime", () => {
    expect(Object.keys(actions).sort()).toEqual([
      "completeCodexConnectionAction", "disconnectCodexAction", "startCodexConnectionAction", "updateCodexModelAction",
    ]);
  });

  it("deletes real pending flows and connection only for the header owner", async () => {
    const repository = CareerRepository.inMemory();
    try {
      const service = new CodexConnectionService({ repository, credentialBox: createCredentialBox(Buffer.alloc(32, 9).toString("base64")) });
      mocks.runtime.mockReturnValue(service);
      const otherFlowId = "c748de77-4090-4df2-8418-964be30d2bb8";
      for (const [identity, id] of [["alice", flowId], ["bob", otherFlowId]]) {
        repository.createAiDeviceFlow({ id, identity, provider: "openai-codex", stateCiphertext: "synthetic-state", expiresAt: flow.expiresAt });
        repository.upsertAiConnection({ identity, provider: "openai-codex", credentialCiphertext: "synthetic-ciphertext", expiresAt: flow.expiresAt, model: "gpt-5.6-sol", status: "connected" });
      }
      expect(await actions.disconnectCodexAction(forged, form({ identity: "bob" }))).toMatchObject({ status: "disconnected" });
      expect(repository.getAiDeviceFlow(flowId, "alice")).toBeNull();
      expect(repository.getAiConnection("alice")).toBeNull();
      expect(repository.getAiDeviceFlow(otherFlowId, "bob")).not.toBeNull();
      expect(repository.getAiConnection("bob")).not.toBeNull();
    } finally {
      repository.close();
    }
  });
  it("starts for the canonical header owner with an exact safe flow projection", async () => {
    mocks.start.mockResolvedValue({ ...flow, ...secrets });
    expect(await actions.startCodexConnectionAction(forged, form({ identity: "bob" }))).toEqual({
      status: "started", message: "Authorize the device code with OpenAI, then finish connecting.", flow,
    });
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith("alice");
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/settings");
  });

  it.each(["null", "factory throws", "service throws"])("handles start %s without secret diagnostics", async (mode) => {
    if (mode === "null") mocks.runtime.mockReturnValue(null);
    if (mode === "factory throws") mocks.runtime.mockImplementation(() => { throw new Error(JSON.stringify(secrets)); });
    if (mode === "service throws") mocks.start.mockRejectedValue(new Error(JSON.stringify(secrets)));
    expect(await actions.startCodexConnectionAction(forged, form())).toEqual(mode === "null" ? unavailable : failed);
  });
  it.each(["pending", "connected"])("completes as %s without trusting or echoing previous state", async (status) => {
    mocks.complete.mockResolvedValue({ status, model: "gpt-5.6-sol", ...secrets });
    const result = await actions.completeCodexConnectionAction(forged, form({ identity: "bob", flowId }));
    expect(result).toEqual(status === "pending" ? {
      status: "pending", flowId, message: "Authorization is not complete. Finish authorizing with OpenAI, then try again.",
    } : { status: "connected", model: "gpt-5.6-sol", message: "Codex connected." });
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith("alice", flowId);
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/settings");
  });

  it.each([undefined, "", "not-a-uuid", ` ${flowId}`, `${flowId}\n`, "00000000-0000-4000-0000-000000000000", new File(["x"], "flow.txt")])("rejects malformed flow %s without polling", async (value) => {
    const data = form();
    if (value !== undefined) data.set("flowId", value);
    expect(await actions.completeCodexConnectionAction(forged, data)).toEqual({ status: "error", message: "Choose a valid Codex authorization flow." });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("updates only the header owner's model and never serializes the raw connection", async () => {
    mocks.updateModel.mockReturnValue({ model: "gpt-5.6-sol", ...secrets, status: "reauth_required", connectedAt: "private-date" });
    expect(await actions.updateCodexModelAction(forged, form({ identity: "bob", model: " gpt-5.6-sol " }))).toEqual({
      status: "model-updated", model: "gpt-5.6-sol", message: "Codex model updated.",
    });
    expect(mocks.updateModel).toHaveBeenCalledExactlyOnceWith("alice", "gpt-5.6-sol");
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/settings");
  });

  it("does not claim a model update when no connection exists", async () => {
    mocks.updateModel.mockReturnValue(null);
    expect(await actions.updateCodexModelAction(idle, form({ model: "gpt-5.6-sol" }))).toEqual({
      status: "error", message: "Connect Codex before changing the model.",
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([undefined, "", " ", "model with spaces", "x?y", "x".repeat(121), new File(["x"], "model.txt")])("rejects malformed model %s", async (value) => {
    const data = form();
    if (value !== undefined) data.set("model", value);
    expect(await actions.updateCodexModelAction(forged, data)).toEqual({ status: "error", message: "Enter a valid Codex model identifier." });
    expect(mocks.updateModel).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([true, false])("disconnects only the header owner, including pending flows (deleted=%s)", async (deleted) => {
    mocks.disconnect.mockReturnValue(deleted);
    expect(await actions.disconnectCodexAction(forged, form({ identity: "bob" }))).toEqual({ status: "disconnected", message: "Codex disconnected from Career Forge. Pending authorization flows were cleared." });
    expect(mocks.disconnect).toHaveBeenCalledExactlyOnceWith("alice");
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/settings");
  });

  it("denies start without an authenticated identity before runtime access", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    expect(await actions.startCodexConnectionAction(idle, new FormData())).toEqual(denied);
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
});
