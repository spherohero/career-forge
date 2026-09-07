'use client';
import { useActionState } from 'react';
import { retryWorkbookAction, uploadWorkbookAction, type TrackerState } from '@/app/tracker-actions';
export function WorkbookRetry({jobId}:{jobId:string}) {
  const [state,action,pending]=useActionState(retryWorkbookAction,{} as TrackerState);
  return <form action={action} className="form-stack"><input type="hidden" name="jobId" value={jobId}/><button className="button button-secondary" disabled={pending} type="submit">{pending?'Syncing…':'Retry workbook sync'}</button><p role="status" className="form-message">{state.message}</p></form>;
}
export function WorkbookPanel({ready,pending}:{ready:boolean;pending:Array<{jobId:string;title:string}>}) {
  const [state,action,busy]=useActionState(uploadWorkbookAction,{} as TrackerState);
  return <section className="panel form-stack workbook-panel"><div><p className="eyebrow">Your application ledger</p><h2>Excel workbook</h2><p className="form-help">Career Forge keeps a private app-owned copy for your signed-in identity. Your original file is never changed. Jobs and profile remain shared.</p></div>
    <a className="button button-secondary" href="/api/tracker/workbook">Download latest workbook</a>
    {ready?<p className="success-message">Workbook ready. Replacement is disabled to protect existing history.</p>:<><p className="form-help">Upload a partially filled .xlsx (up to 4 MiB), or create a blank tracker. Use Sheet1 with headers in B2:K2: Company, Position, Location, pos #, pay, post date, apply date, close date, response, website. Tables, macros, merged data cells, protection and external connections are unsupported.</p><form action={action} className="form-stack"><div><label htmlFor="workbook">Existing Excel workbook</label><input type="file" id="workbook" name="workbook" accept=".xlsx" required/></div><button disabled={busy} className="button button-primary" type="submit">Upload workbook</button></form><form action={action}><input type="hidden" name="mode" value="blank"/><button disabled={busy} className="button button-secondary" type="submit">Create blank workbook</button></form></>}
    <p className="form-help">Only explicit Applied confirmations are appended, once per job for your identity. Uploading does not add historical jobs. Pending confirmations below require a retry; no application is lost if Excel cannot update.</p><p role="status" className="form-message">{state.message}</p>
    {pending.length>0&&<div className="form-stack"><h3>Applied, not synced to workbook</h3>{pending.map(item=><div className="form-stack" key={item.jobId}><a className="text-link" href={`/jobs/${item.jobId}`}>{item.title}</a><WorkbookRetry jobId={item.jobId}/></div>)}</div>}
  </section>;
}
