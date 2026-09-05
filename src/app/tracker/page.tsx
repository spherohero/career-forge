import { TrackerBoard } from "@/components/tracker-board";
import { getRepository } from "@/server/database";

export const dynamic = "force-dynamic";
export default function TrackerPage() {
  const jobs = getRepository().listJobs();
  return <div className="page-stack wide-page"><header className="page-heading"><div><p className="eyebrow">Application pipeline</p><h1>Tracker</h1><p className="page-subtitle">Move each role from first review through decision. Empty stages stay visible so the full workflow is clear.</p></div></header><TrackerBoard jobs={jobs} /></div>;
}
