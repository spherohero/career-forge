'use server';

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { authorizeRequest, getAuthConfig } from "@/lib/auth";
import { getCodexConnectionService } from "@/server/codex-runtime";
import type { CodexConnectionService } from "@/server/codex-connection";

export interface CodexFlowProjection {
  flowId: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
}

export type CodexActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "started"; message: string; flow: CodexFlowProjection }
  // The UI keeps the start result locally. Pending never replays client state.
  | { status: "pending"; message: string; flowId: string }
  | { status: "model-updated"; message: string; model: string }
  | { status: "disconnected"; message: string }
  | { status: "connected"; message: string; model: string };

// Private boundary: exported functions are the only callable Server Actions.
async function withCodexService(
  action: (service: CodexConnectionService, identity: string) => Promise<CodexActionState>,
): Promise<CodexActionState> {
  try {
    const authorization = authorizeRequest(await headers(), getAuthConfig());
    if (!authorization.allowed) {
      return { status: "error", message: "You are not authorized to manage this connection." };
    }
    const service = getCodexConnectionService();
    if (!service) {
      return { status: "unavailable", message: "Codex connection is unavailable on this deployment." };
    }
    return await action(service, authorization.identity);
  } catch {
    return { status: "error", message: "Unable to manage the Codex connection. Please try again." };
  }
}

export async function disconnectCodexAction(
  _previousState: CodexActionState,
  _formData: FormData,
): Promise<CodexActionState> {
  // Neither prior client state nor form fields establish ownership.
  void _previousState;
  void _formData;
  return withCodexService(async (service, identity) => {
    // The service atomically removes both the connection and all pending flows.
    service.disconnect(identity);
    revalidatePath("/settings");
    return {
      status: "disconnected",
      message: "Codex disconnected from Career Forge. Pending authorization flows were cleared.",
    };
  });
}

export async function updateCodexModelAction(
  _previousState: CodexActionState,
  formData: FormData,
): Promise<CodexActionState> {
  return withCodexService(async (service, identity) => {
    const parsed = z.string().trim().regex(/^[A-Za-z0-9._:/-]{1,120}$/).safeParse(formData.get("model"));
    if (!parsed.success) {
      return { status: "error", message: "Enter a valid Codex model identifier." };
    }
    // updateModel returns a credential-bearing database row. Never serialize it.
    if (!service.updateModel(identity, parsed.data)) {
      return { status: "error", message: "Connect Codex before changing the model." };
    }
    revalidatePath("/settings");
    return { status: "model-updated", model: parsed.data, message: "Codex model updated." };
  });
}

export async function completeCodexConnectionAction(
  _previousState: CodexActionState,
  formData: FormData,
): Promise<CodexActionState> {
  return withCodexService(async (service, identity) => {
    const parsed = z.uuid().safeParse(formData.get("flowId"));
    if (!parsed.success) {
      return { status: "error", message: "Choose a valid Codex authorization flow." };
    }
    let result: Awaited<ReturnType<CodexConnectionService["complete"]>>;
    try {
      result = await service.complete(identity, parsed.data);
    } finally {
      // Completion can delete an expired/denied flow before throwing.
      revalidatePath("/settings");
    }
    if (result.status === "pending") {
      return {
        status: "pending",
        flowId: parsed.data,
        message: "Authorization is not complete. Finish authorizing with OpenAI, then try again.",
      };
    }
    return { status: "connected", model: result.model, message: "Codex connected." };
  });
}

export async function startCodexConnectionAction(
  _previousState: CodexActionState,
  _formData: FormData,
): Promise<CodexActionState> {
  // Neither prior client state nor form fields establish ownership.
  void _previousState;
  void _formData;
  return withCodexService(async (service, identity) => {
    const flow = await service.start(identity);
    revalidatePath("/settings");
    return {
      status: "started",
      message: "Authorize the device code with OpenAI, then finish connecting.",
      flow: {
        flowId: flow.flowId,
        userCode: flow.userCode,
        verificationUrl: flow.verificationUrl,
        expiresAt: flow.expiresAt,
      },
    };
  });
}
