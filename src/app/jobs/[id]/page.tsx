import { notFound } from "next/navigation";
import { JobWorkspace } from "@/components/job-workspace";
import { generatePlanAction, reviewSuggestionAction, updateJobStatusAction } from "@/app/actions";
import { getRepository } from "@/server/database";

export const dynamic = "force-dynamic";
export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository();
  const job = repository.getJob(id);
  if (!job) notFound();
  return <div className="page-stack"><header className="page-heading"><div><p className="eyebrow">{job.company}</p><h1>{job.title}</h1><p className="page-subtitle">Evidence-backed analysis and a reviewable tailoring workspace for this role.</p></div><span className={`status-chip status-${job.status}`}>{job.status}</span></header><JobWorkspace job={job} profile={repository.getProfile()} version={repository.getLatestResumeVersion(job.id)} updateStatusAction={updateJobStatusAction} generatePlanAction={generatePlanAction} reviewSuggestionAction={reviewSuggestionAction} /></div>;
}
