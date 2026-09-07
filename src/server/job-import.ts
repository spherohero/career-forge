import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';

const MAX_BODY = 2 * 1024 * 1024;
const TIMEOUT = 10_000;
const fallback = () => new Error('Could not import this public listing. Paste the job description and details manually below.');
type Address = { address: string; family: number };
type Page = { status: number; location?: string; html: string };
export function publicAddress(address: string): boolean {
  try { return ipaddr.parse(address).range() === 'unicast'; } catch { return false; }
}
function listingUrl(input: string): URL {
  if (input.length > 4096) throw fallback();
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw fallback();
  url.hash = '';
  return url;
}
/** Keep hostname for Host/TLS validation, but never resolve it again for the socket.
 * agent:false prevents reuse of a connection outside this validated request. */
export function requestPinned(url: URL, address: Address, signal: AbortSignal): Promise<Page> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method: 'GET', agent: false, signal,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      headers: { Accept: 'text/html, application/xhtml+xml', 'Accept-Encoding': 'identity', 'User-Agent': 'CareerForge/1.0 (public job listing import)' },
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301,302,303,307,308].includes(status)) {
        response.destroy(); resolve({ status, location: response.headers.location, html: '' }); return;
      }
      if (status !== 200 || !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers['content-type'] ?? '') || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') || Number(response.headers['content-length'] ?? 0) > MAX_BODY) {
        response.destroy(); reject(fallback()); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) { response.destroy(); reject(fallback()); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({status,html:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => req.destroy(fallback()));
    req.end();
  });
}
export async function fetchPublicHtml(input: string, dependencies: {
  resolve?: (host: string) => Promise<Address[]>;
  request?: typeof requestPinned;
} = {}): Promise<{html:string; url:string}> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const aborted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(fallback()); }, TIMEOUT);
  });
  try {
    return await Promise.race([aborted, (async () => {
      let url = listingUrl(input);
      for (let redirects = 0; redirects <= 4; redirects++) {
        if (controller.signal.aborted) throw fallback();
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(host) ? [{address:host,family:isIP(host)}] : await (dependencies.resolve ?? (host => lookup(host,{all:true,verbatim:true})))(host);
        if (controller.signal.aborted || !addresses.length || addresses.some(item => !publicAddress(item.address))) throw fallback();
        const result = await (dependencies.request ?? requestPinned)(url,addresses[0],controller.signal);
        if (result.status === 200) return {html:result.html,url:url.href};
        if (![301,302,303,307,308].includes(result.status) || !result.location) throw fallback();
        url = listingUrl(new URL(result.location,url).href);
      }
      throw fallback();
    })()]);
  } finally { clearTimeout(timer); controller.abort(); }
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown, limit = 160): string => typeof value === 'string' || typeof value === 'number' ? load(`<div>${String(value)}</div>`).text().trim().slice(0,limit) : '';
export interface ListingPreview { title:string; company:string; location:string; description:string; url:string; salary:string; positionId:string; postedAt:string; closesAt:string }
export function parseJobPosting(html: string, url: string): ListingPreview {
  const $ = load(html);
  const postings: RecordValue[] = [];
  function visit(value: unknown, depth = 0) {
    if (depth > 20) return;
    if (Array.isArray(value)) { value.forEach(item => visit(item,depth+1)); return; }
    const item = record(value);
    if (item['@type'] === 'JobPosting' || (Array.isArray(item['@type']) && item['@type'].includes('JobPosting'))) postings.push(item);
    if (item['@graph']) visit(item['@graph'],depth+1);
  }
  $('script[type="application/ld+json"]').each((_, element) => { try { visit(JSON.parse($(element).text())); } catch { /* unsupported JSON-LD is not evidence */ } });
  if (postings.length !== 1) throw fallback();
  const job = postings[0];
  const locations = Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation];
  const location = locations.map(item => { const a = record(record(item).address); return [a.addressLocality,a.addressRegion,a.addressCountry].map(v => text(v)).filter(Boolean).join(', '); }).filter(Boolean).join('; ').slice(0,160);
  const salary = record(job.baseSalary), amount = record(salary.value);
  const pay = typeof salary.value === 'number' ? String(salary.value) : text(amount.value) || [text(amount.minValue),text(amount.maxValue)].filter(Boolean).join('–');
  return {title:text(job.title),company:text(record(job.hiringOrganization).name),description:text(job.description,100_000),location,url,salary:pay ? [text(salary.currency),pay,text(amount.unitText)].filter(Boolean).join(' ').slice(0,120) : '',positionId:text(record(job.identifier).value || job.identifier),postedAt:text(job.datePosted,40),closesAt:text(job.validThrough,40)};
}
export async function importJobUrl(url: string): Promise<ListingPreview> {
  try { const page = await fetchPublicHtml(url); return parseJobPosting(page.html,page.url); } catch { throw fallback(); }
}
