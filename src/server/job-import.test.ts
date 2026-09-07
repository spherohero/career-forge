// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { fetchPublicHtml, parseJobPosting, publicAddress } from './job-import';
it('extracts JobPosting only, leaves absent metadata blank and strips HTML', () => {
  const preview = parseJobPosting('<script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'JobPosting',title:'Engineer',hiringOrganization:{name:'Example'},description:'<p>Build synthetic engineering tools.</p>',identifier:{value:'EX-1'},datePosted:'2026-09-01'}]})+'</script>', 'https://example.test/job');
  expect(preview).toMatchObject({title:'Engineer',company:'Example',description:'Build synthetic engineering tools.',positionId:'EX-1',postedAt:'2026-09-01',salary:'',closesAt:'',location:''});
  expect(() => parseJobPosting('<h1>Sign in</h1>', 'https://example.test/job')).toThrow(/paste/i);
});
it.each(['127.0.0.1','10.0.0.1','169.254.169.254','0.0.0.0','192.0.2.1','224.0.0.1','::1','::','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','64:ff9b::a00:1'])('rejects nonpublic address %s', address => expect(publicAddress(address)).toBe(false));
it('validates all DNS answers and each redirect and passes a pinned address to transport', async () => {
 const resolve = vi.fn().mockResolvedValue([{address:'93.184.216.34',family:4}]);
 const request = vi.fn().mockResolvedValueOnce({status:302,location:'http://127.0.0.1/secret',html:''});
 await expect(fetchPublicHtml('https://example.test/job',{resolve,request})).rejects.toThrow();
 expect(request).toHaveBeenCalledTimes(1);
 expect(request.mock.calls[0][1]).toEqual({address:'93.184.216.34',family:4});
 resolve.mockResolvedValue([{address:'93.184.216.34',family:4},{address:'::1',family:6}]);
 await expect(fetchPublicHtml('https://example.test/job',{resolve,request})).rejects.toThrow();
 expect(request).toHaveBeenCalledTimes(1);
 await expect(fetchPublicHtml('https://user:pass@example.test/job',{resolve,request})).rejects.toThrow();
});
