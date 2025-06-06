import { Injectable, computed, inject, signal } from '@angular/core';
import { Event } from 'nostr-tools';

@Injectable({
  providedIn: 'root'
})
export class AccountStateService {
  accountChanging = signal<string>('');

  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);

  // Current profile pubkey
  currentProfilePubkey = signal<string>('');

  muteList = signal<Event | undefined>(undefined);

  // nostr = inject(NostrService);

  publish = signal<Event | undefined>(undefined);

  // Computed signals for different types of mutes
  mutedAccounts = computed(() => {
    const list = this.muteList();
    if (!list || !list.tags) return [];
    return list.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
  });

  mutedTags = computed(() => {
    const list = this.muteList();
    if (!list || !list.tags) return [];
    return list.tags.filter(tag => tag[0] === 't').map(tag => tag[1]);
  });

  mutedWords = computed(() => {
    const list = this.muteList();
    if (!list || !list.tags) return [];
    return list.tags.filter(tag => tag[0] === 'word').map(tag => tag[1]);
  });

  mutedThreads = computed(() => {
    const list = this.muteList();
    if (!list || !list.tags) return [];
    return list.tags.filter(tag => tag[0] === 'e').map(tag => tag[1]);
  });

  setCurrentProfilePubkey(pubkey: string): void {
    this.currentProfilePubkey.set(pubkey);
    this.accountChanging.set(pubkey);
  }

  // Method to update mute list
  updateMuteList(muteEvent: Event): void {
    this.muteList.set(muteEvent);
  }

  muted(event: Event) {
    if (!event) {
      return;
    }

    return this.mutedAccounts().find(account => account === event.pubkey);
  }

  async mutePubkey(pubkey: string) {
    const currentMuteList = this.muteList();
    if (!currentMuteList) {
      console.warn('No mute list available to update.');
      return;
    }

    // Check if the pubkey is already muted
    if (this.mutedAccounts().includes(pubkey)) {
      console.log(`Pubkey ${pubkey} is already muted.`);
      return;
    }

    // Add the pubkey to the mute list
    currentMuteList.tags.push(['p', pubkey]);
    this.updateMuteList(currentMuteList);

    this.publish.set(currentMuteList);

    // await this.saveMuteList(currentMuteList);
  }

  // async saveMuteList(muteList: Event) {
  //   const event = await this.nostr.publish(muteList);
  //   this.updateMuteList(event);
  // }
}