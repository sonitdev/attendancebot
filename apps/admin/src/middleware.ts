import { NextRequest, NextResponse } from 'next/server';

// Organization slugs are a user-facing workspace namespace. This rewrite only
// selects a page; API authorization continues to use the signed organization
// identity, never the URL segment.
const RESERVED_ROOTS = new Set([
  'api', 'login', 'attendance', 'workforce', 'sales', 'reports', 'security',
  'settings', 'telegram-reporting', 'employees', 'projects', '_next', 'favicon.ico',
]);

export function middleware(request: NextRequest) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const [candidate, ...rest] = segments;

  if (!candidate || RESERVED_ROOTS.has(candidate)) return NextResponse.next();

  const internalUrl = request.nextUrl.clone();
  internalUrl.pathname = `/${rest.join('/')}` || '/';
  return NextResponse.rewrite(internalUrl);
}

export const config = {
  matcher: ['/((?!api/v1|_next/static|_next/image).*)'],
};
