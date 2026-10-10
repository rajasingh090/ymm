import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "gympulse_session";
const ACCESS_PASSWORD = process.env.GYMPULSE_ACCESS_PASSWORD ?? "";
const SIGNING_SECRET = process.env.GYMPULSE_AUTH_SECRET || ACCESS_PASSWORD;
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export function isAuthenticationEnabled() {
  return ACCESS_PASSWORD.length > 0 && SIGNING_SECRET.length > 0;
}

function sign(expiresAt: string) {
  return createHmac("sha256", SIGNING_SECRET).update(expiresAt).digest("hex");
}

export function hasValidSession(request: NextRequest) {
  if (!isAuthenticationEnabled()) return true;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || !/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;
  const expected = sign(expiresAt);
  const providedBytes = Buffer.from(signature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export function requireGymPulseAuth(request: NextRequest) {
  if (!isAuthenticationEnabled() || hasValidSession(request)) return null;
  return NextResponse.json({ error: "Please unlock GymPulse AI to continue." }, { status: 401 });
}

export async function login(request: NextRequest) {
  if (!isAuthenticationEnabled()) {
    return NextResponse.json({ protected: false, authenticated: true });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your access password." }, { status: 400 });
  }

  const password = payload && typeof payload === "object" && "password" in payload
    ? (payload as { password?: unknown }).password
    : undefined;
  if (typeof password !== "string" || password.length > 256) {
    return NextResponse.json({ error: "Enter your access password." }, { status: 400 });
  }

  const submitted = Buffer.from(password);
  const expected = Buffer.from(ACCESS_PASSWORD);
  const matches = submitted.length === expected.length && timingSafeEqual(submitted, expected);
  if (!matches) return NextResponse.json({ error: "That password did not match." }, { status: 401 });

  const expiresAt = String(Date.now() + SESSION_SECONDS * 1000);
  const response = NextResponse.json({ protected: true, authenticated: true });
  response.cookies.set(COOKIE_NAME, `${expiresAt}.${sign(expiresAt)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return response;
}

export function authStatus(request: NextRequest) {
  return NextResponse.json({
    protected: isAuthenticationEnabled(),
    authenticated: !isAuthenticationEnabled() || hasValidSession(request),
  });
}

export function logout() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
