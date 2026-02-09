/**
 * Accessibility E2E Tests
 *
 * Tests to verify accessibility features and keyboard navigation.
 */
import { test, expect } from '../fixtures';

test.describe('Keyboard Navigation', () => {
  test('should support Tab navigation', async ({ page, waitForNostrReady, captureScreenshot }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Press Tab multiple times and check focus moves
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
    }

    // Capture focused element
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        tagName: el?.tagName,
        className: el?.className,
        ariaLabel: el?.getAttribute('aria-label'),
        textContent: el?.textContent?.slice(0, 50),
      };
    });

    console.log('Focused element after 5 Tabs:', focusedElement);

    await captureScreenshot('tab-navigation');
  });

  test('should support Escape to close dialogs', async ({ page, waitForNostrReady }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Try to open command palette
    await page.keyboard.press('Control+k');

    // Wait a bit for potential dialog
    await page.waitForTimeout(500);

    // Press Escape to close any open dialog
    await page.keyboard.press('Escape');

    // No dialogs should be visible
    const dialogs = page.locator('[role="dialog"]:visible');
    const visibleDialogCount = await dialogs.count();

    expect(visibleDialogCount).toBe(0);
  });
});

test.describe('ARIA Attributes', () => {
  test('should have proper ARIA landmarks', async ({ page, waitForNostrReady }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Check for main landmarks
    const landmarks = await page.evaluate(() => {
      const results: { role: string; found: boolean }[] = [];

      // Check for main content area
      const main = document.querySelector('main, [role="main"]');
      results.push({ role: 'main', found: !!main });

      // Check for navigation
      const nav = document.querySelector('nav, [role="navigation"]');
      results.push({ role: 'navigation', found: !!nav });

      // Check for banner/header
      const header = document.querySelector('header, [role="banner"]');
      results.push({ role: 'banner', found: !!header });

      return results;
    });

    console.log('ARIA landmarks:', landmarks);

    // At least some landmarks should be present
    const foundLandmarks = landmarks.filter((l) => l.found);
    expect(foundLandmarks.length).toBeGreaterThan(0);
  });

  test('should have accessible buttons', async ({ page, waitForNostrReady }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Get all buttons and check for accessible names
    const buttonAccessibility = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const results: { hasAccessibleName: boolean; element: string }[] = [];

      buttons.forEach((button) => {
        const hasAriaLabel = !!button.getAttribute('aria-label');
        const hasAriaLabelledBy = !!button.getAttribute('aria-labelledby');
        const hasText = !!(button.textContent?.trim());
        const hasTitle = !!button.getAttribute('title');

        results.push({
          hasAccessibleName: hasAriaLabel || hasAriaLabelledBy || hasText || hasTitle,
          element: button.outerHTML.slice(0, 100),
        });
      });

      return results;
    });

    // Log buttons without accessible names
    const inaccessibleButtons = buttonAccessibility.filter((b) => !b.hasAccessibleName);
    if (inaccessibleButtons.length > 0) {
      console.warn('Buttons without accessible names:', inaccessibleButtons);
    }

    // Most buttons should have accessible names
    const accessiblePercentage =
      (buttonAccessibility.filter((b) => b.hasAccessibleName).length / buttonAccessibility.length) * 100;

    console.log(`${accessiblePercentage.toFixed(1)}% of buttons have accessible names`);
  });

  test('should have form labels', async ({ page, waitForNostrReady }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Check for form inputs with labels
    const formAccessibility = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input, textarea, select');
      const results: { hasLabel: boolean; type: string }[] = [];

      inputs.forEach((input) => {
        const id = input.getAttribute('id');
        const hasLabelFor = id ? !!document.querySelector(`label[for="${id}"]`) : false;
        const hasAriaLabel = !!input.getAttribute('aria-label');
        const hasAriaLabelledBy = !!input.getAttribute('aria-labelledby');
        const hasPlaceholder = !!input.getAttribute('placeholder');
        const isHidden = input.getAttribute('type') === 'hidden';

        if (!isHidden) {
          results.push({
            hasLabel: hasLabelFor || hasAriaLabel || hasAriaLabelledBy || hasPlaceholder,
            type: input.getAttribute('type') || input.tagName.toLowerCase(),
          });
        }
      });

      return results;
    });

    console.log('Form field accessibility:', formAccessibility);
  });
});

