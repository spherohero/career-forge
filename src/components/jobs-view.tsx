import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";
import type { Job } from "@/lib/domain";

export function JobsView({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return (
      <section className="empty-state">
        <BriefcaseBusiness aria-hidden="true" />
        <h2>No saved roles</h2>
        <p>Add a posting to analyze its requirements and build an evidence-backed application.</p>
        <Link className="button button-primary" href="/jobs/new">Add your first role</Link>
      </section>
    );
  }
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <Link className="job-row" href={`/jobs/${job.id}`} key={job.id}>
          <span className="company-monogram" aria-hidden="true">{job.company.slice(0, 2).toUpperCase()}</span>
          <span className="job-row-main"><strong>{job.title}</strong><span>{job.company} · {job.location || "Location not listed"} · {job.workModel}</span></span>
          <span className={`status-chip status-${job.status}`}>{job.status}</span>
        </Link>
      ))}
    </div>
  );
}
