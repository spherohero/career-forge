import { Dashboard } from "@/components/dashboard";
import { getRepository } from "@/server/database";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const repository = getRepository();
  return <Dashboard jobs={repository.listJobs()} profile={repository.getProfile()} />;
}
