import type { ResumeVersion } from "@/lib/analysis";
import { analyzeJobFit } from "@/lib/analysis";
import { jobStatusSchema, type Job, type Profile } from "@/lib/domain";

type FormAction = (formData: FormData) => void | Promise<void>;

interface JobWorkspaceProps {
  job: Job;
  profile: Profile | null;
  version: ResumeVersion | null;
  updateStatusAction?: FormAction;
  generatePlanAction?: FormAction;
  reviewSuggestionAction?: FormAction;
}

const noop: FormAction = () => undefined;

export function JobWorkspace({
  job,
  profile,
  version,
  updateStatusAction = noop,
  generatePlanAction = noop,
  reviewSuggestionAction = noop,
}: JobWorkspaceProps) {
  const analysis = profile ? analyzeJobFit(profile, job) : null;
  const evidenceById = profile
    ? new Map([
        ...profile.skills.map((item) => [item.id, item.name] as const),
        ...profile.experiences.flatMap((item) => item.achievements).map((item) => [item.id, item.text] as const),
        ...profile.projects.flatMap((item) => item.achievements).map((item) => [item.id, item.text] as const),
      ])
    : new Map<string, string>();

  return (
    <div className="workspace-grid">
      <section className="panel workspace-main">
        <p className="eyebrow">Original posting</p>
        <h2>Role brief</h2>
        <dl className="job-meta">
          <div><dt>Company</dt><dd>{job.company}</dd></div>
          <div><dt>Location</dt><dd>{job.location || "Not listed"}</dd></div>
          <div><dt>Work model</dt><dd>{job.workModel}</dd></div>
        </dl>
        {job.url ? <a className="text-link" href={job.url} rel="noreferrer" target="_blank">Open source posting</a> : null}
        <div className="posting-copy">{job.description}</div>
      </section>

      <aside className="panel status-panel">
        <p className="eyebrow">Pipeline</p><h2>Status</h2>
        <form action={updateStatusAction} className="compact-form">
          <input name="jobId" type="hidden" value={job.id} />
          <label htmlFor="status">Current stage</label>
          <select defaultValue={job.status} id="status" name="status">
            {jobStatusSchema.options.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <label htmlFor="status-note">Transition note</label>
          <input id="status-note" name="note" placeholder="Optional context" />
          <button className="button button-secondary" type="submit">Update status</button>
        </form>
      </aside>

      <section className="panel analysis-panel">
        <div className="section-heading"><div><p className="eyebrow">Requirement analysis</p><h2>Evidence map</h2></div>
          <strong className="evidence-count">{analysis ? `${analysis.matched.length} of ${analysis.requirements.length} evidenced` : "Profile required"}</strong>
        </div>
        {!analysis ? <p><a className="text-link" href="/profile">Create a verified profile</a> to compare your evidence with this posting.</p> : (
          <div className="evidence-columns">
            <section><h3>Matched evidence</h3>{analysis.matched.length ? analysis.matched.map((requirement) => (
              <article className="requirement matched" key={requirement.id}><strong>{requirement.text}</strong><ul>{requirement.evidenceIds.map((id) => <li key={id}>{evidenceById.get(id) ?? "Verified profile fact"}</li>)}</ul></article>
            )) : <p>No requirements have verified support yet.</p>}</section>
            <section><h3>Missing evidence</h3>{analysis.missing.length ? analysis.missing.map((requirement) => <article className="requirement missing" key={requirement.id}>{requirement.text}</article>) : <p>No evidence gaps found.</p>}</section>
          </div>
        )}
      </section>

      <section className="panel tailoring-panel">
        <div className="section-heading"><div><p className="eyebrow">Per-job workspace</p><h2>Tailoring plan</h2>{version ? <p className="plan-mode">{version.mode === "ai" ? "AI-assisted · guarded" : "Deterministic"}</p> : null}</div>
          {profile ? <form action={generatePlanAction}><input name="jobId" type="hidden" value={job.id} /><button className="button button-primary" type="submit">{version ? "Regenerate plan" : "Generate plan"}</button></form> : null}
        </div>
        {version ? <div className="export-actions" aria-label="Resume downloads"><a className="button button-secondary" href={`/api/resume/${version.id}/docx`}>Download DOCX</a><a className="button button-secondary" href={`/api/resume/${version.id}/pdf`}>Download PDF</a></div> : null}
        {version?.diagnostic ? <p className="model-diagnostic">Model output was not used ({version.diagnostic.replaceAll("_", " ")}); this complete plan is deterministic.</p> : null}
        {!version ? <p className="muted">Generate a guarded plan. When no valid model response is available, Career Forge fails closed to deterministic selection of verified claims.</p> : version.suggestions.length === 0 ? <p className="muted">No verified achievement bullets matched this role. Add evidence to your profile, then regenerate.</p> : (
          <div className="suggestion-list">{version.suggestions.map((suggestion) => (
            <article className="suggestion-card" data-testid={`suggestion-${suggestion.id}`} key={suggestion.id}>
              <span className={`status-chip status-${suggestion.status}`}>{suggestion.status}</span>
              <dl><div><dt>Source / original</dt><dd>{suggestion.originalText}</dd></div><div><dt>Proposed text</dt><dd>{suggestion.revisedText}</dd></div><div><dt>Rationale</dt><dd>{suggestion.rationale}</dd></div><div><dt>Evidence</dt><dd>{suggestion.evidence || "User-attested achievement"}</dd></div></dl>
              <form action={reviewSuggestionAction} className="review-actions">
                <input name="jobId" type="hidden" value={job.id} /><input name="versionId" type="hidden" value={version.id} /><input name="suggestionId" type="hidden" value={suggestion.id} />
                <button className="button button-secondary" name="decision" type="submit" value="accepted">Accept</button>
                <button className="button button-secondary" name="decision" type="submit" value="rejected">Reject</button>
              </form>
            </article>
          ))}</div>
        )}
      </section>
    </div>
  );
}
