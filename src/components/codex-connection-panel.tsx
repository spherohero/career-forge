'use client';

import { useActionState, useEffect, useRef, useState } from "react";
import {
  startCodexConnectionAction, completeCodexConnectionAction,
  updateCodexModelAction, disconnectCodexAction,
  type CodexActionState, type CodexFlowProjection,
} from "@/app/settings/actions";

export type CodexPanelStatus =
  | { available: false; reason: "disabled" | "misconfigured" | "unavailable" }
  | { available: true; connected: boolean; reauthRequired: boolean; model?: string; connectedAt?: string };

type PanelState = { result: CodexActionState; flow?: CodexFlowProjection };
const initialState: PanelState = { result: { status: "idle" } };
async function manageConnection(previous: PanelState, data: FormData): Promise<PanelState> {
  const actions = { start: startCodexConnectionAction, finish: completeCodexConnectionAction,
    model: updateCodexModelAction, disconnect: disconnectCodexAction };
  const intent = data.get("intent") as keyof typeof actions;
  try {
    const result = await actions[intent]({ status: "idle" }, data);
    // Retain only the safe start projection across pending/error responses.
    // Connection/model truth always comes from revalidated server props.
    const flow = result.status === "started" ? result.flow
      : result.status === "connected" || result.status === "disconnected" || result.status === "unavailable"
        ? undefined : previous.flow;
    return { result, flow };
  } catch {
    return { ...previous, result: { status: "error", message: "Unable to manage the Codex connection. Please try again." } };
  }
}

function DeviceCode({ flow, action }: { flow: CodexFlowProjection; action: (data: FormData) => void }) {
  const [copyMessage, setCopyMessage] = useState("");
  const [expired, setExpired] = useState(() => Date.parse(flow.expiresAt) <= Date.now());
  const code = useRef<HTMLElement>(null);
  useEffect(() => {
    code.current?.focus();
    const timer = setInterval(() => setExpired(Date.parse(flow.expiresAt) <= Date.now()), 1000);
    return () => clearInterval(timer);
  }, [flow.expiresAt]);
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(flow.userCode);
      setCopyMessage("Code copied.");
    } catch {
      setCopyMessage("Could not copy. Select the code and copy it manually.");
    }
  }
  return <div className="codex-device form-stack">
    <a href={flow.verificationUrl} target="_blank" rel="noopener noreferrer">Authorize at OpenAI (opens a new tab)</a>
    <div className="codex-code-row"><code ref={code} tabIndex={-1} aria-label="OpenAI device code">{flow.userCode}</code>
      <button type="button" className="button button-secondary" onClick={copyCode}>Copy code</button></div>
    <p role="status" aria-live="polite">{copyMessage}</p>
    <p>Expires at <time dateTime={flow.expiresAt}>{flow.expiresAt.replace("T", " ").replace(".000Z", " UTC")}</time>.</p>
    {expired && <p role="status">Code expired. Get a new code to continue.</p>}
    <form action={action}>
      <input type="hidden" name="intent" value="finish" />
      <input type="hidden" name="flowId" value={flow.flowId} />
      <button className="button button-primary" disabled={expired} type="submit">I’ve authorized—finish connecting</button>
    </form>
  </div>;
}

function ConnectionControls({ status }: { status: Extract<CodexPanelStatus, { available: true }> }) {
  const [state, action, pending] = useActionState(manageConnection, initialState);
  const [confirmed, setConfirmed] = useState(false);
  return <fieldset className="codex-controls form-stack" disabled={pending} aria-busy={pending}>
    <p className={status.connected ? "verified-label" : "form-message"}>{status.connected ? "Connected" : status.reauthRequired ? "Reconnect required" : "Not connected"}</p>
    {status.connected ? <>
      {status.connectedAt && <p>Connected on <time dateTime={status.connectedAt}>{status.connectedAt.replace("T", " ").replace(".000Z", " UTC")}</time>.</p>}
      <form action={action} className="form-stack">
        <input type="hidden" name="intent" value="model" />
        <div><label htmlFor="codex-model">Codex model identifier</label>
          <input key={status.model} id="codex-model" name="model" defaultValue={status.model ?? ""} required maxLength={120} aria-describedby="codex-model-help" /></div>
        <p id="codex-model-help" className="form-help">Use a model identifier available to your Codex account. Availability depends on your plan; no model catalog is assumed.</p>
        <button className="button button-secondary" type="submit">Save model</button>
      </form>
    </> : <>
      <form action={action}>
        <input type="hidden" name="intent" value="start" />
        <button className="button button-primary" type="submit">{state.flow ? "Get a new code" : status.reauthRequired ? "Reconnect ChatGPT / Codex" : "Connect ChatGPT / Codex"}</button>
      </form>
      {state.flow && <DeviceCode key={`${state.flow.flowId}:${state.flow.expiresAt}`} flow={state.flow} action={action} />}
    </>}
    {(status.connected || status.reauthRequired || state.flow) && <form action={action} className="codex-disconnect form-stack">
      <input type="hidden" name="intent" value="disconnect" />
      <p>This deletes only the local connection and pending codes. It does not revoke your OpenAI session. You can also revoke sessions from your OpenAI account settings.</p>
      <label className="codex-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required />Delete my Career Forge local connection and pending codes</label>
      <button className="button button-secondary" type="submit" disabled={!confirmed}>Disconnect locally</button>
    </form>}
    <p role="status" aria-live="polite" className="form-message">{pending ? "Working…" : "message" in state.result ? state.result.message : ""}</p>
  </fieldset>;
}

export function CodexConnectionPanel({ status }: { status: CodexPanelStatus }) {
  // Keep transition feedback outside the keyed controls: their action state must
  // reset when server truth changes, but the live region and focus must survive.
  const connection = !status.available ? "unavailable"
    : status.connected ? "connected" : status.reauthRequired ? "reauth" : "disconnected";
  const [feedback, setFeedback] = useState({ connection, message: "" });
  const announcement = useRef<HTMLParagraphElement>(null);
  if (feedback.connection !== connection) {
    setFeedback({ connection, message: feedback.connection !== "unavailable"
      ? connection === "connected" ? "Codex connected."
        : connection === "disconnected" ? "Codex disconnected from Career Forge." : ""
      : "" });
  }
  useEffect(() => {
    if (feedback.message) announcement.current?.focus();
  }, [feedback]);
  return <section className="panel form-stack codex-panel" aria-labelledby="codex-heading">
    <div><p className="eyebrow">Your AI connection · Experimental</p><h2 id="codex-heading">ChatGPT / Codex</h2></div>
    <p>Experimental subscription access, subject to your ChatGPT / Codex plan eligibility and quota limits. Third-party quota accounting may vary. Career Forge never receives your OpenAI password.</p>
    <p>Career data is shared within this workspace; Codex credentials are per-user and belong to your signed-in identity.</p>
    <p>When you use model-assisted tailoring, selected verified claims and job requirements are sent to the provider, subject to its retention policies.</p>
    <p ref={announcement} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} className="form-message">{feedback.message}</p>
    {!status.available
      ? <p>{status.reason === "disabled" ? "Codex is disabled on this deployment." : "Codex is unavailable on this deployment. Contact your administrator."}</p>
      : <ConnectionControls key={`${status.connected}:${status.reauthRequired}:${status.connectedAt ?? ""}`} status={status} />}
    <p className="form-help">Deterministic tailoring remains available.</p>
  </section>;
}
