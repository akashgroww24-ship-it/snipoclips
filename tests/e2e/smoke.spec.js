const { test, expect } = require('@playwright/test');

const baseURL = process.env.BASE_URL || 'https://snipoclips.onrender.com';

test('health endpoint is healthy', async ({ request }) => {
  const res = await request.get(baseURL + '/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
});

test('public homepage loads', async ({ page }) => {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/snipo/i);
  await expect(page.locator('body')).toBeVisible();
});

test('login page loads', async ({ page }) => {
  await page.goto(baseURL + '/login', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  expect(page.url()).toContain('/login');
});

test('studio route is reachable', async ({ page }) => {
  const res = await page.goto(baseURL + '/app', { waitUntil: 'domcontentloaded' });
  expect(res).not.toBeNull();
  expect(res.status()).toBeLessThan(500);
  await expect(page.locator('body')).toBeVisible();
});

test('no obvious JavaScript crash on key public pages', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  for (const path of ['/', '/login', '/app']) {
    await page.goto(baseURL + path, { waitUntil: 'networkidle' });
  }
  expect(errors).toEqual([]);
});
