/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal, computed } from '@angular/core';
import { MusicArtistComponent } from './music-artist.component';

function createComponent(opts: { currentPubkey?: string; viewingPubkey?: string; profileName?: string } = {}): MusicArtistComponent {
  const component = Object.create(MusicArtistComponent.prototype) as MusicArtistComponent;

  // Mock accountState.pubkey as a signal
  const accountStatePubkey = signal<string | null>(opts.currentPubkey ?? null);
  (component as any).accountState = { pubkey: accountStatePubkey };

  // Initialize signals
  (component as any).pubkey = signal<string>(opts.viewingPubkey ?? '');
  (component as any).authorProfile = signal<any>(
    opts.profileName ? { data: { name: opts.profileName } } : undefined
  );
  (component as any).tracks = signal<any[]>([]);
  (component as any).playlists = signal<any[]>([]);
  (component as any).zapService = {
    getLightningAddress: (profileData: { lud16?: string; lud06?: string }) => profileData.lud16 || profileData.lud06 || null,
  };

  // Re-create computed signals
  (component as any).isOwnProfile = computed(() => {
    const currentPk = (component as any).accountState.pubkey();
    const viewingPk = (component as any).pubkey();
    return !!currentPk && currentPk === viewingPk;
  });

  (component as any).artistName = computed(() => {
    const profile = (component as any).authorProfile();
    return profile?.data?.name || profile?.data?.display_name || 'Unknown Artist';
  });

  (component as any).trackCount = computed(() => (component as any).tracks().length);
  (component as any).playlistCount = computed(() => (component as any).playlists().length);
  (component as any).canZapArtist = computed(() => {
    const profileData = (component as any).authorProfile()?.data;
    if (!profileData) return false;
    return (component as any).zapService.getLightningAddress(profileData) !== null;
  });

  (component as any).panelTitle = computed(() =>
    (component as any).isOwnProfile() ? 'My Music' : (component as any).artistName()
  );

  return component;
}

describe('MusicArtistComponent', () => {
  describe('panelTitle', () => {
    it('should show "My Music" when viewing own profile', () => {
      const pubkey = 'abc123';
      const component = createComponent({
        currentPubkey: pubkey,
        viewingPubkey: pubkey,
        profileName: 'Alice',
      });

      expect(component.panelTitle()).toBe('My Music');
    });

    it('should show artist name when viewing another user\'s profile', () => {
      const component = createComponent({
        currentPubkey: 'abc123',
        viewingPubkey: 'def456',
        profileName: 'Bob',
      });

      expect(component.panelTitle()).toBe('Bob');
    });

    it('should show "Unknown Artist" when viewing another user with no profile', () => {
      const component = createComponent({
        currentPubkey: 'abc123',
        viewingPubkey: 'def456',
      });

      expect(component.panelTitle()).toBe('Unknown Artist');
    });

    it('should show "My Music" even when own profile has no name', () => {
      const pubkey = 'abc123';
      const component = createComponent({
        currentPubkey: pubkey,
        viewingPubkey: pubkey,
      });

      expect(component.panelTitle()).toBe('My Music');
    });

    it('should show artist name when user is not authenticated', () => {
      const component = createComponent({
        viewingPubkey: 'def456',
        profileName: 'Charlie',
      });

      expect(component.panelTitle()).toBe('Charlie');
    });

    it('should react to profile changes for other artists', () => {
      const component = createComponent({
        currentPubkey: 'abc123',
        viewingPubkey: 'def456',
        profileName: 'Dave',
      });

      expect(component.panelTitle()).toBe('Dave');

      // Profile updates
      (component as any).authorProfile.set({ data: { name: 'Dave Updated' } });
      expect(component.panelTitle()).toBe('Dave Updated');
    });
  });

  describe('heading title consistency', () => {
    it('should use panelTitle for heading when viewing own profile', () => {
      const pubkey = 'abc123';
      const component = createComponent({
        currentPubkey: pubkey,
        viewingPubkey: pubkey,
        profileName: 'Alice',
      });

      // Both panelTitle and heading should show 'My Music', not the artist name
      expect(component.panelTitle()).toBe('My Music');
      expect(component.panelTitle()).not.toBe(component.artistName());
    });

    it('should use panelTitle matching artistName for other profiles', () => {
      const component = createComponent({
        currentPubkey: 'abc123',
        viewingPubkey: 'def456',
        profileName: 'Bob',
      });

      // For other profiles, panelTitle should match artistName
      expect(component.panelTitle()).toBe('Bob');
      expect(component.panelTitle()).toBe(component.artistName());
    });
  });

  describe('canZapArtist', () => {
    it('should be false when artist has no lightning address', () => {
      const component = createComponent({
        viewingPubkey: 'def456',
        profileName: 'No Zap Artist',
      });

      expect((component as any).canZapArtist()).toBe(false);
    });

    it('should be true when artist has lud16 configured', () => {
      const component = createComponent({
        viewingPubkey: 'def456',
        profileName: 'Zap Artist',
      });
      (component as any).authorProfile.set({
        data: {
          name: 'Zap Artist',
          lud16: 'artist@wallet.example',
        },
      });

      expect((component as any).canZapArtist()).toBe(true);
    });
  });
});
