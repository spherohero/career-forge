import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexConnectionPanel, type CodexPanelStatus } from "./codex-connection-panel";
import * as actions from "@/app/settings/actions";

vi.mock("@/app/settings/actions", () => ({
  startCodexConnectionAction: vi.fn(), completeCodexConnectionAction: vi.fn(),
  updateCodexModelAction: vi.fn(), disconnectCodexAction: vi.fn(),
}));
const disconnected: CodexPanelStatus = { available: true, connected: false, reauthRequired: false };
const connected: CodexPanelStatus = { available: true, connected: true, reauthRequired: false, model: "deployment-model", connectedAt: "2026-09-01T00:00:00.000Z" };
const flow = { flowId: "f1c39c27-b00d-477b-a7e5-c85147420eb2", userCode: "DEMO-CODE", verificationUrl: "https://auth.openai.com/codex/device", expiresAt: "2099-09-05T12:15:00.000Z" };
beforeEach(() => vi.resetAllMocks());
describe("CodexConnectionPanel", () => {
  it.each(["connect", "disconnect"] as const)("announces %s and hands off keyboard focus across the authoritative remount", async (intent) => {
    const connecting = intent === "connect";
    let resolve!: (result: actions.CodexActionState) => void;
    const action = vi.mocked(connecting ? actions.completeCodexConnectionAction : actions.disconnectCodexAction);
    action.mockImplementation(() => new Promise((done) => { resolve = done; }));
    vi.mocked(actions.startCodexConnectionAction).mockResolvedValue({ status: "started", message: "Authorize.", flow });
    const { rerender } = render(<CodexConnectionPanel status={connecting ? disconnected : connected} />);
    if (connecting) {
      fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT / Codex" }));
      await screen.findByText(flow.userCode);
    } else fireEvent.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: connecting ? /finish connecting/i : "Disconnect locally" });
    button.focus();
    // Form submission is also the native keyboard activation path (jsdom does not synthesize Enter clicks).
    fireEvent.submit(button.closest("form")!);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    // Revalidation can replace controls before the old action state is committed.
    rerender(<CodexConnectionPanel status={connecting ? connected : disconnected} />);
    const message = connecting ? "Codex connected." : "Codex disconnected from Career Forge.";
    const announcement = screen.queryByText(message);
    const focusAfterRefresh = document.activeElement;
    await act(async () => resolve(connecting
      ? { status: "connected", message: "STALE action message", model: "stale-model" }
      : { status: "disconnected", message: "STALE action message" }));
    expect(announcement).toBeInTheDocument();
    expect(announcement).toHaveAttribute("role", "status");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(focusAfterRefresh).toBe(announcement);
    expect(screen.queryByText("STALE action message")).not.toBeInTheDocument();
    expect(announcement).toHaveFocus();
    if (connecting) expect(screen.getByRole("textbox", { name: /model/i })).toHaveValue("deployment-model");
    else expect(screen.getByRole("button", { name: "Connect ChatGPT / Codex" })).toBeEnabled();
    const nextControl = screen.getByRole(connecting ? "textbox" : "button", { name: connecting ? /model/i : "Connect ChatGPT / Codex" });
    nextControl.focus();
    rerender(<CodexConnectionPanel status={connecting ? { ...connected, model: "refreshed-model" } : { ...disconnected }} />);
    expect(announcement).toHaveTextContent(message);
    expect(announcement).not.toHaveFocus();
  });

  it("clears obsolete success without announcing a disconnect when reauthorization is required", () => {
    const { rerender } = render(<CodexConnectionPanel status={disconnected} />);
    rerender(<CodexConnectionPanel status={connected} />);
    expect(screen.getByText("Codex connected.")).toHaveFocus();
    const checkbox = screen.getByRole("checkbox");
    checkbox.focus();
    rerender(<CodexConnectionPanel status={{ ...disconnected, reauthRequired: true }} />);
    expect(screen.queryByText("Codex connected.")).not.toBeInTheDocument();
    expect(screen.queryByText("Codex disconnected from Career Forge.")).not.toBeInTheDocument();
    expect(screen.getByText("Reconnect required")).toBeInTheDocument();
  });

  it.each([connected, disconnected, { available: false, reason: "disabled" } as const])("does not announce success or move focus on initial mount or unrelated refresh %#", (status) => {
    const { rerender } = render(<CodexConnectionPanel status={status} />);
    expect(screen.queryByText("Codex connected.")).not.toBeInTheDocument();
    expect(screen.queryByText("Codex disconnected from Career Forge.")).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
    rerender(<CodexConnectionPanel status={{ ...status }} />);
    expect(screen.queryByText("Codex connected.")).not.toBeInTheDocument();
    expect(screen.queryByText("Codex disconnected from Career Forge.")).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });
  it.each(["connected", "disconnected"] as const)("clears the device flow on %s without overriding refreshed status", async (result) => {
    vi.mocked(actions.startCodexConnectionAction).mockResolvedValue({ status: "started", message: "Authorize.", flow });
    vi.mocked(actions.completeCodexConnectionAction).mockResolvedValue({ status: "connected", model: "action-model", message: "Codex connected." });
    vi.mocked(actions.disconnectCodexAction).mockResolvedValue({ status: "disconnected", message: "Codex disconnected." });
    const { rerender } = render(<CodexConnectionPanel status={disconnected} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT / Codex" }));
    await screen.findByText(flow.userCode);
    await waitFor(() => expect(screen.getByText(flow.userCode)).toHaveFocus());
    if (result === "disconnected") {
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Disconnect locally" }));
    } else fireEvent.click(screen.getByRole("button", { name: /finish connecting/i }));
    await screen.findByText(result === "connected" ? "Codex connected." : "Codex disconnected.");
    expect(screen.queryByText(flow.userCode)).not.toBeInTheDocument();
    // Only a server refresh can establish the connected state/model.
    expect(screen.queryByRole("textbox", { name: /model/i })).not.toBeInTheDocument();
    rerender(<CodexConnectionPanel status={connected} />);
    expect(screen.getByRole("textbox", { name: /model/i })).toHaveValue("deployment-model");
    rerender(<CodexConnectionPanel status={disconnected} />);
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Codex connected.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect ChatGPT / Codex" })).toBeEnabled();
  });
  it.each(["start", "finish", "model", "disconnect"] as const)("blocks competing controls while %s is in flight and reports errors", async (intent) => {
    const mock = vi.mocked({ start: actions.startCodexConnectionAction, finish: actions.completeCodexConnectionAction, model: actions.updateCodexModelAction, disconnect: actions.disconnectCodexAction }[intent]);
    let resolve!: (result: actions.CodexActionState) => void;
    mock.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<CodexConnectionPanel status={intent === "model" || intent === "disconnect" ? connected : disconnected} />);
    if (intent === "finish") {
      vi.mocked(actions.startCodexConnectionAction).mockResolvedValue({ status: "started", message: "Authorize.", flow });
      fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT / Codex" }));
      await screen.findByText(flow.userCode);
    }
    if (intent === "disconnect") fireEvent.click(screen.getByRole("checkbox"));
    const name = { start: "Connect ChatGPT / Codex", finish: /finish connecting/i, model: "Save model", disconnect: "Disconnect locally" }[intent];
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    screen.getAllByRole("button").forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByText(/working/i)).toBeInTheDocument();
    await act(async () => resolve({ status: "error", message: "Unable to manage the Codex connection. Please try again." }));
    expect(screen.getByText(/unable to manage/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name })).toBeEnabled();
    if (intent === "finish") expect(screen.getByText(flow.userCode)).toBeInTheDocument();
  });
  it("handles transport rejection without leaking errors", async () => {
    vi.mocked(actions.startCodexConnectionAction).mockRejectedValue(new Error("SECRET transport detail"));
    render(<CodexConnectionPanel status={disconnected} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT / Codex" }));
    expect(await screen.findByText(/unable to manage.*try again/i)).toBeInTheDocument();
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
  });
  it("uses refreshed connection props for model updates, confirmed local disconnect and reconnect", async () => {
    vi.mocked(actions.updateCodexModelAction).mockResolvedValue({ status: "model-updated", model: "chosen-model", message: "Codex model updated." });
    vi.mocked(actions.disconnectCodexAction).mockResolvedValue({ status: "disconnected", message: "Codex disconnected from Career Forge." });
    vi.mocked(actions.startCodexConnectionAction).mockResolvedValue({ status: "started", message: "Authorize again.", flow });
    const { rerender } = render(<CodexConnectionPanel status={connected} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/2026-09-01/)).toBeInTheDocument();
    const model = screen.getByRole("textbox", { name: "Codex model identifier" });
    expect(model).toHaveValue("deployment-model");
    fireEvent.change(model, { target: { value: "chosen-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Save model" }));
    expect(await screen.findByText("Codex model updated.")).toBeInTheDocument();
    expect(vi.mocked(actions.updateCodexModelAction).mock.calls[0][1].get("model")).toBe("chosen-model");
    rerender(<CodexConnectionPanel status={{ ...connected, model: "server-model" }} />);
    expect(screen.getByRole("textbox", { name: "Codex model identifier" })).toHaveValue("server-model");
    expect(screen.getByRole("button", { name: "Disconnect locally" })).toBeDisabled();
    expect(screen.getByText(/does not revoke.*OpenAI/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /delete my.*local connection/i }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect locally" }));
    expect(await screen.findByText("Codex disconnected from Career Forge.")).toBeInTheDocument();
    expect(actions.disconnectCodexAction).toHaveBeenCalledTimes(1);
    rerender(<CodexConnectionPanel status={disconnected} />);
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    rerender(<CodexConnectionPanel status={{ ...disconnected, reauthRequired: true }} />);
    expect(screen.getByText(/reconnect required/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect ChatGPT / Codex" }));
    expect(await screen.findByText(flow.userCode)).toBeInTheDocument();
  });
  it("copies the code with success and failure feedback, and disables expired completion", async () => {
    vi.mocked(actions.startCodexConnectionAction).mockResolvedValue({ status: "started", message: "Authorize with OpenAI.", flow });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CodexConnectionPanel status={disconnected} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT / Codex" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy code" }));
    expect(await screen.findByText("Code copied.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(flow.userCode);
    writeText.mockRejectedValue(new Error("clipboard denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText(/could not copy.*select.*manually/i)).toBeInTheDocument();
    vi.mocked(actions.startCodexConnectionAction).mockResolvedValue({ status: "started", message: "New code.", flow: { ...flow, expiresAt: "2000-01-01T00:00:00.000Z" } });
    fireEvent.click(screen.getByRole("button", { name: /get a new code/i }));
    expect(await screen.findByText(/code expired.*new code/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /finish connecting/i })).toBeDisabled();
  });
  it("starts authorization without inventing a disconnected model and retains the code while finishing is pending", async () => {
    vi.mocked(actions.startCodexConnectionAction).mockResolvedValue({ status: "started", message: "Authorize with OpenAI.", flow });
    vi.mocked(actions.completeCodexConnectionAction).mockResolvedValue({ status: "pending", message: "Authorization is not complete.", flowId: flow.flowId });
    render(<CodexConnectionPanel status={disconnected} />);
    expect(screen.queryByRole("textbox", { name: /model/i })).not.toBeInTheDocument();
    expect(screen.getByText(/experimental.*quota/i)).toBeInTheDocument();
    expect(screen.getByText(/career data is shared.*credentials.*per-user/i)).toBeInTheDocument();
    expect(screen.getByText(/selected verified claims and job requirements.*provider/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect ChatGPT / Codex" }));
    expect(await screen.findByText(flow.userCode)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /authorize at OpenAI/i })).toHaveAttribute("href", flow.verificationUrl);
    expect(screen.getByText(/2099-09-05/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /finish connecting/i }));
    expect(await screen.findByText("Authorization is not complete.")).toBeInTheDocument();
    expect(screen.getByText(flow.userCode)).toBeInTheDocument();
    expect(vi.mocked(actions.completeCodexConnectionAction).mock.calls[0][1].get("flowId")).toBe(flow.flowId);
    expect(actions.startCodexConnectionAction).toHaveBeenCalledTimes(1);
  });
  it.each(["disabled", "misconfigured", "unavailable"] as const)("keeps deterministic tailoring available when %s", (reason) => {
    render(<CodexConnectionPanel status={{ available: false, reason }} />);
    expect(screen.getByText(/deterministic tailoring remains available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.getByText(reason === "disabled" ? /disabled on this deployment/i : /unavailable on this deployment/i)).toBeInTheDocument();
  });
});
