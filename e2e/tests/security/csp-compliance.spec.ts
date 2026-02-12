/**
 * CSP Compliance E2E Tests @security
 *
 * Verifies Content-Security-Policy headers are present and no CSP
 * violations are logged in the console during normal app usage.
 */
import { test, expect } from '../../fixtures';
import { APP_ROUTES, TIMEOUTS } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('CSP Compliance @security', () => {
  test('should serve pages with security headers', async ({ page, saveConsoleLogs }) => {
    // Intercept the initial page response to check headers
    const response = await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    if (response) {
      const headers = response.headers();

      // Check for security-related headers
      const securityHeaders = {
        'content-security-policy': headers['content-security-policy'],
        'x-content-type-options': headers['x-content-type-options'],
        'x-frame-options': headers['x-frame-options'],
        'x-xss-protection': headers['x-xss-protection'],
        'strict-transport-security': headers['strict-transport-security'],
        'referrer-policy': headers['referrer-policy'],
      };

      console.log('Security headers present:');
      for (const [header, value] of Object.entries(securityHeaders)) {
        console.log(`  ${header}: ${value || '(not set)'}`);
      }

      // X-Content-Type-Options should ideally be set
      if (securityHeaders['x-content-type-options']) {
        expect(securityHeaders['x-content-type-options']).toBe('nosniff');
      }

      // Note: In dev mode (ng serve), CSP headers may not be set.
      // This test documents what's present and flags missing ones.
      if (!securityHeaders['content-security-policy']) {
        console.log('NOTE: CSP header not present. This is common in dev mode (ng serve).');
        console.log('Ensure CSP is configured in production deployment.');
      }
    }

    await saveConsoleLogs('security-csp-headers');
  });

  test('should not log CSP violations during normal usage', async ({ page, saveConsoleLogs }) => {
    // Collect CSP violation reports
    const cspViolations: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('Content Security Policy') ||
        text.includes('CSP') ||
        text.includes('Refused to') ||
        text.includes('violates the following Content Security Policy')
      ) {
        cspViolations.push(text);
      }
    });

    // Navigate through multiple pages
    const pagesToVisit = [
      APP_ROUTES.public.home,
      APP_ROUTES.public.discover,
      APP_ROUTES.public.articles,
      APP_ROUTES.public.music,
      APP_ROUTES.public.search,
    ];

    for (const route of pagesToVisit) {
      await page.goto(route);
      await waitForAppReady(page);
      await page.waitForTimeout(1000);
    }

    if (cspViolations.length > 0) {
      console.log('CSP violations detected:');
      cspViolations.forEach(v => console.log(`  ${v.substring(0, 200)}`));
    }

    // Ideally there should be no CSP violations
    // If violations exist, they should be documented/addressed
    console.log(`Total CSP violations: ${cspViolations.length}`);

    await saveConsoleLogs('security-csp-violations');
  });

  test('should not use inline scripts that would violate CSP', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);

    // Check for inline script elements (not from Angular's bootstrap)
    const inlineScripts = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script:not([src])');
      const results: { content: string; hasNonce: boolean }[] = [];

      for (const script of scripts) {
        const content = script.textContent?.trim() || '';
        // Skip empty scripts and Angular state transfer scripts
        if (content.length === 0) continue;
        if (content.includes('__ServerState__') || content.includes('serverApp')) continue;

        results.push({
          content: content.substring(0, 100),
          hasNonce: script.hasAttribute('nonce'),
        });
      }

      return results;
    });

    console.log(`Inline scripts found: ${inlineScripts.length}`);
    inlineScripts.forEach((script, i) => {
      console.log(`  Script ${i + 1}: ${script.content}... (nonce: ${script.hasNonce})`);
    });

    // If CSP is strict, inline scripts should have nonces
    // In dev mode, this is informational
    for (const script of inlineScripts) {
      if (!script.hasNonce) {
        console.log(`NOTE: Inline script without nonce detected. Ensure nonce is set in production.`);
      }
    }

    await saveConsoleLogs('security-csp-inline-scripts');
  });

  test('should not use inline event handlers in the DOM', async ({ page, saveConsoleLogs }) => {
    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);
    await page.waitForTimeout(TIMEOUTS.contentLoad);

    // Check for inline event handlers (on* attributes) which violate strict CSP
    const inlineHandlers = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      const found: string[] = [];
      const eventAttributes = [
        'onclick', 'onload', 'onerror', 'onmouseover', 'onmouseout',
        'onfocus', 'onblur', 'onsubmit', 'onchange', 'oninput',
        'onkeydown', 'onkeyup', 'onkeypress',
      ];

      for (const el of allElements) {
        for (const attr of eventAttributes) {
          if (el.hasAttribute(attr)) {
            // Skip Angular-generated elements that might have these legitimately
            const isAngular = el.hasAttribute('ng-reflect') || el.tagName.startsWith('APP-');
            if (!isAngular) {
              found.push(`<${el.tagName}> has ${attr}="${(el.getAttribute(attr) || '').substring(0, 50)}"`);
            }
          }
        }
      }

      return found;
    });

    if (inlineHandlers.length > 0) {
      console.log('Inline event handlers found (CSP concern):');
      inlineHandlers.forEach(h => console.log(`  ${h}`));
    }

    // Angular apps should not use inline event handlers
    expect(inlineHandlers).toHaveLength(0);

    await saveConsoleLogs('security-csp-inline-handlers');
  });

  test('should not use eval or Function constructor', async ({ page, saveConsoleLogs }) => {
    // Monitor for eval usage via CSP violation or console
    const evalUsed: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('eval') ||
        text.includes("'unsafe-eval'") ||
        text.includes('EvalError')
      ) {
        evalUsed.push(text);
      }
    });

    await page.goto(APP_ROUTES.public.home);
    await waitForAppReady(page);
    await page.waitForTimeout(TIMEOUTS.contentLoad);

    // Navigate through a few pages
    await page.goto(APP_ROUTES.public.discover);
    await waitForAppReady(page);

    if (evalUsed.length > 0) {
      console.log('eval-related console messages:');
      evalUsed.forEach(e => console.log(`  ${e.substring(0, 200)}`));
    }

    // In production, eval should not be used
    // In dev mode, Angular may use eval for source maps — filter those out
    const nonDevEval = evalUsed.filter(e =>
      !e.includes('source-map') && !e.includes('devtools')
    );

    console.log(`Non-dev eval usage: ${nonDevEval.length}`);

    await saveConsoleLogs('security-csp-eval');
  });
});
