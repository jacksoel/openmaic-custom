import { test, expect } from '../fixtures/base';
import type { Page, Route } from '@playwright/test';

type TestRole = 'admin' | 'instructor' | 'student';

const TEST_USERS: Record<TestRole, { id: string; email: string; name: string; role: TestRole }> = {
  admin: { id: 'user-admin', email: 'admin@tstc.edu', name: 'Admin User', role: 'admin' },
  instructor: { id: 'user-instructor', email: 'instructor@tstc.edu', name: 'Instructor User', role: 'instructor' },
  student: { id: 'user-student', email: 'student@tstc.edu', name: 'Student User', role: 'student' },
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function setMiddlewareSessionCookie(page: Page, role: TestRole) {
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: `test-session-${role}`,
      url: 'http://localhost:3002',
    },
  ]);
}

async function clearMiddlewareSessionCookie(page: Page) {
  await page.context().clearCookies();
}

async function mockSession(page: Page, role: TestRole | null) {
  if (role) {
    await setMiddlewareSessionCookie(page, role);
  } else {
    await clearMiddlewareSessionCookie(page);
  }

  await page.route('**/api/auth/get-session**', async (route) => {
    await fulfillJson(route, role ? { user: TEST_USERS[role] } : { user: null });
  });
}

async function mockSignIn(page: Page, role: TestRole) {
  await page.route('**/api/auth/sign-in/email', async (route) => {
    await setMiddlewareSessionCookie(page, role);
    await fulfillJson(route, { user: TEST_USERS[role], session: { id: `session-${role}` } });
  });
}

async function mockBaseAuthenticatedApis(page: Page, role: TestRole) {
  await mockSession(page, role);
  await page.route('**/api/user/enrollments', async (route) => {
    await fulfillJson(route, {
      classrooms: [
        {
          id: 'networking-101',
          name: 'Networking 101',
          instructor: 'Instructor User',
          visibility: 'enrolled',
          createdAt: '2026-05-09T00:00:00.000Z',
          isOwner: role === 'instructor',
        },
      ],
    });
  });
}

test.describe('OpenMAIC auth flows', () => {
  test('admin login redirects to /admin and can reach usage dashboard', async ({ page }) => {
    await mockSignIn(page, 'admin');
    await mockBaseAuthenticatedApis(page, 'admin');
    await page.route('**/api/admin/users', async (route) => fulfillJson(route, { users: [] }));
    await page.route('**/api/admin/usage?**', async (route) => fulfillJson(route, { logs: [], aggregate: [] }));

    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@tstc.edu');
    await page.locator('#password').fill('password123');
    await expect(page.getByLabel('Remember me on this device')).toBeChecked();
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: /admin panel/i })).toBeVisible();
    await page.getByRole('button', { name: /usage dashboard/i }).click();
    await page.waitForURL(/\/admin\/usage/);
  });

  test('instructor login redirects to dashboard and exposes instructor navigation', async ({ page }) => {
    await mockSignIn(page, 'instructor');
    await mockBaseAuthenticatedApis(page, 'instructor');

    await page.goto('/login');
    await page.getByLabel('Email').fill('instructor@tstc.edu');
    await page.locator('#password').fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL(/\/dashboard$/);
    await expect(page.getByRole('button', { name: /admin/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /join a classroom/i })).toBeVisible();
  });

  test('student login redirects to dashboard and exposes student navigation only', async ({ page }) => {
    await mockSignIn(page, 'student');
    await mockBaseAuthenticatedApis(page, 'student');

    await page.goto('/login');
    await page.getByLabel('Email').fill('student@tstc.edu');
    await page.locator('#password').fill('password123');
    await page.getByLabel('Remember me on this device').uncheck();
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL(/\/dashboard$/);
    await expect(page.getByRole('button', { name: /join a classroom/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^admin$/i })).toHaveCount(0);
  });

  test('registration flow shows password strength and verification guidance', async ({ page }) => {
    await page.route('**/api/auth/sign-up/email', async (route) => fulfillJson(route, { user: TEST_USERS.student }));
    await mockSignIn(page, 'student');
    await mockBaseAuthenticatedApis(page, 'student');

    await page.goto('/register');
    await page.getByLabel('Full Name').fill('New Student');
    await page.getByLabel('Email').fill('new.student@tstc.edu');
    await page.getByLabel('Password', { exact: true }).fill('Weakpass1!');
    await expect(page.getByText(/password strength:/i)).toBeVisible();
    await expect(page.getByText(/email verification is enabled/i)).toBeVisible();
    await page.getByLabel('Confirm Password').fill('Weakpass1!');
    await page.getByRole('button', { name: /create account/i }).click();

    await page.waitForURL(/\/dashboard$/);
  });

  test('unauthenticated dashboard redirects to login with callback', async ({ page }) => {
    await mockSession(page, null);
    await page.goto('/dashboard');
    await page.waitForURL(/\/login\?callbackUrl=%2Fdashboard/);
  });

  test('student cannot access admin or provider settings', async ({ page }) => {
    await mockSession(page, 'student');
    await page.route('**/api/admin/users', async (route) => fulfillJson(route, { error: 'Forbidden' }, 403));

    await page.goto('/admin');
    await page.waitForURL(/\/login/);

    await page.goto('/settings');
    await page.waitForURL(/\/$/);
  });
});
