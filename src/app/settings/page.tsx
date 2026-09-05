import { basename, join } from "node:path";
import { headers } from "next/headers";
import { authorizeRequest, getAuthConfig } from "@/lib/auth";
import { CodexConnectionPanel, type CodexPanelStatus } from "@/components/codex-connection-panel";
import { getCodexConnectionService, getCodexRuntimeStatus } from "@/server/codex-runtime";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const auth = getAuthConfig();
  const authorization = authorizeRequest(await headers(), auth);
  if (!authorization.allowed) {
    return <section className="panel"><h1>Settings</h1><p>You are not authorized to view these settings.</p></section>;
  }
  let status: CodexPanelStatus = { available: false, reason: "unavailable" };
  try {
    const runtime = getCodexRuntimeStatus();
    if (!runtime.available) {
      status = { available: false, reason: runtime.reason };
    } else {
      const service = getCodexConnectionService();
      if (service) {
        const connection = service.getStatus(authorization.identity);
        // Explicit allowlist: never pass a service or credential-bearing row to the client.
        status = {
          available: true,
          connected: connection.connected,
          reauthRequired: connection.reauthRequired,
          model: connection.model,
          connectedAt: connection.connectedAt,
        };
      }
    }
  } catch {
    // Runtime/database failures must not render exception details or secrets.
    status = { available: false, reason: "unavailable" };
  }
  const databasePath = process.env.DATABASE_PATH ?? join(process.cwd(), "data", "career-forge.db");
  const modelConfigured = Boolean(process.env.MODEL_BASE_URL && process.env.MODEL_API_KEY && process.env.MODEL_NAME);
  return <div className="page-stack narrow-page">
    <header className="page-heading"><div><p className="eyebrow">Connections & runtime</p><h1>Settings</h1><p className="page-subtitle">Manage your AI connection. Secret values are never rendered.</p></div></header>
    <CodexConnectionPanel status={status} />
    <section className="panel settings-list" aria-label="Deployment status">
      <div><span>Authentication mode</span><strong>{auth.mode}</strong></div>
      <div><span>Administrator model fallback</span><strong>{modelConfigured ? "Configured" : "Not configured"}</strong></div>
      <div><span>Database file</span><strong>{basename(databasePath)}</strong></div>
    </section>
  </div>;
}
