import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object for the Config Upload page
 *
 * Handles interactions with the YAML configuration upload UI
 */
export class ConfigPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly fileInput: Locator;
  readonly yamlTextarea: Locator;
  readonly uploadButton: Locator;
  readonly continueButton: Locator;
  readonly errorMessage: Locator;
  readonly warningsList: Locator;
  readonly libraryList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: /config/i });
    this.fileInput = page.locator('input[type="file"]');
    this.yamlTextarea = page.getByRole('textbox', { name: /yaml/i });
    this.uploadButton = page.getByRole('button', { name: /upload/i });
    this.continueButton = page.getByRole('button', { name: /continue/i });
    this.errorMessage = page.locator('[data-testid="error-message"]');
    this.warningsList = page.locator('[data-testid="warnings-list"]');
    this.libraryList = page.locator('[data-testid="library-list"]');
  }

  async goto() {
    await this.page.goto('/');
    await expect(this.heading).toBeVisible();
  }

  async uploadConfigFile(filePath: string) {
    await this.fileInput.setInputFiles(filePath);
  }

  async enterYamlText(yaml: string) {
    await this.yamlTextarea.fill(yaml);
    await this.uploadButton.click();
  }

  async getWarnings(): Promise<string[]> {
    const warnings = await this.warningsList.locator('li').allTextContents();
    return warnings;
  }

  async getLibraries(): Promise<string[]> {
    const libraries = await this.libraryList.locator('li').allTextContents();
    return libraries;
  }

  async continueToPreview() {
    await this.continueButton.click();
    await expect(this.page).toHaveURL(/preview/);
  }

  async expectError(text: string | RegExp) {
    await expect(this.errorMessage).toContainText(text);
  }
}
