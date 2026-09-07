import { headers } from "next/headers";
import { authorizeRequest, getAuthConfig } from "@/lib/auth";
import { ApplicationTracker } from "@/server/application-tracker";
import { WorkbookRetry } from "@/components/workbook-panel";
import { notFound } from "next/navigation";
import { JobWorkspace } from "@/components/job-workspace";
import { generatePlanAction, reviewSuggestionAction, updateJobStatusAction } from "@/app/actions";
import { getRepository } from "@/server/database";

export const dynamic = "force-dynamic";
export default async function JobDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const auth = authorizeRequest(await headers(), getAuthConfig());
  if (!auth.allowed) throw new Error("Unauthorized request.");
  const { id } = await params;
  const repository = getRepository();
  const job = repository.getJob(id);
  if (!job) notFound();
  const versions = repository.listResumeVersions(job.id);
  const selectedId = (await searchParams).version;
  const version = selectedId ? versions.find(item => item.id === selectedId) ?? null : versions[0] ?? null;
  if (selectedId && !version) notFound();
  const tracker = new ApplicationTracker(repository).status(auth.identity);
  const pending = tracker.pending.some(item => item.job_id === id);
  return <div className="page-stack"><header className="page-heading"><div><p className="eyebrow">{job.company}</p><h1>{job.title}</h1><p className="page-subtitle">Evidence-backed analysis and a reviewable tailoring workspace for this role.</p></div><span className={`status-chip status-${job.status}`}>{job.status}</span></header>{pending ? <section className="panel form-stack"><p role="status">Applied recorded; workbook not synced for your identity.</p><a className="text-link" href="/profile">Upload or create your workbook in Profile</a><WorkbookRetry jobId={id}/></section> : null}<div className="export-actions"><a className="button button-secondary" href="/api/tracker/workbook">Download latest workbook</a></div><JobWorkspace job={job} profile={repository.getProfile()} version={version} versions={versions} hasSnapshot={Boolean(version && repository.getResumeSource(version.id))} updateStatusAction={updateJobStatusAction} generatePlanAction={generatePlanAction} reviewSuggestionAction={reviewSuggestionAction} /></div>;
}
