import { ProfileForm } from "@/components/profile-form";
import { ResumeImportPanel } from "@/components/resume-import-panel";
import { getRepository } from "@/server/database";

export const dynamic = "force-dynamic";
export default function ProfilePage() {
  const repository = getRepository();
  const profile = repository.getProfile();
  return <div className="page-stack narrow-page"><header className="page-heading"><div><p className="eyebrow">Verified source of truth</p><h1>Career profile</h1><p className="page-subtitle">Maintain the facts Career Forge may use. Structured text keeps the editor fast while still capturing roles, dates, projects, education, claims, and evidence sources.</p></div></header><div className="form-stack"><ResumeImportPanel latest={repository.getLatestResumeImport()} /><ProfileForm profile={profile} /></div></div>;
}
