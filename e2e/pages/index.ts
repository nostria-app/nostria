/**
 * Page Object Models for Nostria
 *
 * These classes encapsulate page interactions for cleaner tests
 * and better AI/LLM understanding of available actions.
 */
import { Page, Locator } from '@playwright/test';
import { BasePage } from '../fixtures';

/**
 * Home/Feed Page - Main content feed
 */
export class HomePage extends BasePage {
  // Locators
  readonly feedContainer: Locator;
  readonly noteCards: Locator;
  readonly createNoteButton: Locator;
  readonly loadingIndicator: Locator;
  readonly toolbar: Locator;
  readonly menuButton: Locator;

  constructor(page: Page) {
    super(page);
    this.feedContainer = page.locator('app-feeds, .feed-container, main');
    this.noteCards = page.locator('app-event, app-event-thread, .event-card');
    this.createNoteButton = page.locator('button[aria-label*="Create"], button:has-text("Create"), [data-testid="create-note"]');
    this.loadingIndicator = page.locator('mat-spinner, mat-progress-bar, .loading');
    this.toolbar = page.locator('mat-toolbar, .toolbar, header');
    this.menuButton = page.locator('button[aria-label*="menu"], .menu-button, [data-testid="menu"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.waitForReady();
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
    // Wait for Angular to bootstrap
    await this.page.waitForSelector('app-root', { state: 'visible' });
  }

  async waitForFeedLoaded(): Promise<void> {
    // Wait for loading to complete
    await this.page.waitForFunction(() => {
      const spinners = document.querySelectorAll('mat-spinner, mat-progress-bar');
      return spinners.length === 0 || Array.from(spinners).every((s) => !s.checkVisibility());
    }, { timeout: 30000 });
  }

  async getNoteCount(): Promise<number> {
    return await this.noteCards.count();
  }

  async clickCreateNote(): Promise<void> {
    await this.createNoteButton.click();
  }

  async openMenu(): Promise<void> {
    await this.menuButton.click();
  }

  async scrollToBottom(): Promise<void> {
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  }

  async scrollToLoadMore(): Promise<void> {
    const initialCount = await this.getNoteCount();
    await this.scrollToBottom();

    // Wait for more notes to load
    await this.page.waitForFunction(
      (count) => {
        const notes = document.querySelectorAll('app-event, app-event-thread, .event-card');
        return notes.length > count;
      },
      initialCount,
      { timeout: 10000 }
    ).catch(() => {
      // It's okay if no more notes load
    });
  }
}

/**
 * Profile Page - User profile view
 */
export class ProfilePage extends BasePage {
  readonly profileHeader: Locator;
  readonly displayName: Locator;
  readonly bio: Locator;
  readonly followButton: Locator;
  readonly followersCount: Locator;
  readonly followingCount: Locator;
  readonly profilePicture: Locator;
  readonly notesList: Locator;
  readonly editProfileButton: Locator;

  constructor(page: Page) {
    super(page);
    this.profileHeader = page.locator('app-profile-header, .profile-header, [data-testid="profile-header"]');
    this.displayName = page.locator('.display-name, .profile-name, h1, h2').first();
    this.bio = page.locator('.bio, .about, .profile-bio');
    this.followButton = page.locator('button:has-text("Follow"), [data-testid="follow-button"]');
    this.followersCount = page.locator('.followers-count, [data-testid="followers"]');
    this.followingCount = page.locator('.following-count, [data-testid="following"]');
    this.profilePicture = page.locator('.profile-picture, .avatar img, [data-testid="profile-picture"]');
    this.notesList = page.locator('app-event, .event-card');
    this.editProfileButton = page.locator('button:has-text("Edit"), [data-testid="edit-profile"]');
  }

  async goto(pubkey?: string): Promise<void> {
    if (pubkey) {
      await this.page.goto(`/p/${pubkey}`);
    } else {
      await this.page.goto('/profile');
    }
    await this.waitForReady();
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
    await this.profileHeader.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {
      // Profile might not have a dedicated header element
    });
  }

  async getDisplayName(): Promise<string | null> {
    return await this.displayName.textContent();
  }

  async getBio(): Promise<string | null> {
    return await this.bio.textContent();
  }

  async clickFollow(): Promise<void> {
    await this.followButton.click();
  }

  async getNoteCount(): Promise<number> {
    return await this.notesList.count();
  }
}

/**
 * Messages Page - Direct messages
 */
export class MessagesPage extends BasePage {
  readonly conversationList: Locator;
  readonly messageThread: Locator;
  readonly messageInput: Locator;
  readonly sendButton: Locator;
  readonly newMessageButton: Locator;

