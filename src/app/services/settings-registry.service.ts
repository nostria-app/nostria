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
    { id: 'layout', title: $localize`:@@settings.sections.layout:Layout`, icon: 'dashboard_customize', route: '/settings/layout' },
    { id: 'algorithm', title: $localize`:@@settings.sections.algorithm:Algorithm`, icon: 'model_training', route: '/settings/algorithm' },
    { id: 'relays', title: $localize`:@@settings.sections.relays:Relays`, icon: 'dns', route: '/settings/relays', authenticated: true },
    { id: 'search', title: $localize`:@@settings.sections.search:Search`, icon: 'search', route: '/settings/search', authenticated: true },
    { id: 'privacy', title: $localize`:@@settings.sections.privacy:Privacy & Safety`, icon: 'security', route: '/settings/privacy', authenticated: true },
    { id: 'trust', title: $localize`:@@settings.sections.trust:Trust`, icon: 'verified_user', route: '/settings/trust', authenticated: true },
    { id: 'wallet', title: $localize`:@@settings.sections.wallet:Wallet`, icon: 'account_balance_wallet', route: '/settings/wallet', authenticated: true },
    { id: 'backup', title: $localize`:@@settings.sections.backup:Backup`, icon: 'archive', route: '/settings/backup', authenticated: true },
    { id: 'premium', title: $localize`:@@settings.sections.premium:Premium`, icon: 'diamond', route: '/settings/premium', authenticated: true },
    { id: 'database', title: $localize`:@@settings.sections.database:Database`, icon: 'storage', route: '/settings/database' },
    { id: 'logs', title: $localize`:@@settings.sections.logs:Logs`, icon: 'article', route: '/settings/logs' },
    { id: 'about', title: $localize`:@@settings.sections.about:About`, icon: 'info', route: '/settings/about' },
  ];

  /** All registered settings items (searchable) */
  readonly items: SettingsItem[] = [
    // General Settings
    {
      id: 'dark-mode',
      title: $localize`:@@settings.dark-mode:Dark Mode`,
      description: $localize`:@@settings.dark-mode.description:Toggle dark or light theme`,
      keywords: ['dark', 'light', 'theme', 'mode', 'appearance', 'color'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'dark_mode',
      route: '/settings/general',
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
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'dns',
      route: '/settings/general',
      priority: 10,
    },
    {
      id: 'relay-mode',
      title: $localize`:@@settings.relay-mode.title:Relays Mode`,
      description: $localize`:@@settings.relay-mode.description:Choose how relays are selected for querying other users`,
      keywords: ['relay', 'mode', 'outbox', 'hybrid', 'discovery', 'query'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'hub',
      route: '/settings/general',
      priority: 10,
    },
    {
      id: 'auto-relay-auth',
      title: $localize`:@@settings.auto-relay-auth.title:Relay Authentication`,
      description: $localize`:@@settings.auto-relay-auth.description:Automatically authenticate with relays that require authentication`,
      keywords: ['relay', 'authentication', 'auto', 'auth', 'nip-42'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'key',
      route: '/settings/general',
      priority: 11,
    },
    {
      id: 'client-tags',
      title: $localize`:@@settings.client-tags.title:Client Tags`,
      description: $localize`:@@settings.client-tags.add.description:Add the Nostria client tag to events you publish`,
      keywords: ['client', 'tag', 'nostria', 'identify'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'label',
      route: '/settings/general',
      priority: 12,
    },
    {
      id: 'media-privacy',
      title: $localize`:@@settings.media.title:Media`,
      description: $localize`:@@settings.media.description:Control how media content is displayed based on your following status`,
      keywords: ['media', 'image', 'video', 'blur', 'privacy', 'display', 'following'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'image',
      route: '/settings/general',
      priority: 5,
      popular: true,
    },
    {
      id: 'media-servers',
      title: $localize`:@@settings.media-servers.title:Media Servers`,
      description: $localize`:@@settings.media-servers.description:Manage your upload and fallback media servers`,
      keywords: ['media servers', 'upload server', 'fallback server', 'nip-96', 'blossom', 'media upload', 'file hosting'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'cloud_upload',
      route: '/collections/media?tab=servers',
      priority: 6,
      popular: true,
    },
    {
      id: 'placeholder-algorithm',
      title: $localize`:@@settings.media.placeholder-algorithm:Placeholder Algorithm`,
      description: $localize`:@@settings.media.placeholder.thumbhash.description:Use Thumbhash for image placeholders`,
      keywords: ['placeholder', 'blurhash', 'thumbhash', 'image', 'loading'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'blur_on',
      route: '/settings/general',
      priority: 13,
    },
    {
      id: 'auto-play-video',
      title: $localize`:@@settings.media.auto-play-all:Auto-Play All Videos`,
      description: $localize`:@@settings.media.auto-play-all.description:When enabled, all videos will automatically play muted when they appear in the feed`,
      keywords: ['autoplay', 'video', 'play', 'automatic', 'muted', 'all', 'always'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'play_circle',
      route: '/settings/general',
      priority: 14,
    },
    {
      id: 'navigation-settings',
      title: $localize`:@@settings.navigation.title:Navigation`,
      description: $localize`:@@settings.navigation.start-last-page.description:When opening the app, restore the last page you were viewing`,
      keywords: ['navigation', 'start', 'last', 'page', 'route', 'restore', 'threads', 'lines'],
      section: 'layout',
      sectionTitle: $localize`:@@settings.sections.layout:Layout`,
      icon: 'navigation',
      route: '/settings/layout',
      priority: 1,
    },
    {
      id: 'home-destination',
      title: $localize`:@@settings.home-destination.title:Home Button Destination`,
      description: $localize`:@@settings.home-destination.description:Choose where the Nostria logo button should navigate to.`,
      keywords: ['home', 'button', 'logo', 'destination', 'feeds', 'first', 'menu', 'navigate', 'click'],
      section: 'layout',
      sectionTitle: $localize`:@@settings.sections.layout:Layout`,
      icon: 'home',
      route: '/settings/layout',
      priority: 1,
    },
    {
      id: 'text-size',
      title: $localize`:@@settings.display.text-size:Text Size`,
      description: $localize`:@@settings.display.text-size.description:Adjust the text size for better readability`,
      keywords: ['text', 'size', 'font', 'zoom', 'accessibility', 'display', 'scale', 'larger', 'smaller', 'readability', 'a11y'],
      section: 'layout',
      sectionTitle: $localize`:@@settings.sections.layout:Layout`,
      icon: 'text_fields',
      route: '/settings/layout',
      priority: 0,
      popular: true,
    },
    {
      id: 'font-selector',
      title: $localize`:@@settings.display.font:Font`,
      description: $localize`:@@settings.display.font.description:Choose your preferred font for the app`,
      keywords: ['font', 'typeface', 'roboto', 'system', 'sora', 'inter', 'typography', 'appearance', 'display'],
      section: 'layout',
      sectionTitle: $localize`:@@settings.sections.layout:Layout`,
      icon: 'font_download',
      route: '/settings/layout',
      priority: 1,
    },
    {
      id: 'menu-customization',
      title: $localize`:@@settings.menu.title:Menu Customization`,
      description: $localize`:@@settings.menu.description:Drag items to reorder. Move items between lists to show or hide them.`,
      keywords: ['menu', 'customize', 'sidebar', 'navigation', 'order', 'reorder', 'drag', 'drop', 'hide', 'show'],
      section: 'layout',
      sectionTitle: $localize`:@@settings.sections.layout:Layout`,
      icon: 'menu',
      route: '/settings/layout',
      priority: 2,
      popular: true,
    },
    {
      id: 'default-reaction-emoji',
      title: $localize`:@@settings.reactions.default-emoji:Default Reaction Emoji`,
      description: $localize`:@@settings.reactions.default-emoji.description:Choose the emoji sent when you single-tap the reaction button. Long-press opens the full emoji picker.`,
      keywords: ['reaction', 'emoji', 'like', 'heart', 'default', 'tap', 'quick', 'favorite'],
      section: 'layout',
      sectionTitle: $localize`:@@settings.sections.layout:Layout`,
      icon: 'favorite',
      route: '/settings/layout',
      priority: 3,
    },
    {
      id: 'event-expiration',
      title: $localize`:@@settings.event-expiration.title:Global Event Expiration`,
      description: $localize`:@@settings.event-expiration.description:When enabled, all events you create will include an expiration tag (NIP-40)`,
      keywords: ['expiration', 'expire', 'nip-40', 'delete', 'temporary', 'event'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'timer',
      route: '/settings/general',
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
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'terminal',
      route: '/settings/general',
      priority: 17,
    },
    {
      id: 'notification-spam-filter',
      title: $localize`:@@settings.notification-spam-filter.title:Notification Spam Filter`,
      description: $localize`:@@settings.notification-spam-filter.description:Filter out notifications from events that tag too many accounts`,
      keywords: ['notification', 'spam', 'filter', 'tag', 'mass', 'tagged', 'accounts', 'block', 'mentions'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'filter_alt',
      route: '/settings/general',
      priority: 18,
    },
    {
      id: 'external-links',
      title: $localize`:@@settings.external-links.title:External Links`,
      description: $localize`:@@settings.external-links.description:Configure which external domains should open within the app`,
      keywords: ['external', 'links', 'domain', 'open', 'browser', 'tab'],
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'open_in_new',
      route: '/settings/general',
      priority: 18,
    },
    {
      id: 'storage-stats',
      title: $localize`:@@settings.storage.title:Storage`,
      description: $localize`:@@settings.storage.description:View storage usage statistics`,
      keywords: ['storage', 'database', 'size', 'cache', 'usage', 'space', 'indexeddb'],
      section: 'database',
      sectionTitle: $localize`:@@settings.sections.database:Database`,
      icon: 'storage',
      route: '/settings/database',
      priority: 1,
      popular: true,
    },
    {
      id: 'shared-database',
      title: $localize`:@@settings.database.shared:Shared Database`,
      description: $localize`:@@settings.database.shared.description:Profiles, contacts, relay lists and relay data shared across all accounts`,
      keywords: ['shared', 'database', 'profiles', 'contacts', 'relays', 'global'],
      section: 'database',
      sectionTitle: $localize`:@@settings.sections.database:Database`,
      icon: 'public',
      route: '/settings/database',
      priority: 2,
    },
    {
      id: 'account-database',
      title: $localize`:@@settings.database.account:Account Database`,
      description: $localize`:@@settings.database.account.description:Per-account feed events, notifications, messages, and cache`,
      keywords: ['account', 'database', 'personal', 'events', 'notifications', 'messages'],
      section: 'database',
      sectionTitle: $localize`:@@settings.sections.database:Database`,
      icon: 'person',
      route: '/settings/database',
      priority: 3,
    },
    {
      id: 'cache-management',
      title: $localize`:@@settings.cache.title:Cache Management`,
      description: $localize`:@@settings.cache.description:Clear specific types of cached data`,
      keywords: ['cache', 'clear', 'emoji', 'reset', 'clean', 'images', 'events', 'notifications'],
      section: 'database',
      sectionTitle: $localize`:@@settings.sections.database:Database`,
      icon: 'cleaning_services',
      route: '/settings/database',
      priority: 4,
    },
    {
      id: 'wipe-data',
      title: $localize`:@@settings.danger-zone.wipe-data:Wipe All Data`,
      description: $localize`:@@settings.danger-zone.wipe-data.description:This will delete all your local app data and reload the application`,
      keywords: ['wipe', 'delete', 'data', 'reset', 'clear', 'danger', 'all'],
      section: 'database',
      sectionTitle: $localize`:@@settings.sections.database:Database`,
      icon: 'delete_forever',
      route: '/settings/database',
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
      section: 'relays',
      sectionTitle: $localize`:@@settings.sections.relays:Relays`,
      icon: 'dns',
      route: '/settings/relays',
      authenticated: true,
      priority: 1,
      popular: true,
    },
    {
      id: 'discovery-relays',
      title: $localize`:@@settings.relays.discovery:Discovery Relays`,
      description: $localize`:@@settings.relays.discovery.description:Relays used to discover other users`,
      keywords: ['discovery', 'relay', 'find', 'users', 'search'],
      section: 'relays',
      sectionTitle: $localize`:@@settings.sections.relays:Relays`,
      icon: 'explore',
      route: '/settings/relays',
      authenticated: true,
      priority: 2,
    },
    {
      id: 'dm-relays',
      title: $localize`:@@settings.relays.dm:DM Relays`,
      description: $localize`:@@settings.relays.dm.description:Relays used for direct messages`,
      keywords: ['dm', 'direct', 'message', 'relay', 'private', 'inbox'],
      section: 'relays',
      sectionTitle: $localize`:@@settings.sections.relays:Relays`,
      icon: 'mail',
      route: '/settings/relays',
      authenticated: true,
      priority: 3,
    },

    // Search Settings
    {
      id: 'search-relays',
      title: $localize`:@@settings.search.relays:Search Relays`,
      description: $localize`:@@settings.search.relays.description:Configure which relays to use for search`,
      keywords: ['search', 'relay', 'query', 'find', 'nostr.band'],
      section: 'search',
      sectionTitle: $localize`:@@settings.sections.search:Search`,
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
      section: 'trust',
      sectionTitle: $localize`:@@settings.sections.trust:Trust`,
      icon: 'verified_user',
      route: '/settings/trust',
      authenticated: true,
      priority: 1,
    },

    // Wallet Settings
    {
      id: 'wallet-connect',
      title: $localize`:@@settings.wallet.connect:Wallet Connect`,
      description: $localize`:@@settings.wallet.connect.description:Connect your Lightning wallet for zaps`,
      keywords: ['wallet', 'connect', 'nwc', 'lightning', 'zap', 'bitcoin', 'sats'],
      section: 'wallet',
      sectionTitle: $localize`:@@settings.sections.wallet:Wallet`,
      icon: 'account_balance_wallet',
      route: '/settings/wallet',
      authenticated: true,
      priority: 1,
      popular: true,
    },
    {
      id: 'default-zap',
      title: $localize`:@@settings.wallet.default-zap:Default Zap Amount`,
      description: $localize`:@@settings.wallet.default-zap.description:Set the default amount for quick zaps`,
      keywords: ['zap', 'amount', 'default', 'sats', 'lightning', 'tip'],
      section: 'wallet',
      sectionTitle: $localize`:@@settings.sections.wallet:Wallet`,
      icon: 'bolt',
      route: '/settings/wallet',
      authenticated: true,
      priority: 2,
      popular: true,
    },
    {
      id: 'auto-zap',
      title: $localize`:@@settings.wallet.auto-zap:Auto Zap`,
      description: $localize`:@@settings.wallet.auto-zap.description:Automatically zap content you like`,
      keywords: ['auto', 'zap', 'automatic', 'like', 'reaction'],
      section: 'wallet',
      sectionTitle: $localize`:@@settings.sections.wallet:Wallet`,
      icon: 'auto_awesome',
      route: '/settings/wallet',
      authenticated: true,
      priority: 3,
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

    // Premium Settings
    {
      id: 'subscription',
      title: $localize`:@@settings.premium.subscription:Subscription`,
      description: $localize`:@@settings.premium.subscription.description:Manage your premium subscription`,
      keywords: ['premium', 'subscription', 'plan', 'upgrade', 'pro', 'features'],
      section: 'premium',
      sectionTitle: $localize`:@@settings.sections.premium:Premium`,
      icon: 'diamond',
      route: '/settings/premium',
      authenticated: true,
      priority: 1,
    },

    // Logs Settings
    {
      id: 'app-logs',
      title: $localize`:@@settings.logs.app:Application Logs`,
      description: $localize`:@@settings.logs.app.description:View application logs for debugging`,
      keywords: ['logs', 'debug', 'error', 'console', 'troubleshoot'],
      section: 'logs',
      sectionTitle: $localize`:@@settings.sections.logs:Logs`,
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
      section: 'general',
      sectionTitle: $localize`:@@settings.sections.general:General`,
      icon: 'image',
      route: '/settings/general',
      priority: 4,
      popular: true,
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
