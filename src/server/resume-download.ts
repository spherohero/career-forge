import { z } from "zod";
import { authorizeRequest, type AuthConfig } from "@/lib/auth";
import { assembleTailoredResume, createResumeDocx, createResumePdf, sanitizeExportFilename } from "@/lib/resume-export";
import type { CareerRepository } from "./repository";

export type ResumeFormat = "docx" | "pdf";

const idSchema = z.uuid();
const contentTypes: Record<ResumeFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

function errorResponse(message: string, status: number): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function prepareResumeDownload(
  request: Request,
  versionId: string,
  format: ResumeFormat,
  repository: CareerRepository,
  auth: AuthConfig,
): Promise<Response> {
  const authorization = authorizeRequest(request.headers, auth);
  if (!authorization.allowed) return errorResponse("Unauthorized resume export.", authorization.reason === "missing-identity" ? 401 : 403);
  const parsedId = idSchema.safeParse(versionId);
  if (!parsedId.success) return errorResponse("Invalid resume version id.", 400);
  const version = repository.getResumeVersion(parsedId.data);
  if (!version) return errorResponse("Resume version not found.", 404);
  const job = repository.getJob(version.jobId);
  const profile = repository.getProfile();
  if (!job || !profile) return errorResponse("Resume source data not found.", 404);

  const resume = assembleTailoredResume(profile, job, version);
  const bytes = format === "docx" ? await createResumeDocx(resume) : await createResumePdf(resume);
  const filename = `${sanitizeExportFilename(`${profile.fullName}-${job.company}-${job.title}`)}.${format}`;
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": contentTypes[format],
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
