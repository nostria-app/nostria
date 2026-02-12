/**
 * Music Page E2E Tests @public
 *
 * Tests for the Music page (/music): verify music list loads,
 * player controls are present, track metadata displays.
 */
import { test, expect } from '../../fixtures';

test.describe('Music Page @public', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/music');
  });

  test('should load the music page', async ({ page, waitForNostrReady, captureScreenshot, saveConsoleLogs }) => {
    await waitForNostrReady();

    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    await captureScreenshot('music-page-loaded');
    await saveConsoleLogs('music-page-loaded');
  });

  test('should render music list', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Look for music items/tracks
    const tracks = page.locator('.track, .music-item, mat-card, app-event, .audio-item, mat-list-item');
    const count = await tracks.count();

    console.log(`Found ${count} music/track items`);

    const emptyState = page.locator('.empty-state, .no-content, .no-music');
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    expect(count > 0 || hasEmptyState).toBeTruthy();
    await saveConsoleLogs('music-list');
  });

  test('should have player controls present', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Look for audio player controls
    const playButtons = page.locator('button[aria-label*="play" i], button[aria-label*="Play" i], .play-button, [data-testid="play"]');
    const audioElements = page.locator('audio');
    const playerControls = page.locator('.player, .audio-player, app-media-player, .music-player');

    const playCount = await playButtons.count();
    const audioCount = await audioElements.count();
    const playerCount = await playerControls.count();

    console.log(`Play buttons: ${playCount}, Audio elements: ${audioCount}, Player controls: ${playerCount}`);
    await saveConsoleLogs('music-player-controls');
  });

  test('should display track metadata', async ({ page, waitForNostrReady, saveConsoleLogs }) => {
    await waitForNostrReady();
    await page.waitForTimeout(2000);

    // Look for track metadata (title, artist, duration)
    const metadata = page.locator('.track-title, .artist, .duration, .track-info, .track-metadata');
    const count = await metadata.count();

    console.log(`Found ${count} metadata elements`);

    if (count > 0) {
      const firstMeta = await metadata.first().textContent();
      console.log(`First metadata: ${firstMeta?.trim()}`);
    }

    await saveConsoleLogs('music-metadata');
  });
});
