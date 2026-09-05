# Security model and limits

[README](../README.md) · [Setup and backups](setup.md)

Career Forge is a private, trusted-operator workspace with optional outbound model assistance. MIT licensing applies to the source; it does not make a running workspace public or its data anonymous. This document describes implemented controls and their limits, not a penetration-test certification.

## Authentication is a deployment boundary

Production forces Authelia-mode authorization. The application trusts `Remote-User` and comma-separated `Remote-Groups` from the reverse proxy, canonicalizing identities with Unicode NFC, trimming, and lowercase. A configured allowed user **or** allowed group grants access.

Pages, Server Actions, Settings operations, and resume download routes apply authorization. Settings derives credential ownership from the authorized identity, never a submitted user field. Client-facing Settings projections allowlist status/model metadata and device-flow display fields; access and refresh tokens stay server-side.

These checks do not authenticate arbitrary headers. A client able to reach the app directly could forge a permitted identity. Therefore:

- Terminate TLS at a trusted proxy, enforce Authelia, and overwrite incoming identity headers with authenticated values.
- Keep the application off published host ports and isolate its proxy network from untrusted containers.
- Restrict Authelia rules and application allowlists; deny everyone else. Protect Docker/host administration separately.
- Keep development with disabled auth on loopback only. All such requests share `local-development` identity.

`/api/health` bypasses app-header authorization for container health and exposes no career content. The public proxy must still require authentication for that path. An internal HTTP 200 proves neither external authentication nor port isolation.

## Shared data versus per-user credentials

**Profiles, imported resume text, jobs, resume versions, and application history are shared across authorized workspace users.** They are not tenant-isolated or encrypted by the application. SQLite and its WAL/SHM files, filesystem snapshots, and backups may expose this data to anyone with sufficient storage access. Use disk/backup encryption, restricted permissions, and an appropriate retention policy.

Codex credentials and pending device-flow secret state are encrypted with AES-256-GCM and random nonces. Authenticated additional data (AAD) binds ciphertext to the canonical identity, provider, purpose, and record ID, preventing simple ciphertext reassignment between these contexts. Connection metadata is not a promise of total database encryption.

The deployment's base64-encoded 32-byte key must remain secret and recoverable. Database encryption of credential fields helps against theft of the database **without** the key; it does not protect against a compromised running server that can access both. There is no automatic key-rotation migration. See [backup and restore](setup.md#backup-and-restore).

Disconnect removes the local connection and pending authorization flows. It does **not** revoke the upstream OpenAI authorization, securely erase historical SQLite pages, or remove credentials from existing backups. Use upstream account controls when revocation is needed, and manage backups accordingly.

## Model data and validation

Model use is optional. Deterministic generation does not need an AI account. When selected, the provider receives relevant verified achievement IDs, text and skills, plus normalized job requirement IDs and text. This is not the entire profile by default, but those selected claims can still contain personal or confidential information. Review them before enabling a provider.

The provider's policies and account terms govern processing and retention; Career Forge cannot guarantee zero retention or exclusion from training. Do not send employer-confidential or sensitive material without appropriate permission. Device authorization separately exchanges authentication data with OpenAI.

Career Forge treats profile/job content as quoted data rather than instructions, bounds requests/responses, and checks structured output and source IDs. Its current claim validator requires presentation-equivalent source/proposal text after NFC normalization, whitespace collapse/trim, and removal of terminal `.?!`, with additional numeric/technology/claim checks. It rejects semantic rewrites, case changes, reordered text, internal punctuation changes, and unsupported claims. This gate limits what enters a proposal; it does not independently establish whether the user's source facts are true, and generated rationale still requires human review.

Malformed output or any invalid proposal discards the whole model response and returns the deterministic plan. Accepted wording replaces only its immutable source achievement; pending/rejected proposals retain the original. Models cannot save profile facts or acceptance decisions.

### Provider selection and OAuth limits

