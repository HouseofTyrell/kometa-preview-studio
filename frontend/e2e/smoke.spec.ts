import { test, expect } from '@playwright/test';

/**
 * Smoke Tests
 *
 * Basic tests to verify the application loads and critical paths work
 */

test.describe('Smoke Tests', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Kometa Preview Studio/i);
  });

  test('navigation works', async ({ page }) => {
    await page.goto('/');

    // Check main navigation elements exist
    const nav = page.getByRole('navigation');
    await expect(nav).toBeVisible();
  });

  test('health check endpoint responds', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/health');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  test('preview targets endpoint responds', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/preview/targets');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.targets).toBeDefined();
    expect(Array.isArray(data.targets)).toBeTruthy();
  });
});
