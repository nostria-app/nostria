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
}