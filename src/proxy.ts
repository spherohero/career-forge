import { NextResponse, type NextRequest } from "next/server";
import { authorizeRequest, getAuthConfig } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const result = authorizeRequest(request.headers, getAuthConfig());
  if (result.allowed) {
    const response = NextResponse.next();
    response.headers.set("x-career-forge-user", result.identity);
    return response;
  }

  return new NextResponse("Access requires an authorized Authelia account.", {
    status: result.reason === "missing-identity" ? 401 : 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = {
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico).*)"],
};
