'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorizeRequest, getAuthConfig } from '@/lib/auth';
import { parseJobForm } from '@/lib/forms';
import { getRepository } from '@/server/database';
import { ApplicationTracker } from '@/server/application-tracker';
import { blankWorkbook, MAX_WORKBOOK_BYTES } from '@/server/tracker-workbook';
import { importJobUrl, type ListingPreview } from '@/server/job-import';
import type { ActionState } from './actions';
export interface TrackerState extends ActionState { jobId?: string; preview?: ListingPreview }
async function owner() {
  const auth = authorizeRequest(await headers(), getAuthConfig());
  if (!auth.allowed) throw new Error('Unauthorized mutation request.');
  return auth.identity;
}
function refresh(jobId?: string) {
  for (const path of ['/', '/profile', '/jobs', '/tracker', ...(jobId ? [`/jobs/${jobId}`] : [])]) revalidatePath(path);
}
export async function uploadWorkbookAction(_state: TrackerState, data: FormData): Promise<TrackerState> {
  const identity = await owner();
  try {
    let bytes: Uint8Array;
    if (data.get('mode') === 'blank') bytes = blankWorkbook();
    else {
      const file = data.get('workbook');
      if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.size > MAX_WORKBOOK_BYTES) return {message:'Choose an .xlsx workbook no larger than 4 MiB.'};
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    new ApplicationTracker(getRepository()).upload(identity,bytes);
    refresh();
    return {success:true,message:'Workbook ready. Existing jobs were not added. Only jobs you explicitly mark Applied will be appended; retry any pending confirmations below.'};
  } catch { return {message:'Workbook not installed. Use Sheet1 with headers in B2:K2 (Company, Position, Location, pos #, pay, post date, apply date, close date, response, website). Plain .xlsx only; replacement is disabled to protect history.'}; }
}
export async function importJobUrlAction(_state: TrackerState, data: FormData): Promise<TrackerState> {
  await owner();
  try { return {preview:await importJobUrl(String(data.get('importUrl') ?? '')),success:true,message:'Review and edit the extracted details. Unknown fields are blank.'}; }
  catch { return {message:'Could not import this public listing. Paste the job description and details manually below.'}; }
}
export async function createImportedJobAction(_state: TrackerState, data: FormData): Promise<TrackerState> {
  await owner();
  const parsed = parseJobForm(data);
  if (!parsed.success) return {errors:parsed.errors,message:'Review the highlighted fields.'};
  const details = z.object({positionId:z.string().max(160),postedAt:z.string().max(40),closesAt:z.string().max(40),salary:z.string().max(120)}).safeParse(Object.fromEntries(['positionId','postedAt','closesAt','salary'].map(key=>[key,String(data.get(key) ?? '').trim()])));
  if (!details.success) return {message:'Listing metadata is too long.'};
  const repo = getRepository();
  const job = repo.createJob({...parsed.data,source:'url import',salary:details.data.salary || undefined});
  repo.saveListingDetails(job.id,details.data);
  refresh();
  return {success:true,jobId:job.id,message:'Job saved. No application recorded yet.'};
}
export async function confirmAppliedAction(_state: TrackerState, data: FormData): Promise<TrackerState> {
  const identity = await owner();
  if (data.get('confirmed') !== 'yes') return {message:'Job stays saved; no application recorded.'};
  const jobId = z.uuid().parse(data.get('jobId'));
  const result = new ApplicationTracker(getRepository()).confirm(identity,jobId);
  refresh(jobId);
  return {success:result.synced,message:result.message,jobId};
}
export async function retryWorkbookAction(_state: TrackerState, data: FormData): Promise<TrackerState> {
  const identity = await owner();
  const jobId = z.uuid().parse(data.get('jobId'));
  const tracker = new ApplicationTracker(getRepository());
  if (!tracker.status(identity).pending.some(item=>item.job_id===jobId)) return {message:'No pending workbook write for this identity.'};
  const result = tracker.retry(identity,jobId);
  refresh(jobId);
  return {success:result.synced,message:result.message};
}
