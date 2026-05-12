/**
 * OpenMAIC Auth API Route Handler
 *
 * Mounts better-auth's handler at /api/auth/[...all]
 * Only active when AUTH_ENABLED=true.
 *
 * Adds email domain validation on signup requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAllowedEmailDomain } from '@/lib/auth';

let _authHandler: ((request: Request) => Promise<Response>) | null = null;

async function getAuthHandler() {
  if (!_authHandler) {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    _authHandler = auth.handler;
  }
  return _authHandler!;
}

export async function GET(req: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  if (!authEnabled) {
    return NextResponse.json({ success: false, error: 'Auth not enabled' }, { status: 404 });
  }

  const handler = await getAuthHandler();
  return handler(req);
}

export async function POST(req: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  if (!authEnabled) {
    return NextResponse.json({ success: false, error: 'Auth not enabled' }, { status: 404 });
  }

  // Intercept signup requests to enforce email domain restriction
  // better-auth paths: /api/auth/sign-up/email (or /sign-up/email-password)
  const url = new URL(req.url);
  const pathname = url.pathname.toLowerCase();
  if (pathname.includes('/sign-up')) {
    try {
      const body = await req.json();
      const email = body?.email;
      if (email && !isAllowedEmailDomain(email)) {
        const allowedDomains = process.env.ALLOWED_EMAIL_DOMAINS || 'tstc.edu';
        return NextResponse.json(
          {
            success: false,
            error: `Registration is restricted to institutional email domains. Allowed: ${allowedDomains}`,
          },
          { status: 400 },
        );
      }
      // Reconstruct the request since we consumed the body
      const newReq = new NextRequest(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(body),
      });
      const handler = await getAuthHandler();
      return handler(newReq);
    } catch {
      // If we can't parse the body, let better-auth handle it
    }
  }

  const handler = await getAuthHandler();
  return handler(req);
}
