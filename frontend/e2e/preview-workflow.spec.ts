import { test, expect } from '@playwright/test';
import { ConfigPage, PreviewPage } from './pages';

/**
 * Preview Workflow E2E Tests
 *
 * Tests for the complete preview generation workflow:
 * 1. Upload/paste config
 * 2. Select preview targets
 * 3. Run preview job
 * 4. View results
 */

test.describe('Preview Workflow', () => {
  test.describe('Config Upload', () => {
    test('can paste YAML configuration', async ({ page }) => {
      const configPage = new ConfigPage(page);
      await configPage.goto();

      // Sample minimal config
      const yaml = `
plex:
  url: http://localhost:32400
  token: test-token
libraries:
  Movies:
    overlay_files:
      - default: resolution
`;

      await configPage.enterYamlText(yaml);

      // Should show config analysis results (libraries, overlays, etc.)
      // Specific assertions depend on UI implementation
    });

    test('shows error for invalid YAML', async ({ page }) => {
      const configPage = new ConfigPage(page);
      await configPage.goto();

      // Invalid YAML (bad indentation)
      const invalidYaml = `
plex:
url: http://localhost:32400  # Missing indentation
`;

      await configPage.enterYamlText(invalidYaml);
      await configPage.expectError(/invalid|error|parse/i);
    });

    test('shows warning for missing Plex connection', async ({ page }) => {
      const configPage = new ConfigPage(page);
      await configPage.goto();

      // Config without Plex credentials
      const yaml = `
libraries:
  Movies:
    overlay_files:
      - default: resolution
`;

      await configPage.enterYamlText(yaml);
      const warnings = await configPage.getWarnings();

      // Should warn about missing Plex URL or token
      expect(warnings.some(w => /plex|url|token/i.test(w))).toBeTruthy();
    });
  });

  test.describe('Target Selection', () => {
    test('loads available preview targets', async ({ page }) => {
      const previewPage = new PreviewPage(page);
      await previewPage.goto();

      const targets = await previewPage.getAvailableTargets();
      expect(targets.length).toBeGreaterThan(0);

      // Should have movie and TV show targets
      expect(targets.some(t => /matrix|dune/i.test(t))).toBeTruthy();
      expect(targets.some(t => /breaking bad/i.test(t))).toBeTruthy();
    });

    test('can select different target types', async ({ page }) => {
      const previewPage = new PreviewPage(page);
      await previewPage.goto();

      // Select a movie target
      await previewPage.selectTarget('matrix');
      await expect(previewPage.targetSelector).toHaveValue('matrix');

      // Select a TV show target
      await previewPage.selectTarget('breakingbad_series');
      await expect(previewPage.targetSelector).toHaveValue('breakingbad_series');
    });
  });

  test.describe('Job Execution', () => {
    test.skip('can start and monitor preview job', async ({ page }) => {
      // This test requires a running Plex server with the test content
      // Skip by default, enable for integration testing
      const previewPage = new PreviewPage(page);
      await previewPage.goto();

      await previewPage.selectTarget('matrix');
      await previewPage.startPreview();

      // Should show running status
      await previewPage.waitForStatus('running');

      // Progress should increase
      await previewPage.waitForProgress(10);

      // Eventually completes
      await previewPage.waitForCompletion();
    });

    test('can cancel running preview', async ({ page }) => {
      const previewPage = new PreviewPage(page);
      await previewPage.goto();

      await previewPage.selectTarget('matrix');
      await previewPage.startPreview();

      // Wait for job to start
      await previewPage.waitForStatus('running', 10000);

      // Cancel the job
      await previewPage.cancelPreview();

      // Should show cancelled status
      await previewPage.waitForStatus('cancelled', 10000);
    });
  });
});
