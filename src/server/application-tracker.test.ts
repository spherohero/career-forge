// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CareerRepository } from './repository';
import { ApplicationTracker } from './application-tracker';
import { blankWorkbook, inspectWorkbook } from './tracker-workbook';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
it('downloads an owner snapshot despite a second connection replacing the revision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-race-')); dirs.push(dir);
  const db = join(dir, 'test.db');
  const a = CareerRepository.open(db), b = CareerRepository.open(db);
  try {
    const ta = new ApplicationTracker(a), tb = new ApplicationTracker(b);
    ta.upload('qa', blankWorkbook());
    const job = a.createJob({ title: 'Synthetic', company: 'Example', description: 'Synthetic engineering role.' });
    const get = a.getTrackerWorkbook.bind(a);
    a.getTrackerWorkbook = owner => {
      const old = get(owner);
      expect(tb.confirm('qa', job.id).synced).toBe(true);
      return old;
    };
    expect(() => inspectWorkbook(ta.download('qa')!)).not.toThrow();
    // With the atomic query there is no metadata gap to intercept; still exercise
    // the real second-connection write and read both pre/post snapshots.
    expect(tb.confirm('qa', job.id).synced).toBe(true);
    expect(inspectWorkbook(ta.download('QA')!).nextRow).toBe(4);
    expect(ta.download('someone-else')).toBeNull();
  } finally { a.close(); b.close(); }
});
it('requires explicit confirmation, isolates owners, and durably deduplicates retries and status toggles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-test-')); dirs.push(dir);
  const db = join(dir, 'test.db');
  let repository = CareerRepository.open(db);
  let tracker = new ApplicationTracker(repository, join(dir, 'workbooks'));
  const job = repository.createJob({ title: 'Engineer', company: 'Example', description: 'Synthetic role description for tests.' });
  tracker.upload('Alice@example.test', blankWorkbook());
  expect(tracker.download('bob@example.test')).toBeNull();
  expect(inspectWorkbook(tracker.download('alice@example.test')!).nextRow).toBe(3);
  expect(repository.getJob(job.id)?.status).toBe('saved');
  expect(tracker.confirm('alice@example.test', job.id).synced).toBe(true);
  repository.close();
  repository = CareerRepository.open(db);
  tracker = new ApplicationTracker(repository, join(dir, 'workbooks'));
  repository.updateJobStatus(job.id, 'saved');
  tracker.confirm('ALICE@example.test', job.id);
  expect(inspectWorkbook(tracker.download('alice@example.test')!).nextRow).toBe(4);
  expect(tracker.status('alice@example.test').pending).toHaveLength(0);
  expect(() => tracker.upload('alice@example.test', blankWorkbook())).toThrow(/already/);
  repository.close();
});
