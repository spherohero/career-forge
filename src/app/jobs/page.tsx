import Link from "next/link";
import { JobsView } from "@/components/jobs-view";
import { getRepository } from "@/server/database";

export const dynamic = "force-dynamic";
export default function JobsPage() {
  const jobs = getRepository().listJobs();
  return <div className="page-stack"><header className="page-heading"><div><p className="eyebrow">Role library</p><h1>Saved roles</h1><p className="page-subtitle">Every posting keeps its original text, evidence analysis, status, and tailored resume versions together.</p></div><Link className="button button-primary" href="/jobs/new">Add a role</Link></header><JobsView jobs={jobs} /></div>;
}
