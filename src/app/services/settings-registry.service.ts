import { Injectable, signal, computed } from '@angular/core';

/**
 * Represents a single searchable setting item
 */
export interface SettingsItem {
  id: string;
  title: string;
  description?: string;
  keywords: string[];
  section: string;
  sectionTitle: string;
  icon: string;
  route: string;
  /** If true, requires authentication */
  authenticated?: boolean;
  /** If true, requires premium subscription */
  premium?: boolean;
  /** Priority for display order (lower = higher priority) */
  priority?: number;
  /** If true, show in "Popular Settings" on home */
  popular?: boolean;
}

/**
 * Represents a settings section/category
 */
export interface SettingsSection {
  id: string;
  title: string;
  icon: string;
  route: string;
  authenticated?: boolean;
  premium?: boolean;
}

/**
 * Service that manages the registry of all searchable settings items.
 * This enables search functionality across all settings.
 */
@Injectable({
  providedIn: 'root'
})
export class SettingsRegistryService {
  /** Search query */
  readonly searchQuery = signal('');

  /** All registered settings sections */
  readonly sections: SettingsSection[] = [
    { id: 'general', title: $localize`:@@settings.sections.general:General`, icon: 'settings', route: '/settings/general' },
    { id: 'profile', title: $localize`:@@settings.sections.profile:Profile`, icon: 'person', route: '/settings/profile', authenticated: true },
    { id: 'appearance', title: $localize`:@@settings.sections.appearance:Appearance`, icon: 'palette', route: '/settings/appearance' },
    { id: 'navigation', title: $localize`:@@settings.sections.navigation:Menu & Navigation`, icon: 'menu', route: '/settings/navigation' },
    { id: 'content', title: $localize`:@@settings.sections.content:Feed & Content`, icon: 'article', route: '/settings/content' },
    { id: 'wallet-subscriptions', title: $localize`:@@settings.sections.wallet-subscriptions:Wallet & subscriptions`, icon: 'account_balance_wallet', route: '/settings/wallet-subscriptions', authenticated: true },
    { id: 'network', title: $localize`:@@settings.sections.network:Relays & Network`, icon: 'dns', route: '/settings/network', authenticated: true },
    { id: 'privacy', title: $localize`:@@settings.sections.privacy:Privacy & Safety`, icon: 'security', route: '/settings/privacy', authenticated: true },
    { id: 'web-of-trust', title: $localize`:@@settings.sections.web-of-trust:Web of Trust`, icon: 'verified_user', route: '/settings/web-of-trust', authenticated: true },
    { id: 'algorithm', title: $localize`:@@settings.sections.algorithm:Algorithm`, icon: 'model_training', route: '/settings/algorithm' },
    { id: 'storage', title: $localize`:@@settings.sections.storage:Storage`, icon: 'storage', route: '/settings/storage' },
    { id: 'backup', title: $localize`:@@settings.sections.backup:Backup`, icon: 'archive', route: '/settings/backup', authenticated: true },
    { id: 'logs-debug', title: $localize`:@@settings.sections.logs-debug:Logs & Debug`, icon: 'bug_report', route: '/settings/logs-debug' },
    { id: 'about', title: $localize`:@@settings.sections.about:About`, icon: 'info', route: '/settings/about' },
  ];

