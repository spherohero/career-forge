import { randomUUID } from 'node:crypto';
import type { CareerRepository } from './repository';
import { appendApplication, inspectWorkbook } from './tracker-workbook';

/** SQLite IMMEDIATE transactions serialize writers, including across processes.
 * Bytes and revision commit together; failed sync leaves the applied intent retryable.
 * No filesystem revision can get ahead of the database after a crash. */
export class ApplicationTracker {
  constructor(private repository: CareerRepository, _legacyDirectory?: string) { void _legacyDirectory; }
  private write(bytes: Uint8Array): string {
    const revision = randomUUID();
    this.repository.storeTrackerBytes(revision, bytes);
    return revision;
  }
  upload(owner: string, bytes: Uint8Array): void {
    inspectWorkbook(bytes);
    this.repository.installTrackerWorkbook(owner, () => this.write(bytes));
  }
  download(owner: string): Uint8Array | null {
    return this.repository.downloadTrackerWorkbook(owner);
  }
  status(owner: string) {
    return { workbook: this.repository.getTrackerWorkbook(owner), pending: this.repository.pendingTrackerApplications(owner) };
  }
  confirm(owner: string, jobId: string, note?: string) {
    this.repository.recordApplied(owner, jobId, note);
    return this.retry(owner, jobId);
  }
  retry(owner: string, jobId: string): { synced: boolean; message: string } {
    try {
      this.repository.syncTrackerApplication(owner, jobId, (revision, appliedAt) => {
        const job = this.repository.getJob(jobId);
        if (!job) throw new Error('Job not found.');
        const details = this.repository.getListingDetails(jobId);
        return this.write(appendApplication(this.repository.readTrackerBytes(revision), [
          job.company, job.title, job.location, details.positionId ?? '', job.salary ?? '',
          details.postedAt ?? '', appliedAt.slice(0, 10), details.closesAt ?? '', '', job.url ?? '',
        ]));
      });
      return { synced: true, message: 'Applied recorded and workbook updated.' };
    } catch {
      return { synced: false, message: 'Applied recorded; workbook not synced. Upload or create a workbook in Profile, then retry workbook sync.' };
    }
  }
}
