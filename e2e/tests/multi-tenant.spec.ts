import { test, expect } from '../fixtures/base';
import type { Page, Route } from '@playwright/test';

type TestRole = 'admin' | 'instructor' | 'student';

const TEST_USERS: Record<TestRole, { id: string; email: string; name: string; role: TestRole }> = {
  admin: { id: 'user-admin', email: 'admin@tstc.edu', name: 'Admin User', role: 'admin' },
  instructor: { id: 'user-instructor', email: 'instructor@tstc.edu', name: 'Instructor User', role: 'instructor' },
  student: { id: 'user-student', email: 'student@tstc.edu', name: 'Student User', role: 'student' },
};

const NETWORKING_CLASSROOM = {
  id: 'networking-101',
  stage: { name: 'Networking 101' },
  ownerId: 'user-instructor',
  ownerName: 'Instructor User',
  visibility: 'enrolled',
  enrolledUserIds: [] as string[],
  createdAt: '2026-05-09T00:00:00.000Z',
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

async function mockSession(page: Page, role: TestRole) {
  await setMiddlewareSessionCookie(page, role);

  await page.route('**/api/auth/get-session**', async (route) => {
    await fulfillJson(route, { user: TEST_USERS[role] });
  });
}

async function mockEnrollmentApis(page: Page, role: TestRole, enrolled = false) {
  await mockSession(page, role);
  await page.route('**/api/classroom/networking-101', async (route) => {
    await fulfillJson(route, {
      ...NETWORKING_CLASSROOM,
      enrolledUserIds: enrolled ? [TEST_USERS.student.id] : [],
    });
  });
  await page.route('**/api/classroom/enroll', async (route) => {
    await fulfillJson(route, { enrolled: !enrolled, classroomId: 'networking-101', userId: TEST_USERS[role].id });
  });
  await page.route('**/api/user/enrollments', async (route) => {
    await fulfillJson(route, {
      classrooms: enrolled
        ? [{
            id: 'networking-101',
            name: 'Networking 101',
            instructor: 'Instructor User',
            visibility: 'enrolled',
            createdAt: NETWORKING_CLASSROOM.createdAt,
            isOwner: role === 'instructor',
          }]
        : [],
    });
  });
}

test.describe('OpenMAIC multi-tenant integration', () => {
  test('admin usage dashboard shows user, model, tokens, and timestamp data', async ({ page }) => {
    await mockSession(page, 'admin');
    await page.route('**/api/admin/usage?**', async (route) => {
      await fulfillJson(route, {
        logs: [
          {
            id: 'usage-1',
            userId: 'student@tstc.edu',
            providerSlug: 'openai',
            model: 'gpt-4o-mini',
            inputTokens: 120,
            outputTokens: 45,
            createdAt: '2026-05-09T16:00:00.000Z',
          },
        ],
        aggregate: [],
      });
    });

    await page.goto('/admin/usage');
    await page.getByRole('button', { name: /raw logs/i }).click();
    await expect(page.getByText(/student@/i)).toBeVisible();
    await expect(page.getByText(/gpt-4o-mini/i)).toBeVisible();
    await expect(page.getByText(/120/)).toBeVisible();
  });

  test('student self-enrollment previews a classroom, enrolls, and redirects to dashboard', async ({ page }) => {
    await mockEnrollmentApis(page, 'student');

    await page.goto('/enroll');
    await page.getByLabel('Classroom Code').fill('networking-101');
    await page.getByRole('button', { name: /find classroom/i }).click();
    await expect(page.getByText('Networking 101')).toBeVisible();
    await page.getByRole('button', { name: /^enroll$/i }).click();

    await expect(page.getByText(/enrollment confirmed/i)).toBeVisible();
    await page.waitForURL(/\/dashboard$/, { timeout: 3000 });
  });

  test('already-enrolled classroom shows a toast instead of an error', async ({ page }) => {
    await mockEnrollmentApis(page, 'student', true);

    await page.goto('/enroll');
    await page.getByLabel('Classroom Code').fill('networking-101');
    await page.getByRole('button', { name: /find classroom/i }).click();

    await expect(page.getByRole('status').filter({ hasText: /already enrolled/i })).toBeVisible();
  });

  test('instructor-owned classroom appears with owner role on dashboard', async ({ page }) => {
    await mockEnrollmentApis(page, 'instructor', true);

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /welcome, instructor user/i })).toBeVisible();
    await expect(page.getByText('Networking 101')).toBeVisible();
    await expect(page.getByText('Owner')).toBeVisible();
    await expect(page.getByText('instructor', { exact: true })).toBeVisible();
  });

  test('dashboard empty state has a prominent CTA to enroll', async ({ page }) => {
    await mockEnrollmentApis(page, 'student', false);

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /no classrooms yet/i })).toBeVisible();
    await page.getByRole('button', { name: /go to enrollment/i }).click();
    await page.waitForURL(/\/enroll$/);
  });

  test('provider management is available to instructors but not students', async ({ page }) => {
    await mockSession(page, 'instructor');
    await page.route('**/api/user/providers', async (route) => fulfillJson(route, { providers: [] }));

    await page.goto('/settings');
    await expect(page.getByText(/add provider/i)).toBeVisible();

    await mockSession(page, 'student');
    await page.goto('/settings');
    await page.waitForURL(/\/$/);
  });

  test('usage entry after an LLM call is visible in admin usage dashboard', async ({ page }) => {
    await mockSession(page, 'admin');
    await page.route('**/api/chat', async (route) => fulfillJson(route, { ok: true }));
    await page.route('**/api/admin/usage?**', async (route) => {
      await fulfillJson(route, {
        logs: [
          {
            id: 'usage-after-chat',
            userId: 'student@tstc.edu',
            providerSlug: 'openai',
            model: 'gpt-4o-mini',
            inputTokens: 20,
            outputTokens: 10,
            createdAt: '2026-05-09T16:10:00.000Z',
          },
        ],
        aggregate: [],
      });
    });

    await page.goto('/admin/usage');
    await page.getByRole('button', { name: /raw logs/i }).click();
    await expect(page.getByText(/student@/i)).toBeVisible();
    await expect(page.getByRole('cell', { name: '20', exact: true })).toBeVisible();
  });
});
