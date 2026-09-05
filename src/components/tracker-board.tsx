import Link from "next/link";
import type { Job, JobStatus } from "@/lib/domain";

export const pipelineStages: Array<{ status: JobStatus; label: string }> = [
  { status: "saved", label: "Saved" },
  { status: "tailoring", label: "Tailoring" },
  { status: "ready", label: "Ready" },
  { status: "applied", label: "Applied" },
  { status: "interview", label: "Interview" },
  { status: "offer", label: "Offer" },
  { status: "rejected", label: "Rejected" },
  { status: "archived", label: "Archived" },
];

export function TrackerBoard({ jobs }: { jobs: Job[] }) {
  return (
    <div className="tracker-board">
      {pipelineStages.map(({ status, label }) => {
        const stageJobs = jobs.filter((job) => job.status === status);
        return (
          <section className="tracker-column" key={status} aria-label={`${label} jobs`}>
            <header><h2>{label}</h2><span>{stageJobs.length}</span></header>
            {stageJobs.length === 0 ? <p className="stage-empty">No roles</p> : stageJobs.map((job) => (
              <Link className="tracker-card" href={`/jobs/${job.id}`} key={job.id}>
                <strong>{job.title}</strong><span>{job.company}</span>
              </Link>
            ))}
          </section>
        );
      })}
    </div>
  );
}
