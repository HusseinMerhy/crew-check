// Passcode gate for the whole site (proof of concept).
// The passcode lives in Vercel as the environment variable SITE_PASSCODE, never in this code.
// Switch: if SITE_PASSCODE is set in Vercel the site is locked; if it is removed the site is open.
// Turn the lock back on before the real checker goes live (it spends API credit).
import { NextResponse } from "next/server";

// Compare two secrets without leaking how much of the guess was right.
// A plain `given === passcode` stops at the first character that differs, so a guess with a
// correct first character takes measurably longer than one that is wrong straight away, and
// enough timed guesses recover the passcode one character at a time. Hashing both sides first
// makes every comparison the same length whatever was guessed, and the loop below always walks
// all 32 bytes before deciding. Web Crypto is used because this runs in the Edge runtime:
// do not import node:crypto here, it is not available.
async function sameSecret(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function middleware(req) {
  const passcode = process.env.SITE_PASSCODE;
  if (!passcode) return NextResponse.next();
  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (await sameSecret(given, passcode)) return NextResponse.next();
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