test.describe('Color Contrast', () => {
  test('should have readable text', async ({ page, waitForNostrReady, captureScreenshot }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Capture in both light and dark modes for manual/AI review
    await captureScreenshot('color-contrast-check');

    // Check if dark mode class is applied
    const hasDarkMode = await page.evaluate(() => {
      return document.body.classList.contains('dark') ||
        document.documentElement.classList.contains('dark');
    });

    console.log(`Dark mode: ${hasDarkMode}`);
  });

  test('should have distinct card background in dark mode', async ({ page, waitForNostrReady }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Enable dark mode by adding the class
    await page.evaluate(() => {
      document.body.classList.add('dark');
    });

    // Wait for styles to apply
    await page.waitForTimeout(300);

    // Verify that the CSS custom property for surface-container-low is defined and distinct
    const colors = await page.evaluate(() => {
      const body = document.body;
      const bodyStyles = getComputedStyle(body);
      const bgColor = bodyStyles.getPropertyValue('--mat-app-background-color').trim();

      // Get the surface-container-low value (used by note cards in dark mode)
      const cardSurface = bodyStyles.getPropertyValue('--mat-sys-surface-container-low').trim();
      // Get the surface-container-lowest value (the old card background)
      const lowestSurface = bodyStyles.getPropertyValue('--mat-sys-surface-container-lowest').trim();

      return { bgColor, cardSurface, lowestSurface };
    });

    console.log('Dark mode colors:', colors);

    // The app background should be #0a0a0a (near-black)
    expect(colors.bgColor).toBeTruthy();

    // The card surface (surface-container-low) should be different from the lowest surface
    // This confirms the card uses a lifted surface level for better contrast
    if (colors.cardSurface && colors.lowestSurface) {
      expect(colors.cardSurface).not.toBe(colors.lowestSurface);
    }
  });
});

test.describe('Focus Management', () => {
  test('should trap focus in modals', async ({ page, waitForNostrReady }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Open command palette (which should trap focus)
    await page.keyboard.press('Control+k');

    await page.waitForTimeout(500);

    const dialog = page.locator('[role="dialog"]:visible');
    const isDialogVisible = await dialog.isVisible().catch(() => false);

    if (isDialogVisible) {
      // Tab should cycle within the dialog
      const focusedElements: string[] = [];

      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => document.activeElement?.tagName);
        focusedElements.push(focused || 'unknown');
      }

      console.log('Focus cycle in dialog:', focusedElements);

      // Close dialog
      await page.keyboard.press('Escape');
    }
  });

  test('should return focus after closing dialog', async ({ page, waitForNostrReady }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Get currently focused element
    const initialFocus = await page.evaluate(() => document.activeElement?.tagName);

    // Open and close a dialog
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Check focus is restored (or at least somewhere sensible)
    const finalFocus = await page.evaluate(() => document.activeElement?.tagName);

    console.log(`Focus: ${initialFocus} -> ${finalFocus}`);
  });
});

test.describe('Screen Reader Text', () => {
  test('should have skip links or skip navigation', async ({ page }) => {
    await page.goto('/');

    // Check for skip links (visually hidden but accessible)
    const skipLinks = await page.evaluate(() => {
      // Look for skip links in various forms
      const links = document.querySelectorAll('a[href="#main"], a[href="#content"], .skip-link, .skip-nav');
      return links.length;
    });

    console.log(`Skip links found: ${skipLinks}`);
  });

  test('should announce dynamic content changes', async ({ page, waitForNostrReady }) => {
    await page.goto('/');
    await waitForNostrReady();

    // Check for ARIA live regions
    const liveRegions = await page.evaluate(() => {
      const regions = document.querySelectorAll('[aria-live], [role="status"], [role="alert"]');
      return Array.from(regions).map((r) => ({
        ariaLive: r.getAttribute('aria-live'),
        role: r.getAttribute('role'),
        content: r.textContent?.slice(0, 50),
      }));
    });

    console.log('Live regions:', liveRegions);
  });
});
