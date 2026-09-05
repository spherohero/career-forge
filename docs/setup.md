# Setup and operations

[README](../README.md) · [Security model](security.md)

This guide describes the checked-in configuration, not a verified deployment. Use a private workspace and trusted operators; career data is shared among authorized users.

## Local development

Requirements: Node.js **22+**, npm, and a local checkout. `better-sqlite3` is a native dependency; if a prebuilt binary is unavailable, installation needs Python 3, `make`, and a C++ compiler. The Docker dependency stage supplies these tools.

```bash
cp .env.example .env.local
npm ci
npm run dev -- --hostname 127.0.0.1
```

Visit <http://127.0.0.1:3000>. Keep development loopback-only: `AUTH_MODE=disabled` gives all requests the identity `local-development`, including its shared local Codex connection. Do not use a tunnel, public bind, or untrusted LAN access with this configuration.

Use `npm run build` to produce a production build. The package's `start` script is `next start`; the Dockerfile instead runs the standalone `node server.js` output and copies its static/public assets. Production authorization still requires a trusted proxy. Merely building does not verify runtime packaging.

## Runtime environment

See [`.env.example`](../.env.example) and the actual [authentication](../src/lib/auth.ts), [model](../src/lib/model.ts), and [Codex runtime](../src/server/codex-runtime.ts) implementations.

