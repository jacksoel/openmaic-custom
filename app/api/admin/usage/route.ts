/**
 * Admin Usage API — Phase 4.3
 *
 * GET /api/admin/usage — Query usage logs (admin only)
 * GET /api/admin/usage?aggregate=true — Get aggregated usage stats
 *
 * Query params:
 *   userId       — Filter by user ID
 *   providerSlug — Filter by provider (e.g. 'openai', 'anthropic')
 *   model        — Filter by model name
 *   startDate    — ISO date string (inclusive)
 *   endDate      — ISO date string (inclusive)
 *   limit        — Max results (default 100, max 1000)
 *   offset       — Pagination offset
 *   groupBy      — Aggregation key: 'userId' | 'providerSlug' | 'model' | 'day'
 *                  (only used with aggregate=true)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { queryUsage, aggregateUsage, type UsageQuery } from '@/lib/server/usage-logger';
import { apiError, API_ERROR_CODES } from '@/lib/server/api-response';

export async function GET(req: NextRequest) {
  // Auth check: admin only
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  if (authEnabled) {
    const user = await getSessionUser(req);
    if (!user) {
      return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
    }
    if (!isAdmin(user)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Admin access required');
    }
  }

  const url = new URL(req.url);
  const isAggregate = url.searchParams.get('aggregate') === 'true';

  const query: UsageQuery = {
    userId: url.searchParams.get('userId') ?? undefined,
    providerSlug: url.searchParams.get('providerSlug') ?? undefined,
    model: url.searchParams.get('model') ?? undefined,
    startDate: url.searchParams.get('startDate') ?? undefined,
    endDate: url.searchParams.get('endDate') ?? undefined,
    limit: Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 1000),
    offset: parseInt(url.searchParams.get('offset') ?? '0'),
    groupBy: (url.searchParams.get('groupBy') as UsageQuery['groupBy']) ?? undefined,
  };

  try {
    if (isAggregate) {
      const aggregates = aggregateUsage(query);
      return NextResponse.json({ aggregates, total: aggregates.length });
    } else {
      const logs = queryUsage(query);
      return NextResponse.json({ logs, total: logs.length });
    }
  } catch (error) {
    console.error('[Admin Usage API] Error querying usage logs:', error);
    return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'Failed to query usage logs');
  }
}
