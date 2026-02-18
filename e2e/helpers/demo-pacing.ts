import { Page } from '@playwright/test';

const DEFAULT_STEP_DELAY_MS = 800;
const DEFAULT_TRANSITION_DELAY_MS = 1200;

export async function humanPause(page: Page, delayMs = DEFAULT_STEP_DELAY_MS): Promise<void> {
  await page.waitForTimeout(delayMs);
}

export async function settleTransition(
  page: Page,
  delayMs = DEFAULT_TRANSITION_DELAY_MS,
  networkIdleTimeoutMs = 10000
): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: networkIdleTimeoutMs });
  } catch {
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => undefined);
  }
  await page.waitForTimeout(delayMs);
}

export async function smoothScroll(page: Page, ratio = 0.6): Promise<void> {
  await page.evaluate((scrollRatio) => {
    const target = Math.max(200, Math.floor(window.innerHeight * scrollRatio));
    window.scrollBy({ top: target, behavior: 'smooth' });
  }, ratio);

  await humanPause(page, 1000);
}

export async function clickFirstVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    if (await target.isVisible().catch(() => false)) {
      await target.click();
      await humanPause(page, 900);
      return true;
    }
  }

  return false;
}
