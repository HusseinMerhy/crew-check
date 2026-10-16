// Passcode gate for the whole site (proof of concept).
// The passcode lives in Vercel as the environment variable SITE_PASSCODE, never in this code.
// If SITE_PASSCODE is not set, the site stays locked (fails closed).
import { NextResponse } from "next/server";

export function middleware(req) {
  const passcode = process.env.SITE_PASSCODE;
  if (!passcode) {
    return new NextResponse("Locked: SITE_PASSCODE is not set in Vercel yet.", { status: 503 });
  }
  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (given === passcode) return NextResponse.next();
    } catch (e) {
      // bad header: fall through to the prompt
    }
  }
  return new NextResponse("Passcode required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Crew Check", charset="UTF-8"' },
  });
}

export const config = { matcher: "/:path*" };
