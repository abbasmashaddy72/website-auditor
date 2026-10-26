import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
const cookieName = 'auditor_session';
function secret(): Buffer {
  const key = process.env.SESSION_SECRET;
  if (!key || key.length < 32) throw Error('SESSION_SECRET must be at least 32 characters');
  return Buffer.from(key);
}
function sign(data: string) {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}
function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function makeSession(): string {
  const payload = `${Date.now() + 86400000}.${randomBytes(12).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}
export function checkSession(value?: string): boolean {
  if (!value) return false;
  const bits = value.split('.');
  if (bits.length !== 3 || !/^\d+$/.test(bits[0])) return false;
  const payload = `${bits[0]}.${bits[1]}`;
  return Date.now() < Number(bits[0]) && equal(sign(payload), bits[2]);
}
export async function authenticated(): Promise<boolean> {
  return checkSession((await cookies()).get(cookieName)?.value);
}
export function verifyPassword(password: string): boolean {
  const expected = process.env.AUDITOR_ADMIN_PASSWORD;
  return Boolean(expected && equal(password, expected));
}
export function setLoginCookie(response: NextResponse) {
  response.cookies.set(cookieName, makeSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 86400,
  });
}
export function clearLoginCookie(response: NextResponse) {
  response.cookies.delete(cookieName);
}
export async function assertApiAccess(request: NextRequest, write = false): Promise<NextResponse | null> {
  if (!(await authenticated()))
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (write) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (!origin || !host || new URL(origin).host !== host)
      return NextResponse.json({ error: 'Cross-origin mutation denied' }, { status: 403 });
  }
  return null;
}
export async function requirePageAuth() {
  if (!(await authenticated())) {
    const { redirect } = await import('next/navigation');
    redirect('/login');
  }
}
