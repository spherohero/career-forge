import { getAuthConfig } from "@/lib/auth";
import { getRepository } from "@/server/database";
import { prepareResumeDownload } from "@/server/resume-download";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await context.params;
  return prepareResumeDownload(request, versionId, "docx", getRepository(), getAuthConfig());
}
