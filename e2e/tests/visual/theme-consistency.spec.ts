/**
 * Theme Consistency Visual Regression Tests @visual
 *
 * Captures screenshots of key pages in both light and dark mode,
 * compares against baseline screenshots, and fails if pixel diff
 * exceeds the configured threshold (1%).
 *
 * Dark mode is toggled via localStorage key 'nostria-theme' and
 * the 'dark' class on <html>.
 */
import { test, expect } from '../../fixtures';

const THEME_KEY = 'nostria-theme';

/** Pages to capture for theme consistency comparison */
const keyPages = [
  { name: 'home', path: '/' },
  { name: 'discover', path: '/discover' },
  { name: 'articles', path: '/articles' },
  { name: 'music', path: '/music' },
  { name: 'search', path: '/search' },
];

/**
 * Set the theme before the page loads by injecting localStorage.
 */
async function setTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.addInitScript(({ key, value }: { key: string; value: string }) => {
    localStorage.setItem(key, value);
  }, { key: THEME_KEY, value: theme });
}

/**
 * Wait for the app to render and stabilize before taking screenshots.
 */
async function waitForStableRender(page: import('@playwright/test').Page) {
  // Wait for Angular app to bootstrap
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    const mainContent = document.querySelector('mat-sidenav-content, .main-content, main');
    return !!mainContent;
  }, { timeout: 30_000 });

  // Wait for animations and async rendering to settle
  await page.waitForTimeout(1000);

  // Wait for network to settle
  await page.waitForLoadState('networkidle').catch(() => {
    // networkidle may not always fire; continue after timeout
  });
}

test.describe('Theme Consistency @visual', () => {
  test.describe('Light mode screenshots', () => {
    for (const pageInfo of keyPages) {
      test(`should match baseline for ${pageInfo.name} in light mode`, async ({ page, saveConsoleLogs }) => {
        await setTheme(page, 'light');
        await page.goto(pageInfo.path);
        await waitForStableRender(page);

        // Verify light mode is active (no 'dark' class on <html>)
        const isDark = await page.evaluate(() =>
          document.documentElement.classList.contains('dark')
        );
        expect(isDark).toBeFalsy();

        // Take visual regression screenshot
        await expect(page).toHaveScreenshot(`${pageInfo.name}-light.png`, {
          fullPage: true,
          // Mask dynamic content that changes between runs
          mask: [
            // Mask any timestamps or relative times
            page.locator('time, .timestamp, .relative-time'),
            // Mask avatars (loaded from network)
            page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
          ],
        });

        await saveConsoleLogs(`visual-theme-light-${pageInfo.name}`);
      });
    }
  });

  test.describe('Dark mode screenshots', () => {
    for (const pageInfo of keyPages) {
      test(`should match baseline for ${pageInfo.name} in dark mode`, async ({ page, saveConsoleLogs }) => {
        await setTheme(page, 'dark');
        await page.goto(pageInfo.path);
        await waitForStableRender(page);

        // Verify dark mode is active ('dark' class on <html>)
        const isDark = await page.evaluate(() =>
          document.documentElement.classList.contains('dark')
        );
        expect(isDark).toBeTruthy();

        // Take visual regression screenshot
        await expect(page).toHaveScreenshot(`${pageInfo.name}-dark.png`, {
          fullPage: true,
          mask: [
            page.locator('time, .timestamp, .relative-time'),
            page.locator('img[src*="nostr"], img[src*="avatar"], .avatar img'),
          ],
        });

        await saveConsoleLogs(`visual-theme-dark-${pageInfo.name}`);
      });
    }
  });

  test.describe('Theme contrast validation', () => {
    test('should have distinct background colors between light and dark mode', async ({ page, saveConsoleLogs }) => {
      // Test light mode background
      await setTheme(page, 'light');
      await page.goto('/');
      await waitForStableRender(page);

      const lightBg = await page.evaluate(() => {
        const el = document.querySelector('mat-sidenav-content') || document.querySelector('.main-content') || document.body;
        return getComputedStyle(el).backgroundColor;
      });

      // Test dark mode background
      await setTheme(page, 'dark');
      await page.goto('/');
      await waitForStableRender(page);

      const darkBg = await page.evaluate(() => {
        const el = document.querySelector('mat-sidenav-content') || document.querySelector('.main-content') || document.body;
        return getComputedStyle(el).backgroundColor;
      });

      // Light and dark backgrounds must be different
      expect(lightBg).not.toEqual(darkBg);
      console.log(`Light background: ${lightBg}`);
      console.log(`Dark background: ${darkBg}`);

      await saveConsoleLogs('visual-theme-contrast');
    });

    test('should have proper text contrast in dark mode', async ({ page, saveConsoleLogs }) => {
      await setTheme(page, 'dark');
      await page.goto('/');
      await waitForStableRender(page);

      // Verify text color is light on dark background
      const textColor = await page.evaluate(() => {
        const el = document.querySelector('mat-sidenav-content') || document.querySelector('.main-content') || document.body;
        const style = getComputedStyle(el);
        return {
          color: style.color,
          backgroundColor: style.backgroundColor,
        };
      });

      // Parse RGB values to check contrast
      const parseRgb = (rgb: string) => {
        const match = rgb.match(/\d+/g);
        return match ? match.map(Number) : [0, 0, 0];
      };

      const textRgb = parseRgb(textColor.color);
      const bgRgb = parseRgb(textColor.backgroundColor);

      // In dark mode, text should be lighter than background
      const textLuminance = (textRgb[0] + textRgb[1] + textRgb[2]) / 3;
      const bgLuminance = (bgRgb[0] + bgRgb[1] + bgRgb[2]) / 3;

      console.log(`Dark mode text luminance: ${textLuminance}, bg luminance: ${bgLuminance}`);
      expect(textLuminance).toBeGreaterThan(bgLuminance);

      await saveConsoleLogs('visual-theme-dark-contrast');
    });

    test('should apply consistent Material 3 surface colors in dark mode', async ({ page, saveConsoleLogs }) => {
      await setTheme(page, 'dark');
      await page.goto('/');
      await waitForStableRender(page);

      // Check that CSS custom properties are defined for Material 3 surfaces
      const cssVars = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return {
          surface: style.getPropertyValue('--mat-sys-surface').trim(),
          onSurface: style.getPropertyValue('--mat-sys-on-surface').trim(),
          primary: style.getPropertyValue('--mat-sys-primary').trim(),
          surfaceContainer: style.getPropertyValue('--mat-sys-surface-container').trim(),
        };
      });

      // At least the main surface variables should be defined
      console.log('Dark mode CSS variables:', cssVars);
      expect(cssVars.surface).toBeTruthy();
      expect(cssVars.onSurface).toBeTruthy();
      expect(cssVars.primary).toBeTruthy();

      await saveConsoleLogs('visual-theme-material3-vars');
    });
  });
});
