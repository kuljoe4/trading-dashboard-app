import { test, expect } from '@playwright/test';

/**
 * Automated UI/UX Evidence Collection Script
 *
 * This script is used by senior practitioners to capture the state of the
 * Momentum Engine cockpit across different resolutions and views.
 *
 * To run: npx playwright test src/tests/ux_audit.spec.js
 */

test.describe('Momentum Engine UI/UX Audit', () => {
  test.setTimeout(120000);

  test('capture cockpit baseline', async ({ page }) => {
    // Navigate to the cockpit
    await page.goto('http://localhost:5173', { waitUntil: 'load' });

    // Allow for hydration and WS connection attempt
    await page.waitForTimeout(5000);

    // Desktop Screenshot
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: 'ux_audit_desktop.png' });

    // Mobile Screenshot
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'ux_audit_mobile.png' });

    // Try to inspect the Scanner (if button is available)
    const scannerBtn = page.locator('button[aria-label*="Scanner"]').first();
    if (await scannerBtn.isVisible()) {
      await scannerBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'ux_audit_scanner.png' });
      await page.keyboard.press('Escape');
    }
  });
});