  constructor(page: Page) {
    super(page);
    this.conversationList = page.locator('.conversation-list, app-conversations, [data-testid="conversations"]');
    this.messageThread = page.locator('.message-thread, app-message-thread, [data-testid="message-thread"]');
    this.messageInput = page.locator('textarea, input[type="text"]').last();
    this.sendButton = page.locator('button:has-text("Send"), button[aria-label*="Send"], [data-testid="send-message"]');
    this.newMessageButton = page.locator('button:has-text("New"), [data-testid="new-message"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/messages');
    await this.waitForReady();
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  async selectConversation(index: number): Promise<void> {
    const conversations = this.conversationList.locator('.conversation-item, li, .list-item');
    await conversations.nth(index).click();
  }

  async sendMessage(text: string): Promise<void> {
    await this.messageInput.fill(text);
    await this.sendButton.click();
  }

  async getConversationCount(): Promise<number> {
    const conversations = this.conversationList.locator('.conversation-item, li, .list-item');
    return await conversations.count();
  }
}

/**
 * Settings Page - User settings
 */
export class SettingsPage extends BasePage {
  readonly settingsForm: Locator;
  readonly saveButton: Locator;
  readonly relaysList: Locator;
  readonly themeToggle: Locator;

  constructor(page: Page) {
    super(page);
    this.settingsForm = page.locator('form, .settings-form, app-settings');
    this.saveButton = page.locator('button:has-text("Save"), button[type="submit"]');
    this.relaysList = page.locator('.relays-list, app-relays, [data-testid="relays"]');
    this.themeToggle = page.locator('[data-testid="theme-toggle"], .theme-toggle');
  }

  async goto(): Promise<void> {
    await this.page.goto('/settings');
    await this.waitForReady();
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  async toggleTheme(): Promise<void> {
    await this.themeToggle.click();
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }
}

/**
 * Login/Account Page
 */
export class LoginPage extends BasePage {
  readonly nsecInput: Locator;
  readonly loginButton: Locator;
  readonly extensionLoginButton: Locator;
  readonly bunkerInput: Locator;
  readonly createAccountButton: Locator;

  constructor(page: Page) {
    super(page);
    this.nsecInput = page.locator('input[type="password"], input[placeholder*="nsec"], [data-testid="nsec-input"]');
    this.loginButton = page.locator('button:has-text("Login"), button:has-text("Sign in"), [data-testid="login-button"]');
    this.extensionLoginButton = page.locator('button:has-text("Extension"), button:has-text("NIP-07"), [data-testid="extension-login"]');
    this.bunkerInput = page.locator('input[placeholder*="bunker"], [data-testid="bunker-input"]');
    this.createAccountButton = page.locator('button:has-text("Create"), [data-testid="create-account"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/accounts');
    await this.waitForReady();
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  async loginWithNsec(nsec: string): Promise<void> {
    await this.nsecInput.fill(nsec);
    await this.loginButton.click();
  }

  async clickExtensionLogin(): Promise<void> {
    await this.extensionLoginButton.click();
  }
}

/**
 * Music Page
 */
export class MusicPage extends BasePage {
  readonly musicList: Locator;
  readonly playButton: Locator;
  readonly nowPlaying: Locator;
  readonly playerControls: Locator;

  constructor(page: Page) {
    super(page);
    this.musicList = page.locator('app-music-list, .music-list, [data-testid="music-list"]');
    this.playButton = page.locator('button[aria-label*="Play"], .play-button');
    this.nowPlaying = page.locator('.now-playing, app-media-player');
    this.playerControls = page.locator('.player-controls, app-player-controls');
  }

  async goto(): Promise<void> {
    await this.page.goto('/music');
    await this.waitForReady();
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  async playFirstTrack(): Promise<void> {
    await this.playButton.first().click();
  }

  async isPlaying(): Promise<boolean> {
    const pauseButton = this.page.locator('button[aria-label*="Pause"], .pause-button');
    return await pauseButton.isVisible();
  }
}

/**
 * Command Palette
 */
export class CommandPalette {
  readonly dialog: Locator;
  readonly searchInput: Locator;
  readonly commandList: Locator;
  readonly commandItems: Locator;

  constructor(private page: Page) {
    this.dialog = page.locator('app-command-palette-dialog, [role="dialog"]');
    this.searchInput = page.locator('input[placeholder*="Search"], input[type="search"]');
    this.commandList = page.locator('.command-list, mat-list');
    this.commandItems = page.locator('.command-item, mat-list-item');
  }

  async open(): Promise<void> {
    await this.page.keyboard.press('Control+k');
    await this.dialog.waitFor({ state: 'visible' });
  }

  async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.dialog.waitFor({ state: 'hidden' });
  }

  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
  }

  async selectCommand(index: number): Promise<void> {
    await this.commandItems.nth(index).click();
  }

  async executeCommand(name: string): Promise<void> {
    await this.search(name);
    await this.page.keyboard.press('Enter');
  }

  async getCommandCount(): Promise<number> {
    return await this.commandItems.count();
  }
}
