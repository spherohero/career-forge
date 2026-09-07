# App-owned application workbook

[README](../README.md) · [Security](security.md)

## Set up once

Open **Profile → Excel workbook**. Upload a plain `.xlsx` up to 4 MiB, or choose **Create blank workbook**. Career Forge keeps a private copy associated with the authenticated identity. It never opens or modifies the original local or cloud file. No cloud spreadsheet registration, credentials, or integration is needed.

An uploaded workbook must contain `Sheet1` with these headers in `B2:K2`, in order (case-insensitive):

`Company | Position | Location | pos # | pay | post date | apply date | close date | response | website`

Existing data rows and formulas are retained, as are other ZIP parts and existing styles. New rows go after the last cell with data or a formula, ignoring trailing style-only rows. Existing destination formatting is retained; otherwise styles are copied from the previous data row. Newly imported values are literal text, not formulas. Existing formulas are preserved but not recalculated by the app.

Unsupported files are rejected without replacing the current workbook: macros, tables, external connections, embedded objects, protected tracker sheets, merged data cells, malformed XML and oversized archives. Parsing also limits expanded size, part count and row count. Upload replacement is intentionally disabled to protect history. Download and back up the current workbook before making independent edits; there is no re-upload/merge workflow.

## Add confirmed applications

1. In **Add role**, enter a public job-listing URL and choose **Preview job link**. The current extractor supports a single structured JSON-LD `JobPosting`; JavaScript-only listings, sign-in walls, ambiguous listings and unsupported pages require manual paste.
2. Review and edit the preview. Unknown fields stay blank; required role/company/description fields must be completed before saving.
3. Save the imported job. The job is saved before the **Have you applied?** dialog opens.
4. Choose **Yes, I applied** only after submitting an application. No, Close or Escape leaves the job saved and writes nothing to Excel.

Selecting **applied** and saving the stage in a job workspace is also explicit confirmation. Both paths use the same service. Each job is appended at most once for an identity, even after retries or stage toggles. Independently imported duplicate listings are distinct jobs.

The workbook row includes edited listing metadata and the first confirmation date (UTC). Unknown fields and response remain blank. Later job edits or stage changes do not rewrite the historical row.

## Download, retries and storage

**Download latest workbook** is available in Profile and each job workspace. The authenticated route serves only the current identity's copy, with private/no-store caching; another authorized identity cannot select it using a URL parameter. Downloaded files leave the app's access boundary.

Applied status is recorded even if no workbook exists or an append fails. Profile and the job workspace show the pending confirmation. Upload/create a workbook, then choose **Retry workbook sync**. Uploading never adds old jobs automatically. Bytes and the sync marker commit together in a serialized SQLite transaction, so retries cannot duplicate a committed row.

Workbook bytes and pending confirmations are in the existing SQLite database and covered by its backup/restore procedure. They are not encrypted by the application. Jobs, profile and application history remain shared workspace data; only workbook selection and append deduplication are per identity. Restrict storage and backup access.
