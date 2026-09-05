'use client';

import { useActionState } from "react";
import { createJobAction, type ActionState } from "@/app/actions";

const initialState: ActionState = {};

function FieldError({ errors, id }: { errors?: string[]; id: string }) {
  return errors?.length ? <p className="field-error" id={id}>{errors.join(" ")}</p> : null;
}

export function NewJobForm() {
  const [state, action, pending] = useActionState(createJobAction, initialState);
  return (
    <form action={action} className="panel form-stack">
      <div className="form-grid two-column">
        <div><label htmlFor="title">Role title</label><input aria-describedby={state.errors?.title ? "title-error" : undefined} aria-invalid={Boolean(state.errors?.title)} id="title" name="title" required /><FieldError errors={state.errors?.title} id="title-error" /></div>
        <div><label htmlFor="company">Company</label><input aria-describedby={state.errors?.company ? "company-error" : undefined} aria-invalid={Boolean(state.errors?.company)} id="company" name="company" required /><FieldError errors={state.errors?.company} id="company-error" /></div>
        <div><label htmlFor="location">Location</label><input aria-describedby={state.errors?.location ? "location-error" : undefined} aria-invalid={Boolean(state.errors?.location)} id="location" name="location" placeholder="City, region, or Remote" /><FieldError errors={state.errors?.location} id="location-error" /></div>
        <div><label htmlFor="workModel">Work model</label><select aria-describedby={state.errors?.workModel ? "work-model-error" : undefined} aria-invalid={Boolean(state.errors?.workModel)} defaultValue="unknown" id="workModel" name="workModel"><option value="unknown">Unknown</option><option value="onsite">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select><FieldError errors={state.errors?.workModel} id="work-model-error" /></div>
      </div>
      <div><label htmlFor="url">Posting URL <span className="optional">optional</span></label><input aria-describedby={state.errors?.url ? "url-error" : undefined} aria-invalid={Boolean(state.errors?.url)} id="url" name="url" placeholder="https://…" type="url" /><FieldError errors={state.errors?.url} id="url-error" /></div>
      <div><label htmlFor="description">Original job description</label><textarea aria-describedby={state.errors?.description ? "description-error" : undefined} aria-invalid={Boolean(state.errors?.description)} id="description" minLength={20} name="description" required rows={16} /><FieldError errors={state.errors?.description} id="description-error" /></div>
      <p aria-live="polite" className="form-message">{state.message}</p>
      <button className="button button-primary" disabled={pending} type="submit">{pending ? "Creating workspace…" : "Create job workspace"}</button>
    </form>
  );
}
