import { headers } from "next/headers";
import { authorizeRequest, getAuthConfig } from "@/lib/auth";
import { ApplicationTracker } from "@/server/application-tracker";
import { WorkbookPanel } from "@/components/workbook-panel";
import { ProfileForm } from "@/components/profile-form";
import { ResumeImportPanel } from "@/components/resume-import-panel";
import { getRepository } from "@/server/database";

export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  const auth = authorizeRequest(await headers(), getAuthConfig());
  if (!auth.allowed) throw new Error("Unauthorized request.");
  const repository = getRepository();
  const profile = repository.getProfile();
  const tracker = new ApplicationTracker(repository).status(auth.identity);
  return <div className="page-stack narrow-page"><header className="page-heading"><div><p className="eyebrow">Verified source of truth</p><h1>Career profile</h1><p className="page-subtitle">Maintain the facts Career Forge may use. Structured text keeps the editor fast while still capturing roles, dates, projects, education, claims, and evidence sources.</p></div></header><div className="form-stack"><WorkbookPanel ready={Boolean(tracker.workbook)} pending={tracker.pending.map(item => ({jobId:item.job_id,title:repository.getJob(item.job_id)?.title ?? "Saved job"}))} /><ResumeImportPanel latest={repository.getLatestResumeImport()} /><ProfileForm profile={profile} /></div></div>;
}
