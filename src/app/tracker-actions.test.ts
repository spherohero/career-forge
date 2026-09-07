// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CareerRepository} from '@/server/repository';
import {ApplicationTracker} from '@/server/application-tracker';
import {blankWorkbook,inspectWorkbook} from '@/server/tracker-workbook';
import {confirmAppliedAction,createImportedJobAction,uploadWorkbookAction,retryWorkbookAction} from './tracker-actions';
import {updateJobStatusAction} from './actions';
import {GET} from './api/tracker/workbook/route';
const mocks=vi.hoisted(()=>({headers:vi.fn(),repository:vi.fn()}));
vi.mock('next/headers',()=>({headers:mocks.headers}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/database',()=>({getRepository:mocks.repository}));
let repo:CareerRepository;
beforeEach(()=>{vi.stubEnv('AUTH_MODE','authelia');vi.stubEnv('AUTH_ALLOWED_GROUPS','admins');repo=CareerRepository.inMemory();mocks.repository.mockReturnValue(repo);mocks.headers.mockResolvedValue(new Headers({'remote-user':' ALICE ','remote-groups':'admins'}));});
afterEach(()=>{repo.close();vi.unstubAllEnvs();});
const form=(data:Record<string,string>)=>{const f=new FormData();Object.entries(data).forEach(([k,v])=>f.set(k,v));return f;};
it('saves import without applied intent; only affirmative confirmation uses authenticated owner',async()=>{
 const saved=await createImportedJobAction({},form({title:'Engineer',company:'Example',description:'Synthetic engineering role description.',identity:'bob'}));
 expect(saved.jobId).toBeTruthy();
 expect(repo.getJob(saved.jobId!)?.status).toBe('saved');
 expect(repo.pendingTrackerApplications('alice')).toEqual([]);
 await confirmAppliedAction({},form({jobId:saved.jobId!,confirmed:'no'}));
 expect(repo.getJob(saved.jobId!)?.status).toBe('saved');
 const result=await confirmAppliedAction({},form({jobId:saved.jobId!,confirmed:'yes',identity:'bob'}));
 expect(result.message).toMatch(/not synced/);
 expect(repo.pendingTrackerApplications('alice')).toHaveLength(1);
 expect(repo.pendingTrackerApplications('bob')).toEqual([]);
 await uploadWorkbookAction({},form({mode:'blank'}));
 expect(inspectWorkbook(new ApplicationTracker(repo).download('alice')!).nextRow).toBe(3);
 await retryWorkbookAction({},form({jobId:saved.jobId!}));
 expect(inspectWorkbook(new ApplicationTracker(repo).download('alice')!).nextRow).toBe(4);
});
it('status update uses the same idempotent applied service',async()=>{
 const tracker=new ApplicationTracker(repo);tracker.upload('alice',blankWorkbook());
 const job=repo.createJob({title:'Engineer',company:'Example',description:'Synthetic engineering role description.'});
 await updateJobStatusAction(form({jobId:job.id,status:'applied'}));
 await updateJobStatusAction(form({jobId:job.id,status:'applied'}));
 expect(inspectWorkbook(tracker.download('alice')!).nextRow).toBe(4);
});
it('download authorizes and isolates owners with no caching',async()=>{
 new ApplicationTracker(repo).upload('alice',blankWorkbook());
 expect((await GET(new Request('https://example.test/api/tracker/workbook'))).status).toBe(401);
 const headers={'remote-user':'bob','remote-groups':'admins'};
 expect((await GET(new Request('https://example.test/api/tracker/workbook',{headers}))).status).toBe(404);
 headers['remote-user']='ALICE';const response=await GET(new Request('https://example.test/api/tracker/workbook',{headers}));
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(inspectWorkbook(new Uint8Array(await response.arrayBuffer())).nextRow).toBe(3);
});
it('all mutations reject unauthenticated input before repository access',async()=>{
 mocks.headers.mockResolvedValue(new Headers());mocks.repository.mockClear();
 await expect(uploadWorkbookAction({},form({mode:'blank'}))).rejects.toThrow(/Unauthorized/);
 await expect(confirmAppliedAction({},form({jobId:'x',confirmed:'yes'}))).rejects.toThrow(/Unauthorized/);
 expect(mocks.repository).not.toHaveBeenCalled();
});
