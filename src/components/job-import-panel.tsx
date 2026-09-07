'use client';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { confirmAppliedAction, createImportedJobAction, importJobUrlAction, type TrackerState } from '@/app/tracker-actions';
import type { ListingPreview } from '@/server/job-import';
import { NewJobForm } from './new-job-form';

export function AppliedConfirmation({jobId}:{jobId:string}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message,setMessage] = useState('Job saved. No application recorded yet.');
  const [pending,startTransition] = useTransition();
  useEffect(()=>{dialog.current?.showModal();},[]);
  function dismiss() { if (!pending) {dialog.current?.close();setMessage('Job saved; no application recorded.');} }
  function confirm() {
    startTransition(async()=>{
      const data=new FormData();data.set('jobId',jobId);data.set('confirmed','yes');
      try { const result=await confirmAppliedAction({},data);setMessage(result.message ?? 'Check application status in the workspace.');dialog.current?.close(); }
      catch { setMessage('Could not verify the application update. Open the workspace to check status and retry safely.');dialog.current?.close(); }
    });
  }
  return <section className="panel form-stack"><p role="status">{message}</p><a className="button button-primary" href={`/jobs/${jobId}`}>Open saved workspace</a><a className="text-link" href="/profile">Workbook and pending syncs</a>
    <dialog ref={dialog} className="applied-dialog" aria-labelledby="applied-title" onCancel={event=>{event.preventDefault();dismiss();}}>
      <div className="form-stack"><p className="eyebrow">Application check</p><h2 id="applied-title">Have you applied?</h2><p>The job is saved. Choose Yes only if you submitted an application. This records Applied and appends it to your workbook.</p>
      <button className="button button-primary" type="button" disabled={pending} onClick={confirm}>{pending?'Recording application…':'Yes, I applied'}</button>
      <button className="button button-secondary" type="button" disabled={pending} onClick={dismiss}>No, keep saved</button><button className="text-link" type="button" disabled={pending} onClick={dismiss}>Close</button></div>
    </dialog></section>;
}
function ListingEditor({preview}:{preview:ListingPreview}) {
  const [state,action,pending]=useActionState(createImportedJobAction,{} as TrackerState);
  if (state.jobId) return <AppliedConfirmation jobId={state.jobId}/>;
  return <form action={action} className="panel form-stack"><div><p className="eyebrow">Extracted, not verified</p><h2>Review listing</h2><p className="form-help">Correct these fields before saving. Missing metadata stays blank.</p></div>
    <div className="form-grid two-column">{([['title','Role title'],['company','Company'],['location','Location'],['salary','Pay'],['positionId','Position number'],['postedAt','Post date'],['closesAt','Close date']] as const).map(([key,label])=><div key={key}><label htmlFor={`import-${key}`}>{label}</label><input id={`import-${key}`} name={key} defaultValue={preview[key]} required={key==='title'||key==='company'} maxLength={key==='salary'?120:key==='postedAt'||key==='closesAt'?40:160}/>{state.errors?.[key] && <p className="field-error">{state.errors[key].join(' ')}</p>}</div>)}</div>
    <div><label htmlFor="import-posting-url">Posting URL</label><input id="import-posting-url" name="url" type="url" defaultValue={preview.url}/></div>
    <div><label htmlFor="import-description">Original job description</label><textarea id="import-description" name="description" defaultValue={preview.description} rows={12} minLength={20} maxLength={100000} required/>{state.errors?.description && <p className="field-error">{state.errors.description.join(' ')}</p>}</div>
    <p role="status" className="form-message">{state.message}</p><button disabled={pending} className="button button-primary" type="submit">{pending?'Saving…':'Save imported job'}</button>
  </form>;
}
export function JobImportPanel() {
  const [state,action,pending]=useActionState(importJobUrlAction,{} as TrackerState);
  return <div className="form-stack"><section className="panel form-stack"><div><p className="eyebrow">Start with the source</p><h2>Import a job link</h2><p className="form-help">Public listings only. Sign-in walls and unsupported pages need manual paste; importing never means you applied.</p></div>
    <form action={action} className="form-stack"><div><label htmlFor="import-url">Job listing URL</label><input type="url" id="import-url" name="importUrl" required maxLength={4096} placeholder="https://…"/></div><button className="button button-secondary" disabled={pending} type="submit">{pending?'Reading listing…':'Preview job link'}</button></form><p className="form-message" role="status">{state.message}</p></section>
    {state.preview ? <ListingEditor key={JSON.stringify(state.preview)} preview={state.preview}/> : <><h2>Or enter it manually</h2><NewJobForm/></>}
  </div>;
}
