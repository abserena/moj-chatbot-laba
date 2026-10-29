import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "chat_session";
export const SESSION_SECONDS = 2 * 60 * 60;
export function authConfigured() {
  return Boolean(process.env.CHAT_PASSWORD?.trim() && (process.env.SESSION_SECRET?.length ?? 0) >= 32);
}
function signature(payload: string) {
  // Zmiana hasła lub sekretu unieważnia wcześniejsze sesje.
  const key = createHmac("sha256", process.env.SESSION_SECRET!).update(process.env.CHAT_PASSWORD!).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}
export function passwordMatches(value: string) {
  if (!authConfigured()) return false;
  const hash = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(hash(value), hash(process.env.CHAT_PASSWORD!));
}
export function createSession(now = Date.now()) {
  if (!authConfigured()) throw new Error("Brak konfiguracji ochrony.");
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(now / 1000) + SESSION_SECONDS,
    nonce: randomBytes(24).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function verifySession(token: string | undefined, now = Date.now()) {
  if (!authConfigured() || !token || token.length > 1024) return false;
  try {
    const [payload, provided, extra] = token.split(".");
    if (!payload || !provided || extra !== undefined) return false;
    const expected = Buffer.from(signature(payload));
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    const time = Math.floor(now / 1000);
    return Number.isInteger(data.exp) && data.exp > time && data.exp <= time + SESSION_SECONDS && typeof data.nonce === "string";
  } catch { return false; }
}
export function requestHasSession(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map(value => value.trim())
    .find(value => value.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return verifySession(token);
}
export function sameOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    return ["http:", "https:"].includes(origin.protocol) && origin.host === request.headers.get("host");
  } catch { return false; }
}
export function cookieOptions() {
  return { httpOnly: true, sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_SECONDS };
}