| Variable | Meaning |
| --- | --- |
| `AUTH_MODE` | `authelia` enables trusted-header authorization. Non-production otherwise defaults to disabled; `NODE_ENV=production` forces Authelia even if `AUTH_MODE=disabled`. |
| `AUTH_ALLOWED_GROUPS` | Comma-separated groups; default `admins`. Choose your own restricted group. |
| `AUTH_ALLOWED_USERS` | Comma-separated explicit users; a matching user **or** group grants access. |
| `DATABASE_PATH` | SQLite path; default `data/career-forge.db` under the working directory. Compose sets `/app/data/career-forge.db`. |
| `CODEX_OAUTH_ENABLED` | Only literal `true` enables Codex OAuth; example/default is `false`. |
| `CREDENTIAL_ENCRYPTION_KEY` | Canonical base64 encoding of exactly 32 random bytes; required for enabled OAuth. |
| `CODEX_MODEL` | Default model identifier for a connection; checked-in default is `gpt-5.6-sol`, not a promise of upstream availability. |
| `MODEL_BASE_URL` | Optional administrator OpenAI-compatible API prefix, e.g. `https://model.example.com/v1`. |
| `MODEL_API_KEY` | Administrator provider secret; required with URL and model. |
| `MODEL_NAME` | Administrator chat-completions model identifier. |
| `MODEL_ALLOW_INSECURE_LOCAL` | Only literal `true` permits HTTP for the supported private/loopback destinations; default `false`. See [endpoint restrictions](security.md#custom-model-endpoints). |

Restart the application after changing deployment environment variables. Never commit real `.env` files or encryption keys.

## Optional model connections

### Per-user Codex device OAuth (experimental)

1. Generate an encryption key into a restricted file without printing its value. Run this from a protected directory outside the repository; the command refuses to overwrite an existing file:

   ```bash
   node -e 'const fs = require("node:fs"); fs.writeFileSync("career-forge-credential.key", require("node:crypto").randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });'
   ```

2. Securely provision that value as `CREDENTIAL_ENCRYPTION_KEY` for a direct runtime, or `CAREER_FORGE_CREDENTIAL_ENCRYPTION_KEY` for the supplied Compose file. Set `CODEX_OAUTH_ENABLED=true`. Keep a protected backup of the key separately from database backups.
3. Sign into the workspace through Authelia, open **Settings**, and start the Codex connection. Complete the device authorization yourself at the OpenAI URL shown; never share the device code, password, or MFA response. Return to Settings to finish connecting. Pending authorization requires another completion attempt after authorization.
4. Once connected, edit the model identifier if necessary. The field validates identifier syntax only; there is no dynamic catalog or model-access check.
5. Generate a plan and inspect the result. “Connected” is not proof of inference access. Reauthorize when required. Disconnect deletes the local connection and pending flows, not the upstream grant or historical backups.

This integration uses Codex device authorization and the consumer Codex Responses surface. Plan eligibility, quotas, model access, and protocol stability may vary; no free/unlimited usage, generic API billing credit, or live upstream validation is promised. Provider policies govern transmitted data.

With OAuth enabled, unavailable/misconfigured runtime, missing connection, refresh failure, or model failure yields deterministic tailoring. It does **not** use the administrator API credentials as a hidden fallback.

### Administrator OpenAI-compatible provider

Set `CODEX_OAUTH_ENABLED=false` and supply all three of `MODEL_BASE_URL`, `MODEL_API_KEY`, and `MODEL_NAME`. Requests append `/chat/completions` to the API prefix. An incomplete configuration keeps tailoring deterministic. Endpoint rejection or inference/validation failure also falls back deterministically.

The checked-in Compose file does **not** forward the `MODEL_*` variables or `AUTH_ALLOWED_USERS`. Merely adding them to its interpolation `.env` file will not configure the container. If needed, use a private, reviewed Compose override that explicitly forwards these variables; keep secrets out of tracked files. Settings' “Administrator model fallback” status reports variable presence, not endpoint validity or permission to use it while OAuth is enabled.

## Production Compose

[compose.production.yml](../compose.production.yml) is an application service example, not a full authentication stack. Before starting it:

- Configure Traefik, TLS, and Authelia separately. Require strong authentication, an explicit restricted access rule, and deny everyone else.
- Create/use a dedicated external proxy network; only the trusted proxy and application should join it. The proxy must overwrite identity headers from Authelia and block unauthenticated requests.
- Do not add `ports:` or publish port 3000. `EXPOSE 3000` in the Dockerfile is image metadata, not a host mapping.
- Protect the Docker host, environment file, data, and backups. See [security constraints](security.md).

Copy the example into a protected `.env` file for Compose interpolation (distinct from Next.js's `.env.local`), then replace the placeholder hostname and infrastructure names for your environment:

```bash
cp .env.example .env
chmod 600 .env
```

| Compose variable | Checked-in default / purpose |
| --- | --- |
| `CAREER_FORGE_HOST` | `career.example.com`; replace with your own hostname |
| `CAREER_FORGE_AUTH_ALLOWED_GROUPS` | `admins`; restrict to your chosen group |
| `CAREER_FORGE_PROXY_NETWORK` | `career_proxy`; an existing external network also joined by Traefik |
| `CAREER_FORGE_AUTH_MIDDLEWARE` | `authelia@docker`; your authenticated middleware |
| `CAREER_FORGE_ENTRYPOINT` | `websecure` |
| `CAREER_FORGE_CERT_RESOLVER` | `letsencrypt` |
| `CAREER_FORGE_DATA_SOURCE` | `career_forge_data`; named-volume service source, or an absolute pre-created bind path |
| `CAREER_FORGE_DATA_VOLUME` | `career_forge_data`; actual named-volume name |
| `CAREER_FORGE_CREDENTIAL_ENCRYPTION_KEY` | Empty; forwarded as `CREDENTIAL_ENCRYPTION_KEY` |
| `CODEX_OAUTH_ENABLED`, `CODEX_MODEL` | Forwarded to runtime; defaults `false`, `gpt-5.6-sol` |

Keep `CAREER_FORGE_DATA_SOURCE=career_forge_data` for named-volume use; rename its actual Docker volume with `CAREER_FORGE_DATA_VOLUME`. Arbitrary source names are not automatically declared as volumes.

After configuring and reviewing the proxy boundary:

```bash
docker compose --env-file .env -f compose.production.yml config --quiet
docker compose --env-file .env -f compose.production.yml up -d --build career-forge
docker compose --env-file .env -f compose.production.yml ps
docker compose --env-file .env -f compose.production.yml exec career-forge node -e 'fetch("http://127.0.0.1:3000/api/health").then(r => { console.log(r.status); if (!r.ok) process.exit(1); }).catch(() => process.exit(1))'
```

Verify container health, logs without secrets, data ownership, and absence of host port bindings. Test that anonymous requests to **both** `/` and `/api/health` require authentication at the public proxy; verify TLS and an authorized request separately. A successful internal health response is not proof of a secure deployment. Inspect runtime image assets/notices and exercise imports/exports before treating packaging as verified.

### Storage ownership

The named volume is the default so Docker can initialize it from `/app/data`, owned by image user/group **1001:1001**. A pre-existing volume still needs an ownership check.

For a bind mount, choose an absolute path and create it **before** starting Compose. For example, with your chosen `DATA_DIR` set:

```bash
sudo install -d -o 1001 -g 1001 -m 0750 "$DATA_DIR"
```

Set `CAREER_FORGE_DATA_SOURCE` to that absolute path. Do not let Docker silently create a root-owned directory. Existing restored database files must also be writable by `1001:1001`; do not use world-writable permissions to bypass ownership problems.

## Backup and restore

SQLite uses WAL mode. Copying only a live `.db` file can lose committed data or produce an inconsistent backup. Use this conservative stopped-application procedure for either a named volume or bind directory:

1. Record the application revision and effective volume/path privately. Choose a restricted backup location **outside** the repository.
2. Stop the application and ensure no other process writes to the database:

   ```bash
   docker compose --env-file .env -f compose.production.yml stop career-forge
   ```

3. Copy/archive the **entire** persistent data directory while stopped, including any `career-forge.db-wal` and `career-forge.db-shm` files that remain. Preserve ownership and permissions. For named volumes, use a trusted volume-backup utility or stopped-volume helper; do not guess Docker's host storage path. Do not separately copy database/WAL files at different times while a writer is running.
4. Encrypt the backup, restrict access, and back up the matching credential encryption key through a separate protected secret-management channel. A database/key pair exposes credentials; the database alone still exposes career content. Do not put keys or backups in source control, logs, issue attachments, or screenshots.
5. Restart the application with the same Compose configuration after a successful backup. Never use `down -v` as an update or backup step.

To restore, stop all writers, retain a safety copy of current data, and restore the complete consistent snapshot into an empty target data directory/volume. Do not mix a restored database with old WAL/SHM files. Restore file ownership to `1001:1001`, directory mode `0750`, and restrictive writable file modes; provision the matching key separately. Start the app and verify database integrity, profile/jobs/versions, authorization, exports, and connection status. Test restoration periodically in an isolated authenticated environment with outbound model calls disabled.

Losing or replacing the key makes existing encrypted credentials unreadable; there is no automatic key-rotation migration. Plan to reconnect if the matching key cannot be recovered. Old backups may retain deleted credentials, and restored refresh tokens may already be invalid after upstream rotation. Do not copy a grant between running instances.
