import type { Metadata } from "next";
import { JobImportPanel } from "@/components/job-import-panel";

export const metadata: Metadata = { title: "Add role" };
export default function NewJobPage() {
  return <div className="page-stack narrow-page"><header className="page-heading"><div><p className="eyebrow">New calibration</p><h1>Add a role</h1><p className="page-subtitle">Paste the source posting exactly as published. Career Forge will preserve it and compare only against verified profile facts.</p></div></header><JobImportPanel /></div>;
}
