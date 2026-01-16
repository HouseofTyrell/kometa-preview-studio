import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object for the Results page
 *
 * Handles interactions with the before/after comparison view
 */
export class ResultsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly comparisonSlider: Locator;
  readonly beforeImage: Locator;
  readonly afterImage: Locator;
  readonly targetTabs: Locator;
  readonly downloadButton: Locator;
  readonly newPreviewButton: Locator;
  readonly warningsList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /results/i });
    this.comparisonSlider = page.locator('[data-testid="comparison-slider"]');
    this.beforeImage = page.locator('[data-testid="before-image"]');
    this.afterImage = page.locator('[data-testid="after-image"]');
    this.targetTabs = page.locator('[data-testid="target-tabs"]');
    this.downloadButton = page.getByRole('button', { name: /download/i });
    this.newPreviewButton = page.getByRole('button', { name: /new preview/i });
    this.warningsList = page.locator('[data-testid="warnings-list"]');
  }

  async goto(jobId: string) {
    await this.page.goto(`/results/${jobId}`);
    await expect(this.heading).toBeVisible();
  }

  async selectTarget(targetName: string) {
    await this.targetTabs.getByText(targetName).click();
  }

  async getTargetNames(): Promise<string[]> {
    return this.targetTabs.locator('button, a').allTextContents();
  }

  async slideComparison(percentage: number) {
    const box = await this.comparisonSlider.boundingBox();
    if (!box) throw new Error('Comparison slider not found');

    const x = box.x + (box.width * percentage / 100);
    const y = box.y + box.height / 2;

    await this.page.mouse.click(x, y);
  }

  async expectBeforeImageVisible() {
    await expect(this.beforeImage).toBeVisible();
  }

  async expectAfterImageVisible() {
    await expect(this.afterImage).toBeVisible();
  }

  async downloadResult() {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.downloadButton.click(),
    ]);
    return download;
  }

  async startNewPreview() {
    await this.newPreviewButton.click();
    await expect(this.page).toHaveURL(/\/$/);
  }

  async getWarnings(): Promise<string[]> {
    const warnings = await this.warningsList.locator('li').allTextContents();
    return warnings;
  }
}
