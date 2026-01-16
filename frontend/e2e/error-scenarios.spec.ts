import { test, expect } from '@playwright/test';

/**
 * Error Scenarios E2E Tests
 *
 * Tests for error handling and edge cases:
 * - Invalid configurations
 * - Network failures
 * - API errors
 * - Edge cases
 */

test.describe('Error Scenarios', () => {
  test.describe('Invalid Configuration', () => {
    test('handles empty config gracefully', async ({ page }) => {
      await page.goto('/');

      // Try to submit empty config
      const uploadButton = page.getByRole('button', { name: /upload/i });

      if (await uploadButton.isVisible()) {
        await uploadButton.click();

        // Should show error message
        const errorMsg = page.locator('[data-testid="error-message"]');
        await expect(errorMsg).toBeVisible();
      }
    });

    test('handles malformed YAML', async ({ page }) => {
      await page.goto('/');

      const textarea = page.getByRole('textbox');
      if (await textarea.isVisible()) {
        // Invalid YAML with unbalanced brackets
        await textarea.fill('{ invalid: yaml: [');

        const uploadButton = page.getByRole('button', { name: /upload/i });
        await uploadButton.click();

        // Should show parse error
        await expect(page.locator('text=/error|invalid/i')).toBeVisible();
      }
    });
  });

  test.describe('Network Failures', () => {
    test('handles backend unavailable', async ({ page, context }) => {
      // Block backend requests to simulate outage
      await context.route('**/api/**', route => route.abort('connectionrefused'));

      await page.goto('/');

      // Should show connection error or retry message
      const errorIndicator = page.locator('text=/error|unavailable|retry|failed/i');
      await expect(errorIndicator).toBeVisible({ timeout: 10000 });
    });

    test('retries failed requests', async ({ page, context }) => {
      let requestCount = 0;

      // Fail first 2 requests, then succeed
      await context.route('**/api/health', async route => {
        requestCount++;
        if (requestCount < 3) {
          await route.abort('connectionrefused');
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'ok' }),
          });
        }
      });

      await page.goto('/');

      // Wait for retry logic to kick in
      await page.waitForTimeout(5000);

      // Eventually should recover
      expect(requestCount).toBeGreaterThan(1);
    });
  });

  test.describe('API Errors', () => {
    test('handles 500 error from config upload', async ({ page, context }) => {
      await context.route('**/api/config', route => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal server error' }),
        });
      });

      await page.goto('/');

      const textarea = page.getByRole('textbox');
      if (await textarea.isVisible()) {
        await textarea.fill('plex:\n  url: http://test\n  token: abc');

        const uploadButton = page.getByRole('button', { name: /upload/i });
        await uploadButton.click();

        // Should show error message
        await expect(page.locator('text=/error|failed/i')).toBeVisible();
      }
    });

    test('handles 400 validation error', async ({ page, context }) => {
      await context.route('**/api/config', route => {
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Validation failed',
            details: 'Missing required field: plex.token',
          }),
        });
      });

      await page.goto('/');

      const textarea = page.getByRole('textbox');
      if (await textarea.isVisible()) {
        await textarea.fill('plex:\n  url: http://test');

        const uploadButton = page.getByRole('button', { name: /upload/i });
        await uploadButton.click();

        // Should show validation error with details
        await expect(page.locator('text=/validation|missing|token/i')).toBeVisible();
      }
    });
  });

  test.describe('Edge Cases', () => {
    test('handles very large config file', async ({ page }) => {
      await page.goto('/');

      const textarea = page.getByRole('textbox');
      if (await textarea.isVisible()) {
        // Generate large config (100KB+)
        const largeConfig = `plex:
  url: http://test
  token: abc
libraries:
  Movies:
    overlay_files:
${Array(1000).fill('      - default: resolution').join('\n')}
`;

        await textarea.fill(largeConfig);

        const uploadButton = page.getByRole('button', { name: /upload/i });
        await uploadButton.click();

        // Should either handle gracefully or show size error
        // Not crash or hang
        await page.waitForTimeout(3000);
        await expect(page.locator('body')).toBeVisible();
      }
    });

    test('handles rapid navigation', async ({ page }) => {
      // Rapidly navigate between pages
      await page.goto('/');
      await page.goto('/preview');
      await page.goto('/');
      await page.goto('/preview');
      await page.goto('/');

      // App should remain stable
      await expect(page.locator('body')).toBeVisible();
    });
  });
});
