import {
  BriefcaseBusiness,
  FileStack,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import Link from "next/link";
import type { Job, Profile } from "@/lib/domain";

interface DashboardProps {
  jobs: Job[];
  profile: Profile | null;
}

const activeStatuses = new Set(["tailoring", "ready", "applied", "interview"]);

function statusLabel(status: Job["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function Dashboard({ jobs, profile }: DashboardProps) {
  const activeJobs = jobs.filter((job) => activeStatuses.has(job.status));
  const interviews = jobs.filter((job) => job.status === "interview");
  const factCount = profile
    ? profile.skills.length +
      profile.experiences.reduce(
        (count, experience) => count + experience.achievements.length,
        0,
      ) +
      profile.projects.reduce(
        (count, project) => count + project.achievements.length,
        0,
      )
    : 0;

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Command board</p>
          <h1>Your next role, engineered.</h1>
          <p className="page-subtitle">
            Turn verified experience into focused applications—without inventing
            a single claim.
          </p>
        </div>
        <Link className={`button ${profile ? "button-primary" : "button-secondary"}`} href="/jobs/new">
          Add a role
        </Link>
      </header>

      <section className="metric-grid" aria-label="Application summary">
        <article className="metric-card">
          <span className="metric-icon"><BriefcaseBusiness aria-hidden="true" /></span>
          <span className="metric-value">{activeJobs.length}</span>
          <span className="metric-label">Active applications</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><Target aria-hidden="true" /></span>
          <span className="metric-value">{interviews.length}</span>
          <span className="metric-label">Interview loops</span>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><ShieldCheck aria-hidden="true" /></span>
          <span className="metric-value">{factCount}</span>
          <span className="metric-label">Verified profile facts</span>
        </article>
      </section>

      {!profile ? (
        <section className="onboarding-panel">
          <div className="onboarding-marker" aria-hidden="true">01</div>
          <div>
            <p className="eyebrow">First calibration</p>
            <h2>Build your verified career profile</h2>
            <p>
              Career Forge only tailors from facts you approve. Add your skills,
              experience, projects, and evidence before analyzing a role.
            </p>
          </div>
          <Link className="button button-primary" href="/profile">
            Set up profile
          </Link>
        </section>
      ) : null}

      <section className="content-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Work queue</p>
            <h2>Recent roles</h2>
          </div>
          {jobs.length > 0 ? <Link className="text-link" href="/jobs">View all roles</Link> : null}
        </div>

        {jobs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><FileStack aria-hidden="true" /></span>
            <h3>No roles on the bench yet</h3>
            <p>Import a job description to create your first fit analysis.</p>
            <Link className="button button-secondary" href="/jobs/new">
              Import a role
            </Link>
          </div>
        ) : (
          <div className="job-list">
            {jobs.slice(0, 5).map((job) => (
              <Link className="job-row" href={`/jobs/${job.id}`} key={job.id}>
                <span className="company-monogram" aria-hidden="true">
                  {job.company.slice(0, 2).toUpperCase()}
                </span>
                <span className="job-row-main">
                  <strong>{job.title}</strong>
                  <span>{job.company} · {job.location || "Location not listed"}</span>
                </span>
                <span className={`status-chip status-${job.status}`}>
                  {statusLabel(job.status)}
                </span>

              </Link>
            ))}
          </div>
        )}
      </section>

      <aside className="trust-note">
        <Sparkles aria-hidden="true" size={17} />
        <span><strong>Evidence-first AI:</strong> every proposed bullet must trace back to a verified source fact.</span>
      </aside>
    </div>
  );
}
