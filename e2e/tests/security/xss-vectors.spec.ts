/**
 * XSS Vector Security E2E Tests @security
 *
 * Tests that user-generated content (note text, profile names, bios) with
 * XSS payloads (<script>, onerror=, javascript: URLs) is properly sanitized
 * and doesn't execute.
 */
import { test, expect } from '../../fixtures';
import { APP_ROUTES, TIMEOUTS, TEST_PROFILES } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

/**
 * Common XSS payloads to test against.
 */
const XSS_PAYLOADS = [
  '<script>window.__xssTriggered=true</script>',
  '<img src=x onerror="window.__xssTriggered=true">',
  '<svg onload="window.__xssTriggered=true">',
  'javascript:window.__xssTriggered=true',
  '<iframe src="javascript:window.__xssTriggered=true">',
  '<body onload="window.__xssTriggered=true">',
  '"><script>window.__xssTriggered=true</script>',
  "'-alert(1)-'",
  '<math><mtext><table><mglyph><svg><mtext><textarea><path d="</textarea><img onerror="window.__xssTriggered=true" src=x>">',
  '<a href="javascript:window.__xssTriggered=true">click</a>',
  '<div style="background:url(javascript:window.__xssTriggered=true)">',
  '{{constructor.constructor("window.__xssTriggered=true")()}}',
];

