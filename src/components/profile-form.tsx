'use client';

import { useActionState } from "react";
import { saveProfileAction, type ActionState } from "@/app/actions";
import type { Profile } from "@/lib/domain";

const initialState: ActionState = {};
function FieldError({ errors, id }: { errors?: string[]; id: string }) { return errors?.length ? <p className="field-error" id={id}>{errors.join(" ")}</p> : null; }

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const [state, action, pending] = useActionState(saveProfileAction, initialState);
  const skills = profile?.skills.map((item) => item.name).join("\n") ?? "";
  const experiences = profile?.experiences.map((item) => [
    `${item.organization} | ${item.role} | ${item.startDate ?? ""} | ${item.endDate ?? "present"} | ${item.location}`,
    ...item.achievements.map((achievement) => `- ${achievement.text}${achievement.evidence ? ` :: ${achievement.evidence}` : ""}`),
  ].join("\n")).join("\n\n") ?? "";
  const projects = profile?.projects.map((item) => [
    `${item.name} | ${item.url ?? ""} | ${item.startDate ?? ""} | ${item.endDate ?? "present"}`,
    item.summary,
    ...item.achievements.map((achievement) => `- ${achievement.text}${achievement.evidence ? ` :: ${achievement.evidence}` : ""}`),
  ].filter(Boolean).join("\n")).join("\n\n") ?? "";
  const education = profile?.education.map((item) => [
    `${item.institution} | ${item.degree} | ${item.field} | ${item.startDate ?? ""} | ${item.endDate ?? "present"}`,
    item.details,
  ].filter(Boolean).join("\n")).join("\n\n") ?? "";

  return (
    <form action={action} className="form-stack">
      <aside className="attestation-note"><strong>Verified / user-attested</strong><span>Everything saved here is treated as a fact you personally attest to. Tailoring can select these claims, but cannot invent or expand them.</span></aside>
      <section className="panel form-stack"><div className="section-heading"><div><p className="eyebrow">Identity</p><h2>Contact & positioning</h2></div><span className="verified-label">Verified / user-attested</span></div>
        <div className="form-grid two-column">
          <div><label htmlFor="fullName">Full name</label><input aria-describedby={state.errors?.fullName ? "full-name-error" : undefined} aria-invalid={Boolean(state.errors?.fullName)} defaultValue={profile?.fullName} id="fullName" name="fullName" required /><FieldError errors={state.errors?.fullName} id="full-name-error" /></div>
          <div><label htmlFor="email">Email</label><input aria-describedby={state.errors?.email ? "email-error" : undefined} aria-invalid={Boolean(state.errors?.email)} defaultValue={profile?.email} id="email" name="email" required type="email" /><FieldError errors={state.errors?.email} id="email-error" /></div>
          <div><label htmlFor="phone">Phone</label><input defaultValue={profile?.phone} id="phone" name="phone" /></div>
          <div><label htmlFor="location">Location</label><input defaultValue={profile?.location} id="location" name="location" /></div>
        </div>
        <div><label htmlFor="headline">Headline</label><input defaultValue={profile?.headline} id="headline" name="headline" /></div>
        <div><label htmlFor="summary">Summary</label><textarea defaultValue={profile?.summary} id="summary" name="summary" rows={5} /></div>
      </section>
      <section className="panel form-stack"><div className="section-heading"><div><p className="eyebrow">Capabilities</p><h2>Skills</h2></div><span className="verified-label">Verified / user-attested</span></div><label htmlFor="skills">Comma or newline-separated skills</label><p className="form-help">Enter skills separated by commas or new lines.</p><textarea aria-describedby={state.errors?.skills ? "skills-error" : undefined} aria-invalid={Boolean(state.errors?.skills)} defaultValue={skills} id="skills" name="skills" rows={6} /><FieldError errors={state.errors?.skills} id="skills-error" /></section>
      <section className="panel form-stack"><div className="section-heading"><div><p className="eyebrow">Experience</p><h2>Roles & evidence bullets</h2></div><span className="verified-label">Verified / user-attested</span></div><label htmlFor="experiences">One role per block</label><p className="form-help">Header: Organization | Role | Start | End | Location. Add bullets below as “- Claim :: Evidence source”. Separate roles with a blank line.</p><textarea aria-describedby={state.errors?.experiences ? "experiences-error" : undefined} aria-invalid={Boolean(state.errors?.experiences)} defaultValue={experiences} id="experiences" name="experiences" placeholder={'Signal Labs | Firmware Intern | 2025-05 | 2025-08 | Remote\n- Implemented SPI driver tests :: Repository PR #42'} rows={12} /><FieldError errors={state.errors?.experiences} id="experiences-error" /></section>
      <section className="panel form-stack"><div className="section-heading"><div><p className="eyebrow">Projects</p><h2>Project evidence</h2></div><span className="verified-label">Verified / user-attested</span></div><label htmlFor="projects">One project per block</label><p className="form-help">Header: Name | URL | Start | End. Add summary and “- Claim :: Evidence source” bullets below.</p><textarea aria-describedby={state.errors?.projects ? "projects-error" : undefined} aria-invalid={Boolean(state.errors?.projects)} defaultValue={projects} id="projects" name="projects" rows={10} /><FieldError errors={state.errors?.projects} id="projects-error" /></section>
      <section className="panel form-stack"><div className="section-heading"><div><p className="eyebrow">Education</p><h2>Education</h2></div><span className="verified-label">Verified / user-attested</span></div><label htmlFor="education">One credential per block</label><p className="form-help">Header: Institution | Degree | Field | Start | End. Add details on following lines.</p><textarea aria-describedby={state.errors?.education ? "education-error" : undefined} aria-invalid={Boolean(state.errors?.education)} defaultValue={education} id="education" name="education" rows={8} /><FieldError errors={state.errors?.education} id="education-error" /></section>
      <p aria-live="polite" className={state.success ? "success-message" : "form-message"}>{state.message}</p>
      <button className="button button-primary save-profile" disabled={pending} type="submit">{pending ? "Saving verified profile…" : "Save verified profile"}</button>
    </form>
  );
}