  /** All registered settings items (searchable) */
  readonly items: SettingsItem[] = [
    // General Settings
    {
      id: 'edit-profile',
      title: $localize`:@@settings.profile.edit:Edit Profile`,
      description: $localize`:@@settings.profile.edit.description:Update your name, picture, bio, and profile links`,
      keywords: ['profile', 'edit', 'bio', 'avatar', 'picture', 'name', 'metadata'],
      section: 'profile',
      sectionTitle: $localize`:@@settings.sections.profile:Profile`,
      icon: 'edit',
      route: '/settings/profile',
      authenticated: true,
      priority: 0,
      popular: true,
    },
    {
      id: 'wallet-overview',
      title: $localize`:@@settings.wallet.overview:Wallet`,
      description: $localize`:@@settings.wallet.overview.description:Open your wallet, transactions, zaps, and wallet settings`,
      keywords: ['wallet', 'lightning', 'bitcoin', 'zaps', 'transactions', 'payments', 'nwc'],
      section: 'wallet-subscriptions',
      sectionTitle: $localize`:@@settings.sections.wallet-subscriptions:Wallet & subscriptions`,
      icon: 'account_balance_wallet',
      route: '/settings/wallet-subscriptions',
      authenticated: true,
      priority: 1,
      popular: true,
    },
    {
      id: 'premium-subscription',
      title: $localize`:@@settings.wallet.premium:Premium Subscription`,
      description: $localize`:@@settings.wallet.premium.description:Manage your Nostria premium plan and subscription status`,
      keywords: ['premium', 'subscription', 'subscriptions', 'upgrade', 'plan', 'billing', 'pro'],
      section: 'wallet-subscriptions',
      sectionTitle: $localize`:@@settings.sections.wallet-subscriptions:Wallet & subscriptions`,
      icon: 'workspace_premium',
      route: '/settings/wallet-subscriptions',
      authenticated: true,
      priority: 2,
      popular: true,
    },
    {
      id: 'dark-mode',
      title: $localize`:@@settings.dark-mode:Theme`,
      description: $localize`:@@settings.dark-mode.description:Choose Auto, Dark, or Light theme`,
      keywords: ['dark', 'light', 'auto', 'theme', 'mode', 'appearance', 'color', 'system', 'device'],
      section: 'appearance',
      sectionTitle: $localize`:@@settings.sections.appearance:Appearance`,
      icon: 'dark_mode',
      route: '/settings/appearance',
      priority: 1,
      popular: true,
    },
    {
      id: 'language',
      title: $localize`:@@settings.language:Language`,
      description: $localize`:@@settings.language.description:Select your preferred language`,
      keywords: ['language', 'locale', 'translation', 'english', 'spanish', 'french', 'german'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'language',
      route: '/settings/general',
      priority: 2,
      popular: true,
    },
    {
      id: 'max-relays-per-user',
      title: $localize`:@@settings.max-relays.title:Max relays per user`,
      description: $localize`:@@settings.max-relays.description:Number of relays to use per user`,
      keywords: ['relays', 'max', 'per user', 'connection', 'limit'],
      section: 'network',
      sectionTitle: $localize`:@@settings.sections.network:Relays & Network`,
      icon: 'dns',
      route: '/settings/network',
      authenticated: true,
      priority: 10,
    },
    {
      id: 'relay-mode',
      title: $localize`:@@settings.relay-mode.title:Relays Mode`,
      description: $localize`:@@settings.relay-mode.description:Choose how relays are selected for querying other users`,
      keywords: ['relay', 'mode', 'outbox', 'hybrid', 'discovery', 'query'],
      section: 'network',
      sectionTitle: $localize`:@@settings.sections.network:Relays & Network`,
      icon: 'hub',
      route: '/settings/network',
      authenticated: true,
      priority: 10,
    },
    {
      id: 'auto-relay-auth',
      title: $localize`:@@settings.auto-relay-auth.title:Relay Authentication`,
      description: $localize`:@@settings.auto-relay-auth.description:Automatically authenticate with relays that require authentication`,
      keywords: ['relay', 'authentication', 'auto', 'auth', 'nip-42'],
      section: 'network',
      sectionTitle: $localize`:@@settings.sections.network:Relays & Network`,
      icon: 'key',
      route: '/settings/network',
      authenticated: true,
      priority: 11,
    },
    {
      id: 'client-tags',
      title: $localize`:@@settings.client-tags.title:Client Tags`,
      description: $localize`:@@settings.client-tags.add.description:Add the Nostria client tag to events you publish`,
      keywords: ['client', 'tag', 'nostria', 'identify'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'label',
      route: '/settings/content',
      priority: 12,
    },
    {
      id: 'x-dual-posting',
      title: 'Post to X',
      description: 'Connect X and optionally post to X when publishing from Nostria',
      keywords: ['x', 'twitter', 'dual post', 'cross post', 'share to x', 'social', 'oauth'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'share',
      route: '/settings/advanced-posting',
      priority: 13,
      authenticated: true,
      popular: true,
    },
    {
      id: 'media-privacy',
      title: $localize`:@@settings.media.title:Media`,
      description: $localize`:@@settings.media.description:Control how media content is displayed based on your following status`,
      keywords: ['media', 'image', 'video', 'blur', 'privacy', 'display', 'following'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'image',
      route: '/settings/content',
      priority: 5,
      popular: true,
    },
    {
      id: 'media-servers',
      title: $localize`:@@settings.media-servers.title:Media Servers`,
      description: $localize`:@@settings.media-servers.description:Manage your upload and fallback media servers`,
      keywords: ['media servers', 'upload server', 'fallback server', 'nip-96', 'blossom', 'media upload', 'file hosting'],
      section: 'network',
      sectionTitle: $localize`:@@settings.sections.network:Relays & Network`,
      icon: 'cloud_upload',
      route: '/collections/media?tab=servers',
      authenticated: true,
      priority: 6,
      popular: true,
    },
    {
      id: 'placeholder-algorithm',
      title: $localize`:@@settings.media.placeholder-algorithm:Placeholder Algorithm`,
      description: $localize`:@@settings.media.placeholder.thumbhash.description:Use Thumbhash for image placeholders`,
      keywords: ['placeholder', 'blurhash', 'thumbhash', 'image', 'loading'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'blur_on',
      route: '/settings/content',
      priority: 13,
    },
    {
      id: 'auto-play-video',
      title: $localize`:@@settings.media.auto-play-all:Auto-Play All Videos`,
      description: $localize`:@@settings.media.auto-play-all.description:When enabled, all videos will automatically play muted when they appear in the feed`,
      keywords: ['autoplay', 'video', 'play', 'automatic', 'muted', 'all', 'always'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'play_circle',
      route: '/settings/content',
      priority: 14,
    },
    {
      id: 'navigation-settings',
      title: $localize`:@@settings.navigation.title:Navigation`,
      description: $localize`:@@settings.navigation.start-last-page.description:When opening the app, restore the last page you were viewing`,
      keywords: ['navigation', 'start', 'last', 'page', 'route', 'restore', 'threads', 'lines'],
      section: 'navigation',
      sectionTitle: $localize`:@@settings.sections.navigation:Menu & Navigation`,
      icon: 'navigation',
      route: '/settings/navigation',
      priority: 1,
    },
    {
      id: 'home-destination',
      title: $localize`:@@settings.home-destination.title:Home Button Destination`,
      description: $localize`:@@settings.home-destination.description:Choose where the Nostria logo button should navigate to.`,
      keywords: ['home', 'button', 'logo', 'destination', 'feeds', 'first', 'menu', 'navigate', 'click'],
      section: 'navigation',
      sectionTitle: $localize`:@@settings.sections.navigation:Menu & Navigation`,
      icon: 'home',
      route: '/settings/navigation',
      priority: 1,
    },
    {
      id: 'text-size',
      title: $localize`:@@settings.display.text-size:Text Size`,
      description: $localize`:@@settings.display.text-size.description:Adjust the text size for better readability`,
      keywords: ['text', 'size', 'font', 'zoom', 'accessibility', 'display', 'scale', 'larger', 'smaller', 'readability', 'a11y'],
      section: 'appearance',
      sectionTitle: $localize`:@@settings.sections.appearance:Appearance`,
      icon: 'text_fields',
      route: '/settings/appearance',
      priority: 0,
      popular: true,
    },
    {
      id: 'font-selector',
      title: $localize`:@@settings.display.font:Font`,
      description: $localize`:@@settings.display.font.description:Choose your preferred font for the app`,
      keywords: ['font', 'typeface', 'roboto', 'system', 'sora', 'inter', 'typography', 'appearance', 'display'],
      section: 'appearance',
      sectionTitle: $localize`:@@settings.sections.appearance:Appearance`,
      icon: 'font_download',
      route: '/settings/appearance',
      priority: 1,
    },
    {
      id: 'lock-screen-rotation',
      title: $localize`:@@settings.display.lock-screen-rotation:Lock Screen Rotation`,
      description: $localize`:@@settings.display.lock-screen-rotation.description:Keep the app in portrait mode so it does not rotate when your device rotates. Applies only on devices and browsers that support orientation lock.`,
      keywords: ['rotation', 'orientation', 'portrait', 'landscape', 'lock', 'screen', 'display', 'mobile'],
      section: 'appearance',
      sectionTitle: $localize`:@@settings.sections.appearance:Appearance`,
      icon: 'screen_lock_rotation',
      route: '/settings/appearance',
      priority: 2,
    },
    {
      id: 'chat-widget',
      title: 'Chat Widget',
      description: 'Show a floating chat widget in the bottom-right corner for quick access to messages on desktop.',
      keywords: ['chat', 'widget', 'messages', 'floating', 'bubble', 'dm', 'direct', 'messenger'],
      section: 'appearance',
      sectionTitle: $localize`:@@settings.sections.appearance:Appearance`,
      icon: 'chat_bubble',
      route: '/settings/appearance',
      priority: 3,
    },
    {
      id: 'menu-customization',
      title: $localize`:@@settings.menu.title:Menu Customization`,
      description: $localize`:@@settings.menu.description:Drag items to reorder. Move items between lists to show or hide them.`,
      keywords: ['menu', 'customize', 'sidebar', 'navigation', 'order', 'reorder', 'drag', 'drop', 'hide', 'show'],
      section: 'navigation',
      sectionTitle: $localize`:@@settings.sections.navigation:Menu & Navigation`,
      icon: 'menu',
      route: '/settings/navigation',
      priority: 2,
      popular: true,
    },
    {
      id: 'default-reaction-emoji',
      title: $localize`:@@settings.reactions.default-emoji:Default Reaction Emoji`,
      description: $localize`:@@settings.reactions.default-emoji.description:Choose the emoji sent when you single-tap the reaction button. Long-press opens the full emoji picker.`,
      keywords: ['reaction', 'emoji', 'like', 'heart', 'default', 'tap', 'quick', 'favorite'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'favorite',
      route: '/settings/content',
      priority: 3,
    },
    {
      id: 'action-buttons',
      title: $localize`:@@settings.action-buttons.title:Action Buttons`,
      description: $localize`:@@settings.action-buttons.description:Choose how the action buttons (Like, Reply, Share, etc.) are displayed below posts and replies.`,
      keywords: ['action', 'buttons', 'display', 'mode', 'icons', 'labels', 'posts', 'replies', 'like', 'reply', 'share'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'touch_app',
      route: '/settings/content',
      priority: 4,
    },
    {
      id: 'right-sidebar',
      title: $localize`:@@settings.layout.right-sidebar:Show Right Sidebar`,
      description: $localize`:@@settings.layout.right-sidebar.description:Show the desktop right sidebar with Favorites and Runes. This syncs with your account settings across devices.`,
      keywords: ['right sidebar', 'sidebar', 'favorites', 'runes', 'layout', 'desktop', 'panel', 'widgets'],
      section: 'navigation',
      sectionTitle: $localize`:@@settings.sections.navigation:Menu & Navigation`,
      icon: 'right_panel_open',
      route: '/settings/navigation',
      authenticated: true,
      priority: 4,
    },
    {
      id: 'event-expiration',
      title: $localize`:@@settings.event-expiration.title:Global Event Expiration`,
      description: $localize`:@@settings.event-expiration.description:When enabled, all events you create will include an expiration tag (NIP-40)`,
      keywords: ['expiration', 'expire', 'nip-40', 'delete', 'temporary', 'event'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'timer',
      route: '/settings/advanced-posting',
      authenticated: true,
      priority: 15,
    },
    {
      id: 'calendar-system',
      title: $localize`:@@settings.calendar.title:Calendar System`,
      description: $localize`:@@settings.calendar.description:Choose your preferred calendar system for displaying dates`,
      keywords: ['calendar', 'date', 'time', 'gregorian', 'chronia', 'ethiopian', 'format'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'calendar_month',
      route: '/settings/general',
      priority: 16,
    },
    {
      id: 'logging',
      title: $localize`:@@settings.logging:Logging`,
      description: $localize`:@@settings.logging.description:Configure application logging levels`,
      keywords: ['log', 'debug', 'console', 'error', 'warning', 'info'],
      section: 'logs-debug',
      sectionTitle: $localize`:@@settings.sections.logs-debug:Logs & Debug`,
      icon: 'terminal',
      route: '/settings/logs-debug',
      priority: 17,
    },
    {
      id: 'notification-spam-filter',
      title: $localize`:@@settings.notification-spam-filter.title:Notification Spam Filter`,
      description: $localize`:@@settings.notification-spam-filter.description:Filter out notifications from events that tag too many accounts`,
      keywords: ['notification', 'spam', 'filter', 'tag', 'mass', 'tagged', 'accounts', 'block', 'mentions'],
      section: 'privacy',
      sectionTitle: $localize`:@@settings.sections.privacy:Privacy & Safety`,
      icon: 'filter_alt',
      route: '/settings/privacy',
      authenticated: true,
      priority: 18,
    },
    {
      id: 'external-links',
      title: $localize`:@@settings.external-links.title:External Links`,
      description: $localize`:@@settings.external-links.description:Configure which external domains should open within the app`,
      keywords: ['external', 'links', 'domain', 'open', 'browser', 'tab'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'open_in_new',
      route: '/settings/content',
      priority: 18,
    },
    {
      id: 'storage-stats',
      title: $localize`:@@settings.storage.title:Storage`,
      description: $localize`:@@settings.storage.description:View storage usage statistics`,
      keywords: ['storage', 'database', 'size', 'cache', 'usage', 'space', 'indexeddb'],
      section: 'storage',
      sectionTitle: $localize`:@@settings.sections.storage:Storage`,
      icon: 'storage',
      route: '/settings/storage',
      priority: 1,
      popular: true,
    },
    {
      id: 'shared-database',
      title: $localize`:@@settings.database.shared:Shared Database`,
      description: $localize`:@@settings.database.shared.description:Profiles, contacts, relay lists and relay data shared across all accounts`,
      keywords: ['shared', 'database', 'profiles', 'contacts', 'relays', 'global'],
      section: 'storage',
      sectionTitle: $localize`:@@settings.sections.storage:Storage`,
      icon: 'public',
      route: '/settings/storage',
      priority: 2,
    },
    {
      id: 'account-database',
      title: $localize`:@@settings.database.account:Account Database`,
      description: $localize`:@@settings.database.account.description:Per-account feed events, notifications, messages, and cache`,
      keywords: ['account', 'database', 'personal', 'events', 'notifications', 'messages'],
      section: 'storage',
      sectionTitle: $localize`:@@settings.sections.storage:Storage`,
      icon: 'person',
      route: '/settings/storage',
      priority: 3,
    },
    {
      id: 'cache-management',
      title: $localize`:@@settings.cache.title:Cache Management`,
      description: $localize`:@@settings.cache.description:Clear specific types of cached data`,
      keywords: ['cache', 'clear', 'emoji', 'reset', 'clean', 'images', 'events', 'notifications'],
      section: 'storage',
      sectionTitle: $localize`:@@settings.sections.storage:Storage`,
      icon: 'cleaning_services',
      route: '/settings/storage',
      priority: 4,
    },
    {
      id: 'wipe-data',
      title: $localize`:@@settings.danger-zone.wipe-data:Wipe All Data`,
      description: $localize`:@@settings.danger-zone.wipe-data.description:This will delete all your local app data and reload the application`,
      keywords: ['wipe', 'delete', 'data', 'reset', 'clear', 'danger', 'all'],
      section: 'storage',
      sectionTitle: $localize`:@@settings.sections.storage:Storage`,
      icon: 'delete_forever',
      route: '/settings/storage',
      priority: 100,
    },
    {
      id: 'release-channel',
      title: $localize`:@@settings.release-channel:Release Channel`,
      description: $localize`:@@settings.release-channel.description:Get early access to new features (Premium)`,
      keywords: ['release', 'channel', 'beta', 'preview', 'stable', 'feature', 'early', 'access'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'science',
      route: '/settings/general',
      premium: true,
      priority: 21,
    },

    // Algorithm Settings
    {
      id: 'algorithm-stats',
      title: $localize`:@@settings.algorithm.stats.title:Algorithm Statistics`,
      description: $localize`:@@settings.algorithm.stats.subtitle:Overview of your engagement metrics`,
      keywords: ['algorithm', 'stats', 'statistics', 'engagement', 'metrics', 'users'],
      section: 'algorithm',
      sectionTitle: $localize`:@@settings.sections.algorithm:Algorithm`,
      icon: 'analytics',
      route: '/settings/algorithm',
      priority: 1,
    },
    {
      id: 'user-metrics',
      title: $localize`:@@settings.algorithm.metrics.title:User Metrics`,
      description: $localize`:@@settings.algorithm.metrics.subtitle:View and manage user engagement data`,
      keywords: ['user', 'metrics', 'engagement', 'viewed', 'liked', 'time', 'score'],
      section: 'algorithm',
      sectionTitle: $localize`:@@settings.sections.algorithm:Algorithm`,
      icon: 'trending_up',
      route: '/settings/algorithm',
      priority: 2,
    },
    {
      id: 'favorites',
      title: $localize`:@@settings.algorithm.favorites:Favorites`,
      description: $localize`:@@settings.algorithm.favorites.description:Manage your favorite users for content prioritization`,
      keywords: ['favorites', 'favorite', 'users', 'priority', 'boost', 'top'],
      section: 'algorithm',
      sectionTitle: $localize`:@@settings.sections.algorithm:Algorithm`,
      icon: 'favorite',
      route: '/settings/algorithm',
      priority: 3,
      popular: true,
    },

    // Relay Settings
    {
      id: 'account-relays',
      title: $localize`:@@settings.relays.account-relays:Account Relays`,
      description: $localize`:@@settings.relays.account-relays.description:Manage your personal relay connections`,
      keywords: ['relay', 'relays', 'account', 'connection', 'websocket', 'wss'],
      section: 'network',
      sectionTitle: $localize`:@@settings.sections.network:Relays & Network`,
      icon: 'dns',
      route: '/relays?tab=account',
      authenticated: true,
      priority: 1,
      popular: true,
    },
    {
      id: 'discovery-relays',
      title: $localize`:@@settings.relays.discovery:Discovery Relays`,
      description: $localize`:@@settings.relays.discovery.description:Relays used to discover other users`,
      keywords: ['discovery', 'relay', 'find', 'users', 'search'],
      section: 'network',
      sectionTitle: $localize`:@@settings.sections.network:Relays & Network`,
      icon: 'explore',
      route: '/relays?tab=discovery',
      authenticated: true,
      priority: 2,
    },
    {
      id: 'dm-relays',
      title: $localize`:@@settings.relays.dm:DM Relays`,
      description: $localize`:@@settings.relays.dm.description:Relays used for direct messages`,
      keywords: ['dm', 'direct', 'message', 'relay', 'private', 'inbox'],
      section: 'network',
      sectionTitle: $localize`:@@settings.sections.network:Relays & Network`,
      icon: 'mail',
      route: '/relays?tab=account',
      authenticated: true,
      priority: 3,
    },

    {
      id: 'observed-relays',
      title: $localize`:@@settings.relays.observed:Observed Relays`,
      description: $localize`:@@settings.relays.observed.description:Inspect relays observed from the wider network`,
      keywords: ['observed', 'relay', 'network', 'seen', 'cluster'],
      section: 'network',
      sectionTitle: $localize`:@@settings.sections.network:Relays & Network`,
      icon: 'visibility',
      route: '/relays?tab=observed',
      authenticated: true,
      priority: 4,
    },

    // Search Settings
    {
      id: 'search-relays',
      title: $localize`:@@settings.search.relays:Search Relays`,
      description: $localize`:@@settings.search.relays.description:Configure which relays to use for search`,
      keywords: ['search', 'relay', 'query', 'find'],
      section: 'network',
      sectionTitle: $localize`:@@settings.sections.network:Relays & Network`,
      icon: 'search',
      route: '/settings/search',
      authenticated: true,
      priority: 1,
    },

    // Privacy Settings
    {
      id: 'mute-list',
      title: $localize`:@@settings.privacy.mute-list:Mute List`,
      description: $localize`:@@settings.privacy.mute-list.description:Manage muted users and content`,
      keywords: ['mute', 'block', 'hide', 'user', 'content', 'filter'],
      section: 'privacy',
      sectionTitle: $localize`:@@settings.sections.privacy:Privacy & Safety`,
      icon: 'volume_off',
      route: '/settings/privacy',
      authenticated: true,
      priority: 1,
      popular: true,
    },
    {
      id: 'content-warning',
      title: $localize`:@@settings.privacy.content-warning:Content Warnings`,
      description: $localize`:@@settings.privacy.content-warning.description:Configure how content warnings are displayed`,
      keywords: ['content', 'warning', 'nsfw', 'sensitive', 'blur', 'hide'],
      section: 'privacy',
      sectionTitle: $localize`:@@settings.sections.privacy:Privacy & Safety`,
      icon: 'warning',
      route: '/settings/privacy',
      authenticated: true,
      priority: 2,
    },

    // Trust Settings
    {
      id: 'trust-network',
      title: $localize`:@@settings.trust.network:Trust Network`,
      description: $localize`:@@settings.trust.network.description:Configure trust levels for users`,
      keywords: ['trust', 'network', 'verify', 'verified', 'reputation', 'web of trust'],
      section: 'web-of-trust',
      sectionTitle: $localize`:@@settings.sections.web-of-trust:Web of Trust`,
      icon: 'verified_user',
      route: '/settings/web-of-trust',
      authenticated: true,
      priority: 1,
    },

    // Backup Settings
    {
      id: 'backup-restore',
      title: $localize`:@@settings.backup.restore:Backup & Restore`,
      description: $localize`:@@settings.backup.restore.description:Create and restore backups of your Nostr data`,
      keywords: ['backup', 'restore', 'export', 'import', 'save', 'data', 'events', 'download', 'zip'],
      section: 'backup',
      sectionTitle: $localize`:@@settings.sections.backup:Backup`,
      icon: 'cloud_download',
      route: '/settings/backup',
      authenticated: true,
      priority: 1,
      popular: true,
    },
    {
      id: 'following-history',
      title: $localize`:@@settings.backup.following-history:Following List History`,
      description: $localize`:@@settings.backup.following-history.description:View and restore previous versions of your following list`,
      keywords: ['following', 'history', 'backup', 'restore', 'contacts', 'merge', 'list'],
      section: 'backup',
      sectionTitle: $localize`:@@settings.sections.backup:Backup`,
      icon: 'people',
      route: '/settings/backup',
      authenticated: true,
      priority: 2,
    },


    // Logs Settings
    {
      id: 'app-logs',
      title: $localize`:@@settings.logs.app:Application Logs`,
      description: $localize`:@@settings.logs.app.description:View application logs for debugging`,
      keywords: ['logs', 'debug', 'error', 'console', 'troubleshoot'],
      section: 'logs-debug',
      sectionTitle: $localize`:@@settings.sections.logs-debug:Logs & Debug`,
      icon: 'article',
      route: '/settings/logs',
      priority: 1,
    },

    // About
    {
      id: 'about-nostria',
      title: $localize`:@@settings.about.nostria:About Nostria`,
      description: $localize`:@@settings.about.nostria.description:Information about the app`,
      keywords: ['about', 'nostria', 'version', 'app', 'info', 'credits'],
      section: 'about',
      sectionTitle: $localize`:@@settings.sections.about:About`,
      icon: 'info',
      route: '/settings/about',
      priority: 1,
    },

    // Image Cache Service (commonly searched)
    {
      id: 'image-cache',
      title: $localize`:@@settings.image-cache.title:Image Cache Service`,
      description: $localize`:@@settings.image-cache.description:Configure image proxy and caching settings`,
      keywords: ['image', 'cache', 'proxy', 'optimize', 'cdn', 'region', 'picture', 'avatar'],
      section: 'privacy',
      sectionTitle: $localize`:@@settings.sections.privacy:Privacy & Safety`,
      icon: 'image',
      route: '/settings/privacy',
      authenticated: true,
      priority: 4,
      popular: true,
    },
    // Music Settings
    {
      id: 'music-status',
      title: $localize`:@@settings.music-status.title:Music Status`,
      description: $localize`:@@settings.music-status.description:Share what you're listening to via NIP-38 user status`,
      keywords: ['music', 'status', 'nip-38', 'now playing', 'listening', 'share', 'song', 'track', 'audio'],
      section: 'content',
      sectionTitle: $localize`:@@settings.sections.content:Feed & Content`,
      icon: 'music_note',
      route: '/settings/content',
      priority: 19,
    },

    // Debug Settings
    {
      id: 'simulate-platform',
      title: $localize`:@@settings.simulate-platform:Simulate Platform`,
      description: $localize`:@@settings.simulate-platform.description:Override detected platform to test payment flows`,
      keywords: ['debug', 'simulate', 'platform', 'android', 'ios', 'payment', 'test', 'developer'],
      section: 'logs-debug',
      sectionTitle: $localize`:@@settings.sections.logs-debug:Logs & Debug`,
      icon: 'bug_report',
      route: '/settings/debug',
      priority: 1,
    },
  ];

  /** Popular settings for home page */
  readonly popularItems = computed(() =>
    this.items
      .filter(item => item.popular)
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
  );

  /** Filtered items based on search query */
  readonly filteredItems = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) {
      return [];
    }

    return this.items
      .filter(item => {
        const titleMatch = item.title.toLowerCase().includes(query);
        const descMatch = item.description?.toLowerCase().includes(query);
        const keywordMatch = item.keywords.some(k => k.toLowerCase().includes(query));
        const sectionMatch = item.sectionTitle.toLowerCase().includes(query);
        return titleMatch || descMatch || keywordMatch || sectionMatch;
      })
      .sort((a, b) => {
        // Prioritize title matches
        const aTitle = a.title.toLowerCase().includes(query) ? 0 : 1;
        const bTitle = b.title.toLowerCase().includes(query) ? 0 : 1;
        if (aTitle !== bTitle) return aTitle - bTitle;

        // Then by priority
        return (a.priority ?? 999) - (b.priority ?? 999);
      });
  });

  /** Grouped filtered items by section */
  readonly filteredItemsBySection = computed(() => {
    const items = this.filteredItems();
    const grouped = new Map<string, SettingsItem[]>();

    for (const item of items) {
      const existing = grouped.get(item.section) ?? [];
      existing.push(item);
      grouped.set(item.section, existing);
    }

    return grouped;
  });

  /** Has search results */
  readonly hasSearchResults = computed(() => this.filteredItems().length > 0);

  /** Is searching (has query) */
  readonly isSearching = computed(() => this.searchQuery().trim().length > 0);

  /**
   * Update search query
   */
  setSearchQuery(query: string): void {
    this.searchQuery.set(query);
  }

  /**
   * Clear search
   */
  clearSearch(): void {
    this.searchQuery.set('');
  }

  /**
   * Get section by ID
   */
  getSection(id: string): SettingsSection | undefined {
    return this.sections.find(s => s.id === id);
  }

  /**
   * Get items for a specific section
   */
  getItemsForSection(sectionId: string): SettingsItem[] {
    return this.items
      .filter(item => item.section === sectionId)
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  }
}