- With `CODEX_OAUTH_ENABLED=true`, only the authorized identity's Codex connection is eligible. Missing credentials, invalid runtime configuration, refresh/authorization errors, and inference failure fall back deterministically—not to administrator credentials.
- Only when OAuth is disabled can the administrator's `MODEL_BASE_URL`, `MODEL_API_KEY`, and `MODEL_NAME` configure the OpenAI-compatible provider. All three are required.
- Codex device OAuth is experimental, not generic identity-only ChatGPT login or a general API billing mechanism. Plan eligibility, quota accounting, supported model access, and upstream stability are not guaranteed. Real upstream OAuth/inference verification is a separate operational gate.
- Settings accepts a syntactically validated model identifier text field; it does not discover a catalog or verify entitlement.

## Custom model endpoints

The administrator OpenAI-compatible provider enforces HTTPS by default, rejects URLs containing embedded credentials, and disables redirects (`redirect: "error"`). Requests have a timeout and a bounded response size.

Literal IPv4 link-local **169.254.0.0/16**, IPv6 link-local **fe80::/10**, and IPv4-mapped IPv6 forms of the blocked IPv4 link-local range are rejected for **both HTTP and HTTPS**. This includes canonicalized URL aliases; opting into local HTTP does not lift these bans. This is not a blanket ban on all IPv4-mapped IPv6 addresses.

With `MODEL_ALLOW_INSECURE_LOCAL=true`, HTTP is supported only for the code's recognized destinations: `localhost`/`.localhost`, IPv4 loopback, RFC 1918 IPv4, CGNAT `100.64.0.0/10`, IPv6 loopback `::1`, and IPv6 unique-local `fc00::/7`. Local HTTP exposes request data and the bearer credential to the underlying network; enable it only for a trusted private service.

**This is not comprehensive SSRF protection.** URL validation does not resolve or pin DNS answers. A hostname—including an HTTPS hostname—can resolve to internal or link-local infrastructure, and DNS rebinding is not prevented. Arbitrary private HTTPS destinations are not comprehensively blocked. Treat endpoint configuration as trusted-administrator input; use a reviewed endpoint allowlist and outbound firewall/network restrictions to deny metadata services and other sensitive destinations. Do not expose endpoint selection to untrusted users.

The Codex client uses fixed OpenAI HTTPS endpoints and disables redirects; these controls likewise do not substitute for host/network security.

## Import and export boundaries

Resume extraction accepts allowlisted PDF, DOCX, and TXT extension/MIME pairs up to 4 MiB. TXT must be valid UTF-8; PDF extraction requires selectable text, not scanned-image OCR. DOCX extraction is text-only. Parsing is lossy and imported text remains `pending_review`, separate from verified facts; review and manually attest before using it.

These validation checks are not malware scanning or a sandbox guarantee for parser dependencies. Keep dependencies patched, use trusted files where possible, and retain container least privilege.

Exports require an existing resume version and its owning job plus the verified profile. Routes validate UUIDs and authorization, sanitize attachment filenames, and use `no-store`. Single-column DOCX/PDF output is designed for machine-readable text, not guaranteed compatibility with every applicant-tracking system. Downloaded files leave the application's access boundary; protect them like the source resume.

## Operational and disclosure checklist

- Review the actual [Dockerfile](../Dockerfile) and [Compose file](../compose.production.yml); verify runtime assets, notices, permissions, health, port isolation, and proxy behavior instead of assuming a build proves them.
- Back up a consistent stopped SQLite data directory, including remaining WAL/SHM files, and safeguard the matching key separately. Exercise restoration before relying on a backup.
- Avoid logging credentials, device codes, raw provider errors, or career text. Protect observability and backup systems too.
- Keep `.env`, databases, exports, private infrastructure identifiers, and real-data screenshots out of source control and issue attachments. `.gitignore` is not a historical secret-removal mechanism.
- Review every published asset and reachable history before making a repository public; reversing visibility cannot recall clones. Draft screenshots are not release-approved evidence.
- Report suspected vulnerabilities privately to the maintainer without including live secrets or unnecessary personal data. No dedicated security reporting channel or response-time guarantee is claimed here.
