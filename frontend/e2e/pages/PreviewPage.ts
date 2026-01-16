import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object for the Preview page
 *
 * Handles interactions with preview target selection and job execution
 */
export class PreviewPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly targetSelector: Locator;
  readonly overlayCheckboxes: Locator;
  readonly startPreviewButton: Locator;
  readonly cancelButton: Locator;
  readonly progressBar: Locator;
  readonly progressText: Locator;
  readonly statusBadge: Locator;
  readonly logOutput: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /preview/i });
    this.targetSelector = page.locator('[data-testid="target-selector"]');
    this.overlayCheckboxes = page.locator('[data-testid="overlay-checkbox"]');
    this.startPreviewButton = page.getByRole('button', { name: /start preview/i });
    this.cancelButton = page.getByRole('button', { name: /cancel/i });
    this.progressBar = page.locator('[data-testid="progress-bar"]');
    this.progressText = page.locator('[data-testid="progress-text"]');
    this.statusBadge = page.locator('[data-testid="status-badge"]');
    this.logOutput = page.locator('[data-testid="log-output"]');
    this.errorMessage = page.locator('[data-testid="error-message"]');
  }

  async goto() {
    await this.page.goto('/preview');
    await expect(this.heading).toBeVisible();
  }

  async selectTarget(targetId: string) {
    await this.targetSelector.selectOption(targetId);
  }

  async getAvailableTargets(): Promise<string[]> {
    const options = await this.targetSelector.locator('option').allTextContents();
    return options.filter(opt => opt.trim() !== '');
  }

  async enableOverlay(overlayName: string) {
    await this.overlayCheckboxes
      .filter({ hasText: overlayName })
      .locator('input[type="checkbox"]')
      .check();
  }

  async disableOverlay(overlayName: string) {
    await this.overlayCheckboxes
      .filter({ hasText: overlayName })
      .locator('input[type="checkbox"]')
      .uncheck();
  }

  async startPreview() {
    await this.startPreviewButton.click();
  }

  async cancelPreview() {
    await this.cancelButton.click();
  }

  async waitForStatus(status: string, timeout = 30000) {
    await expect(this.statusBadge).toContainText(status, { timeout });
  }

  async waitForProgress(minProgress: number, timeout = 60000) {
    await expect(async () => {
      const text = await this.progressText.textContent();
      const match = text?.match(/(\d+)%/);
      const progress = match ? parseInt(match[1], 10) : 0;
      expect(progress).toBeGreaterThanOrEqual(minProgress);
    }).toPass({ timeout });
  }

  async waitForCompletion(timeout = 120000) {
    await this.waitForStatus('completed', timeout);
  }

  async getLogContent(): Promise<string> {
    return (await this.logOutput.textContent()) || '';
  }

  async expectError(text: string | RegExp) {
    await expect(this.errorMessage).toContainText(text);
  }
}
