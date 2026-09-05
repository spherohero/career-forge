# Screenshot provenance — fictional demonstration

These are real Chromium captures of the production-mode Career Forge UI, not mockups. Every person, employer, vacancy, achievement and pipeline event is synthetic. “Verified” refers to fixture attestation in the application, not a real person's credentials. No production database or real provider credentials were used.

| Asset | Pixels | Framing |
| --- | --- | --- |
| `dashboard.png` | 1440 × 960 | Desktop viewport |
| `dashboard-mobile.png` | 390 × 1200 | Tall mobile viewport, all five navigation links visible |
| `evidence-map.png` | 1052 × 476 | Actual `.analysis-panel` element at desktop width |
| `tailoring-review.png` | 1052 × 876 | Actual `.tailoring-panel` element at desktop width |

## Fixture recipe

Create a new temporary SQLite database outside the checkout with `CareerRepository.open`. Save a fictional profile named `Alex Example — fictional demo`, email `alex@example.test`, with three explicitly verified skills: Python, Linux, Git. Under `Example Studio (fictional)` / `Software Engineer`, add these explicitly verified achievements, each with the corresponding single skill:

- Built Python tools to validate sample datasets. Evidence: `Fictional demo · validation-tool project notes`.
- Maintained Linux environments for internal development. Evidence: `Fictional demo · environment maintenance log`.
- Reviewed Git changes and documented release procedures. Evidence: `Fictional demo · release checklist`.

No projects or education are needed. Create these four remote jobs using `createJob` and `updateJobStatus`:

| Title | Fictional employer | Stage |
| --- | --- | --- |
| Developer Tools Engineer | Sample Works (demo) | saved |
| Platform Engineer | Example Systems (demo) | applied |
| Software Engineer | Demo Labs (fictional) | interview |
| Python Tools Engineer | Example Studio (demo) | tailoring |

Use this posting for the jobs, without a company introduction or duration requirements:

```text
Required qualifications:
- Build Python tools for data validation.
- Maintain Linux development environments.
- Review Git changes and document releases.
Preferred qualifications:
- Develop Rust services.
```

For the Python Tools Engineer job, call `analyzeJobFit(profile, job)`, then `buildDeterministicTailoringPlan(profile, job, analysis)` and persist with `createResumeVersion(job.id, plan)`. Assert exactly four normalized requirements, three matches and one Rust gap. The parser correctly excludes both qualification headings. This uses the real deterministic engine; no generated wording or AI success is simulated.

## Capture procedure

Use the existing production `.next` build with a fresh `next start --hostname 127.0.0.1 --port <unused-port>` process. Explicitly supply `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, `AUTH_MODE=authelia`, allowed synthetic user/group `fictional-demo`, the isolated `DATABASE_PATH`, `CODEX_OAUTH_ENABLED=false`, and empty `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_NAME`. Do not inherit provider credentials. Preload a server-side `globalThis.fetch` replacement that throws for every request; abort every browser request outside the exact loopback origin. No upstream mock or OAuth connection is needed for these images.

Use headless Playwright Chromium, device scale factor 1, and `Remote-User: fictional-demo`. Wait for `document.fonts.ready`. Capture `/` at the desktop and mobile dimensions above. On `/jobs/<synthetic-job-id>`, capture the actual evidence panel. Click the first proposal's **Accept** button, verify its accepted status, reload and verify persistence, then capture the complete tailoring panel. No DOM text/style substitutions, compositing, browser chrome or dev toolbar are included. Element screenshots provide tight framing without resizing text.

## Verification and limitations

- Fresh loopback server: health HTTP 200, anonymous root HTTP 401.
- Actual browser assertions: four role rows, three matched requirements, one Rust gap, acceptance persisted after reload, five mobile links, no horizontal overflow at 390px, no page errors.
- All four final PNGs inspected visually: readable content, complete cards, clear review states and no private identifiers or developer chrome. The mobile view is deliberately tall, not a claim that all content fits a short phone viewport.
- PNGs contain no embedded metadata; no postprocessing was needed. All assets are below 111 KB individually.
- The deterministic plan was seeded through application functions, not through a model or the Generate button. This capture does not validate real OAuth, inference, download contents, deployment, or comprehensive responsive QA. Settings was intentionally not included.
- All four assets received a separate parent-agent visual review and are embedded in the README. Screenshot approval does not authorize repository publication or deployment; those remain separate release gates.
