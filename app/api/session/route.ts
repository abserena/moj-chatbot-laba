import { NextResponse } from "next/server";
import { authConfigured, COOKIE_NAME, cookieOptions, createSession, passwordMatches, sameOrigin } from "../../lib/auth.server";

export const runtime = "nodejs";
// Limit lokalny dla całej instancji, nie globalny dla hostingu.
// Na hostingu dodaj WAF: POST /api/session, 5/min/IP.
const limiter = globalThis as typeof globalThis & { chatLoginWindow?: { start: number; count: number } };
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Niedozwolone źródło żądania.", { status: 403 });
  if (!authConfigured()) return new Response("Brak konfiguracji CHAT_PASSWORD lub SESSION_SECRET. Dostęp zablokowany.", { status: 503 });
  const now = Date.now();
  if (!limiter.chatLoginWindow || now - limiter.chatLoginWindow.start >= 60_000) {
    limiter.chatLoginWindow = { start: now, count: 0 };
  }
  if (++limiter.chatLoginWindow.count > 5) {
    const wait = Math.max(1, Math.ceil((limiter.chatLoginWindow.start + 60_000 - now) / 1000));
    return new Response("Za dużo prób. Odczekaj minutę i spróbuj ponownie.", { status: 429, headers: { "Retry-After": String(wait) } });
  }
  let password;
  try {
    const text = await request.text();
    if (text.length > 4096) return new Response("Za długie żądanie.", { status: 413 });
    password = JSON.parse(text).password;
    if (typeof password !== "string" || !password.trim() || password.length > 1024) throw new Error();
  } catch { return new Response("Wpisz hasło.", { status: 400 }); }
  if (!passwordMatches(password)) return new Response("Nieprawidłowe hasło.", { status: 401 });
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(COOKIE_NAME, createSession(), cookieOptions());
  return response;
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return new Response("Niedozwolone źródło żądania.", { status: 403 });
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(COOKIE_NAME, "", { ...cookieOptions(), maxAge: 0, expires: new Date(0) });
  return response;
}
