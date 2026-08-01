# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: src/tests/ux_audit.spec.js >> Momentum Engine UI/UX Audit >> capture cockpit baseline
- Location: src/tests/ux_audit.spec.js:15:3

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: page.setViewportSize: Test timeout of 120000ms exceeded.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  |
  3  | /**
  4  |  * Automated UI/UX Evidence Collection Script
  5  |  *
  6  |  * This script is used by senior practitioners to capture the state of the
  7  |  * Momentum Engine cockpit across different resolutions and views.
  8  |  *
  9  |  * To run: npx playwright test src/tests/ux_audit.spec.js
  10 |  */
  11 |
  12 | test.describe('Momentum Engine UI/UX Audit', () => {
  13 |   test.setTimeout(120000);
  14 |
  15 |   test('capture cockpit baseline', async ({ page }) => {
  16 |     // Navigate to the cockpit
  17 |     await page.goto('http://localhost:5173', { waitUntil: 'load' });
  18 |
  19 |     // Allow for hydration and WS connection attempt
  20 |     await page.waitForTimeout(5000);
  21 |
  22 |     // Desktop Screenshot
> 23 |     await page.setViewportSize({ width: 1440, height: 900 });
     |                ^ Error: page.setViewportSize: Test timeout of 120000ms exceeded.
  24 |     await page.screenshot({ path: 'ux_audit_desktop.png' });
  25 |
  26 |     // Mobile Screenshot
  27 |     await page.setViewportSize({ width: 375, height: 812 });
  28 |     await page.screenshot({ path: 'ux_audit_mobile.png' });
  29 |
  30 |     // Try to inspect the Scanner (if button is available)
  31 |     const scannerBtn = page.locator('button[aria-label*="Scanner"]').first();
  32 |     if (await scannerBtn.isVisible()) {
  33 |       await scannerBtn.click();
  34 |       await page.waitForTimeout(1000);
  35 |       await page.screenshot({ path: 'ux_audit_scanner.png' });
  36 |       await page.keyboard.press('Escape');
  37 |     }
  38 |   });
  39 | });
  40 |
```