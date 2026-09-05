'use client';

import { useActionState } from "react";
import { importResumeAction, type ActionState } from "@/app/actions";

interface ResumeImportView {
  id: string;
  originalFilename: string;
  mediaType: string;
  extractedText: string;
  createdAt: string;
  status: "pending_review";
}

export function ResumeImportPanel({ latest }: { latest: ResumeImportView | null }) {
  const [state, action, pending] = useActionState(importResumeAction, {} as ActionState);
  return (
    <section className="panel import-panel" aria-labelledby="resume-import-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Unverified import</p><h2 id="resume-import-heading">Bring in a resume draft</h2></div>
        <span className="unverified-label">Pending review</span>
      </div>
      <p className="form-help">PDF, DOCX, or UTF-8 TXT, up to 4 MiB. Extraction never adds facts to your verified profile. Review and attest any facts yourself in the profile form below.</p>
      <form action={action} className="import-form">
        <div><label htmlFor="resumeFile">Resume file</label><input accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" id="resumeFile" name="resumeFile" required type="file" /></div>
        <button className="button button-secondary" disabled={pending} type="submit">{pending ? "Extracting…" : "Extract text"}</button>
      </form>
      <p aria-live="polite" className={state.success ? "success-message" : "form-message"}>{state.message}</p>
      {latest ? (
        <article className="import-preview">
          <header><strong>{latest.originalFilename}</strong><span>Unverified · {latest.status.replace("_", " ")}</span></header>
          <pre>{latest.extractedText}</pre>
        </article>
      ) : <p className="muted">No resume draft has been imported.</p>}
    </section>
  );
}
