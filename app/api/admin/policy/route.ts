import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser, isAdmin } from '@/lib/auth';

const ENV_FILE = '/home/openclaw/OpenMAIC/.env.local';

export async function GET(req: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED !== 'false';
  if (authEnabled) {
    const user = await getSessionUser(req);
    if (!user) return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
    if (!isAdmin(user)) return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Admin access required');
  }

  return apiSuccess({
    allowedEmailDomains: process.env.ALLOWED_EMAIL_DOMAINS || '',
    defaultModel: process.env.DEFAULT_MODEL || '',
    authEnabled: process.env.AUTH_ENABLED !== 'false',
    hasAccessCode: Boolean(process.env.ACCESS_CODE),
  });
}

export async function PATCH(req: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED !== 'false';
  if (authEnabled) {
    const user = await getSessionUser(req);
    if (!user) return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
    if (!isAdmin(user)) return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Admin access required');
  }

  try {
    const body = await req.json();
    const { allowedEmailDomains, defaultModel } = body;

    let content = '';
    try {
      content = await fs.readFile(ENV_FILE, 'utf-8');
    } catch {
      content = '';
    }

    const updated: string[] = [];

    function upsertEnvLine(fileContent: string, key: string, value: string): string {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(fileContent)) {
        return fileContent.replace(regex, `${key}=${value}`);
      }
      const separator = fileContent.endsWith('\n') || fileContent === '' ? '' : '\n';
      return fileContent + separator + `${key}=${value}\n`;
    }

    if (allowedEmailDomains !== undefined) {
      content = upsertEnvLine(content, 'ALLOWED_EMAIL_DOMAINS', allowedEmailDomains);
      updated.push('allowedEmailDomains');
    }

    if (defaultModel !== undefined) {
      content = upsertEnvLine(content, 'DEFAULT_MODEL', defaultModel);
      updated.push('defaultModel');
    }

    await fs.writeFile(ENV_FILE, content, 'utf-8');

    return apiSuccess({
      success: true,
      updated,
      notice: 'Changes require a container restart to take effect.',
    });
  } catch (error) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to update policy',
      error instanceof Error ? error.message : String(error),
    );
  }
}
