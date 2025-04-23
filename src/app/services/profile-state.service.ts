import { Injectable, signal } from '@angular/core';
import { NostrEvent } from '../interfaces';
import { inject } from '@angular/core';
import { NotificationService } from './notification.service';
import { NotificationType } from './storage.service';

@Injectable({
  providedIn: 'root'
})
export class ProfileStateService {
  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);
  
  // Current profile pubkey
  currentProfilePubkey = signal<string>('');
  
  private notificationService = inject(NotificationService);
  
  constructor() { }
  
  // setFollowingList(list: string[]): void {
  //   this.followingList.set(list);
  // }
  
  setCurrentProfilePubkey(pubkey: string): void {
    this.currentProfilePubkey.set(pubkey);
    
    // Notify when a profile is loaded (example usage of notification service)
    if (pubkey) {
      this.notificationService.notify(
        'Profile Loaded',
        `Successfully loaded profile information for ${pubkey.substring(0, 8)}...`,
        NotificationType.SUCCESS
      );
    }
  }
}