import { Injectable, signal } from '@angular/core';
import { NostrEvent } from '../interfaces';
import { NostrEventData } from './storage.service';

@Injectable({
  providedIn: 'root'
})
export class AccountStateService {
  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);
  
  // Current profile pubkey
  currentProfilePubkey = signal<string>('');

  muteList = signal<NostrEvent | undefined>(undefined);
  
  constructor() { }
  
  // setFollowingList(list: string[]): void {
  //   this.followingList.set(list);
  // }
  
  setCurrentProfilePubkey(pubkey: string): void {
    this.currentProfilePubkey.set(pubkey);
  }
}