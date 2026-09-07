import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppliedConfirmation } from './job-import-panel';
const mocks=vi.hoisted(()=>({confirm:vi.fn()}));
vi.mock('@/app/tracker-actions',()=>({confirmAppliedAction:mocks.confirm,importJobUrlAction:vi.fn(),createImportedJobAction:vi.fn()}));
beforeEach(()=>{mocks.confirm.mockReset();mocks.confirm.mockResolvedValue({message:'Applied recorded and workbook updated.',success:true});HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};});
it.each(['No, keep saved','Close'])('dismissal via %s never records an application',async name=>{
 render(<AppliedConfirmation jobId="example"/>);
 fireEvent.click(screen.getByRole('button',{name}));
 expect(mocks.confirm).not.toHaveBeenCalled();
 expect(screen.getByText('Job saved; no application recorded.')).toBeInTheDocument();
});
it('Escape never records an application',()=>{
 render(<AppliedConfirmation jobId="example"/>);
 fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true,cancelable:true}));
 expect(mocks.confirm).not.toHaveBeenCalled();
});
it('only Yes posts explicit confirmation and shows the workbook outcome',async()=>{
 render(<AppliedConfirmation jobId="example"/>);
 fireEvent.click(screen.getByRole('button',{name:'Yes, I applied'}));
 await waitFor(()=>expect(mocks.confirm).toHaveBeenCalledOnce());
 expect(mocks.confirm.mock.calls[0][1].get('confirmed')).toBe('yes');
 expect(await screen.findByText('Applied recorded and workbook updated.')).toBeInTheDocument();
});
