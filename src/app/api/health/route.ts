import { NextResponse } from "next/server";
import { getRepository } from "@/server/database";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    getRepository().listJobs();
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "unhealthy" }, { status: 503 });
  }
}
