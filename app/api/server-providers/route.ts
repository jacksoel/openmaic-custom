import { type NextRequest } from 'next/server';
import {
  getServerProviders,
  getServerTTSProviders,
  getServerASRProviders,
  getServerPDFProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerWebSearchProviders,
} from '@/lib/server/provider-config';
import { canUseProvider } from '@/lib/server/provider-resolver';
import { getSessionUser } from '@/lib/auth';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('ServerProviders');

const EMPTY_PROVIDERS = {};

export async function GET(req: NextRequest) {
  try {
    // When auth is enabled, only expose institutional providers to roles that can use them.
    const authEnabled = process.env.AUTH_ENABLED === 'true';
    if (authEnabled) {
      const user = await getSessionUser(req);
      if (!user || !canUseProvider(user.role, 'institutional')) {
        return apiSuccess({
          providers: EMPTY_PROVIDERS,
          tts: EMPTY_PROVIDERS,
          asr: EMPTY_PROVIDERS,
          pdf: EMPTY_PROVIDERS,
          image: EMPTY_PROVIDERS,
          video: EMPTY_PROVIDERS,
          webSearch: EMPTY_PROVIDERS,
        });
      }
    }

    return apiSuccess({
      providers: getServerProviders(),
      tts: getServerTTSProviders(),
      asr: getServerASRProviders(),
      pdf: getServerPDFProviders(),
      image: getServerImageProviders(),
      video: getServerVideoProviders(),
      webSearch: getServerWebSearchProviders(),
    });
  } catch (error) {
    log.error('Error fetching server providers:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
