import { authorizeRequest, getAuthConfig } from '@/lib/auth';
import { getRepository } from '@/server/database';
import { ApplicationTracker } from '@/server/application-tracker';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = authorizeRequest(request.headers,getAuthConfig());
  const headers = {'Cache-Control':'private, no-store', 'Vary':'Remote-User, Remote-Groups', 'X-Content-Type-Options':'nosniff'};
  if (!auth.allowed) return new Response('Unauthorized',{status:401,headers});
  const bytes = new ApplicationTracker(getRepository()).download(auth.identity);
  if (!bytes) return new Response('Create or upload your workbook in Profile.',{status:404,headers});
  return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="application-tracker.xlsx"'}});
}