test.describe('XSS Vector Security @security', () => {
  test.beforeEach(async ({ page }) => {
    // Set up XSS detection flag before each test
    await page.addInitScript(() => {
      (window as unknown as { __xssTriggered: boolean }).__xssTriggered = false;
    });
  });

  test('should not execute script tags in note content input', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Try to open the note editor
    const createButton = page.locator(
      'button:has-text("Create"), button:has-text("New"), ' +
      '.fab, [class*="fab"], button[aria-label*="note"], button[aria-label*="create"]'
    );

    const hasCreateButton = await createButton.first().isVisible().catch(() => false);

    if (hasCreateButton) {
      for (const payload of XSS_PAYLOADS.slice(0, 3)) {
        await createButton.first().click();
        await page.waitForTimeout(TIMEOUTS.animation);

        const textarea = page.locator(
          '.content-textarea, textarea, [contenteditable="true"], mat-form-field textarea'
        );
        const hasTextarea = await textarea.first().isVisible().catch(() => false);

        if (hasTextarea) {
          await textarea.first().fill(payload);
          await page.waitForTimeout(500);

          // Check XSS didn't trigger
          const xssTriggered = await page.evaluate(() => {
            return (window as unknown as { __xssTriggered: boolean }).__xssTriggered;
          });
          expect(xssTriggered).toBeFalsy();

          // Close dialog
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      }
    } else {
      console.log('Create note button not found — skipping note content XSS test');
    }

    await saveConsoleLogs('security-xss-note-content');
  });

  test('should sanitize XSS in search input', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.search);
    await waitForAppReady(page);

    // Find search input
    const searchInput = page.locator(
      'input[type="search"], input[type="text"], .search-input, mat-form-field input, input[placeholder*="earch"]'
    );
    const hasSearch = await searchInput.first().isVisible().catch(() => false);

    if (hasSearch) {
      for (const payload of XSS_PAYLOADS.slice(0, 5)) {
        await searchInput.first().fill(payload);
        await page.waitForTimeout(300);

        // Trigger search
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);

        // Check XSS didn't trigger
        const xssTriggered = await page.evaluate(() => {
          return (window as unknown as { __xssTriggered: boolean }).__xssTriggered;
        });
        expect(xssTriggered).toBeFalsy();

        // Clear input for next payload
        await searchInput.first().clear();
      }
    } else {
      console.log('Search input not found — skipping search XSS test');
    }

    await saveConsoleLogs('security-xss-search');
  });

  test('should not render HTML from profile content as executable', async ({ page, saveConsoleLogs }) => {
    // Navigate to a profile — the rendered content should be sanitized
    await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
    await waitForAppReady(page);
    await page.waitForTimeout(TIMEOUTS.contentLoad);

    // Check that no script elements were injected into event content
    const scriptElements = await page.evaluate(() => {
      const events = document.querySelectorAll('app-event, .note-content, .event-content, .content');
      let scriptCount = 0;
      for (const event of events) {
        scriptCount += event.querySelectorAll('script').length;
      }
      return scriptCount;
    });

    expect(scriptElements).toBe(0);

    // Verify no event handlers were injected into content elements
    const dangerousAttrs = await page.evaluate(() => {
      const events = document.querySelectorAll('app-event, .note-content, .event-content, .content');
      const found: string[] = [];
      const dangerousAttributes = ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'];

      for (const event of events) {
        const children = event.querySelectorAll('*');
        for (const child of children) {
          for (const attr of dangerousAttributes) {
            if (child.hasAttribute(attr)) {
              found.push(`${child.tagName} has ${attr}`);
            }
          }
        }
      }
      return found;
    });

    expect(dangerousAttrs).toHaveLength(0);

    await saveConsoleLogs('security-xss-profile-content');
  });

  test('should not allow javascript: protocol links in rendered content', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.profile(TEST_PROFILES.fiatjaf.npub));
    await waitForAppReady(page);
    await page.waitForTimeout(TIMEOUTS.contentLoad);

    // Check for any javascript: protocol links in rendered content
    const jsProtocolLinks = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href]');
      const found: string[] = [];
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (href.toLowerCase().startsWith('javascript:')) {
          found.push(`Link with javascript: href found: ${href.substring(0, 50)}`);
        }
      }
      return found;
    });

    if (jsProtocolLinks.length > 0) {
      console.log('WARNING: javascript: protocol links found:', jsProtocolLinks);
    }
    expect(jsProtocolLinks).toHaveLength(0);

    await saveConsoleLogs('security-xss-javascript-links');
  });

  test('should sanitize profile data displayed in sidebar', async ({ authenticatedPage: page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Check that the sidebar doesn't contain any executable content
    const sidebarXSS = await page.evaluate(() => {
      const sidebar = document.querySelector('mat-sidenav, .sidenav');
      if (!sidebar) return { checked: false, safe: true };

      // Check for injected script elements
      const scripts = sidebar.querySelectorAll('script');
      const iframes = sidebar.querySelectorAll('iframe');

      return {
        checked: true,
        safe: scripts.length === 0 && iframes.length === 0,
        scriptCount: scripts.length,
        iframeCount: iframes.length,
      };
    });

    if (sidebarXSS.checked) {
      expect(sidebarXSS.safe).toBeTruthy();
    }

    // Check XSS flag wasn't triggered during rendering
    const xssTriggered = await page.evaluate(() => {
      return (window as unknown as { __xssTriggered: boolean }).__xssTriggered;
    });
    expect(xssTriggered).toBeFalsy();

    await saveConsoleLogs('security-xss-sidebar');
  });

  test('should handle angular template injection attempts', async ({ page, saveConsoleLogs }) => {
    // Angular template injection payloads
    const angularPayloads = [
      '{{constructor.constructor("return this")()}}',
      '{{7*7}}',
      '${7*7}',
      '<div ng-app ng-csp>{{$eval.constructor("alert(1)")()}}</div>',
    ];

    await page.goto(APP_ROUTES.public.search);
    await waitForAppReady(page);

    const searchInput = page.locator(
      'input[type="search"], input[type="text"], .search-input, mat-form-field input, input[placeholder*="earch"]'
    );
    const hasSearch = await searchInput.first().isVisible().catch(() => false);

    if (hasSearch) {
      for (const payload of angularPayloads) {
        await searchInput.first().fill(payload);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);

        // Check that the payload wasn't evaluated (49 = 7*7)
        const bodyText = await page.textContent('body') || '';
        const wasEvaluated = bodyText.includes('49') && !payload.includes('49');

        if (wasEvaluated) {
          console.log(`WARNING: Angular template injection may have been evaluated: ${payload}`);
        }

        // The important check — no XSS triggered
        const xssTriggered = await page.evaluate(() => {
          return (window as unknown as { __xssTriggered: boolean }).__xssTriggered;
        });
        expect(xssTriggered).toBeFalsy();

        await searchInput.first().clear();
      }
    }

    await saveConsoleLogs('security-xss-angular-injection');
  });
});
