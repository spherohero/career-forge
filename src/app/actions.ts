'use server';

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeRequest, getAuthConfig } from "@/lib/auth";
import { analyzeJobFit } from "@/lib/analysis";
import { generateGuardedTailoringPlan } from "@/lib/model";
import { extractResumeImport } from "@/lib/resume-import";
import { jobStatusSchema } from "@/lib/domain";
import { parseJobForm, parseProfileForm, type FormErrors } from "@/lib/forms";
import { getRepository } from "@/server/database";
import { getCodexConnectionService, getCodexRuntimeStatus } from "@/server/codex-runtime";

export interface ActionState {
  errors?: FormErrors;
  message?: string;
  success?: boolean;
}

async function requireActionAuthorization(): Promise<string> {
  const result = authorizeRequest(await headers(), getAuthConfig());
  if (!result.allowed) throw new Error("Unauthorized mutation request.");
  return result.identity;
}

const idSchema = z.uuid();
const statusFormSchema = z.object({
  jobId: idSchema,
  status: jobStatusSchema,
  note: z.string().trim().max(1_000).optional(),
});
const jobIdFormSchema = z.object({ jobId: idSchema });
const reviewFormSchema = z.object({
  jobId: idSchema,
  versionId: idSchema,
  suggestionId: z.string().trim().min(1).max(200),
  decision: z.enum(["accepted", "rejected"]),
});

export async function createJobAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionAuthorization();
  const parsed = parseJobForm(formData);
  if (!parsed.success) return { errors: parsed.errors, message: "Review the highlighted fields." };
  const job = getRepository().createJob(parsed.data);
  redirect(`/jobs/${job.id}`);
}

export async function saveProfileAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionAuthorization();
  const parsed = parseProfileForm(formData);
  if (!parsed.success) return { errors: parsed.errors, message: "Review the highlighted fields." };
  getRepository().saveProfile(parsed.data);
  revalidatePath("/");
  revalidatePath("/profile");
  return { success: true, message: "Verified profile saved." };
}

export async function importResumeAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireActionAuthorization();
  const file = formData.get("resumeFile");
  if (!(file instanceof File)) return { message: "Choose a PDF, DOCX, or UTF-8 TXT resume." };
  try {
    const extracted = await extractResumeImport({
      originalName: file.name,
      mediaType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    getRepository().createResumeImport({
      originalFilename: extracted.originalFilename,
      mediaType: extracted.mediaType,
      extractedText: extracted.text,
    });
    revalidatePath("/profile");
    return { success: true, message: "Text extracted as an unverified draft. Review and attest facts below." };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Resume extraction failed." };
  }
}

export async function updateJobStatusAction(formData: FormData): Promise<void> {
  await requireActionAuthorization();
  const parsed = statusFormSchema.safeParse({
    jobId: formData.get("jobId"),
    status: formData.get("status"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) throw new Error("Invalid status update.");
  const updated = getRepository().updateJobStatus(parsed.data.jobId, parsed.data.status, parsed.data.note);
  if (!updated) throw new Error("Job not found.");
  revalidatePath(`/jobs/${parsed.data.jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/tracker");
  revalidatePath("/");
}

export async function generatePlanAction(formData: FormData): Promise<void> {
  const identity = await requireActionAuthorization();
  const parsed = jobIdFormSchema.safeParse({ jobId: formData.get("jobId") });
  if (!parsed.success) throw new Error("Invalid job.");
  const repository = getRepository();
  const job = repository.getJob(parsed.data.jobId);
  const profile = repository.getProfile();
  if (!job) throw new Error("Job not found.");
  if (!profile) throw new Error("A verified profile is required.");
  const analysis = analyzeJobFit(profile, job);
  let provider;
  // Never switch an OAuth request to a deployment-wide provider on failure.
  let env: Record<string, string | undefined> = {};
  try {
    const status = getCodexRuntimeStatus();
    if (!status.available && status.reason === "disabled") {
      env = process.env;
    } else if (status.available) {
      provider = await getCodexConnectionService()?.getProvider(identity) ?? undefined;
    }
  } catch {
    // Optional OAuth infrastructure must not block deterministic tailoring.
    provider = undefined;
  }
  repository.createResumeVersion(job.id, await generateGuardedTailoringPlan(profile, job, analysis, { provider, env }));
  revalidatePath(`/jobs/${job.id}`);
}

export async function reviewSuggestionAction(formData: FormData): Promise<void> {
  await requireActionAuthorization();
  const parsed = reviewFormSchema.safeParse({
    jobId: formData.get("jobId"),
    versionId: formData.get("versionId"),
    suggestionId: formData.get("suggestionId"),
    decision: formData.get("decision"),
  });
  if (!parsed.success) throw new Error("Invalid review decision.");
  const updated = getRepository().updateSuggestionStatusForJob(
    parsed.data.jobId,
    parsed.data.versionId,
    parsed.data.suggestionId,
    parsed.data.decision,
  );
  if (!updated) throw new Error("Suggestion not found for this job.");
  revalidatePath(`/jobs/${parsed.data.jobId}`);
}
