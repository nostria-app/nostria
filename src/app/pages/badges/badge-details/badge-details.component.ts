import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

interface Badge {
  id: string;
  name: string;
  description: string;
  image: string;
  thumbnail?: string;
  slug: string;
  tags?: string[];
  creator: string;
  created: number; // Unix timestamp
}

@Component({
  selector: 'app-badge-details',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    MatDialogModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './badge-details.component.html',
  styleUrl: './badge-details.component.scss'
})
export class BadgeDetailsComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  
  badge = signal<Badge | null>(null);
  isCreator = signal(false);
  loading = signal(true);
  error = signal<string | null>(null);
  
  // For badge rewarding
  issuingBadge = signal(false);
  recipientPubkeys = new FormControl('');

  // Store the tab index from the query parameter
  returnTabIndex = signal<number | null>(null);

  constructor() {
    // Get the tab index from query parameters
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    if (tabParam) {
      this.returnTabIndex.set(parseInt(tabParam, 10));
    }

    effect(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (!id) {
        this.error.set('No badge ID provided');
        this.loading.set(false);
        return;
      }
      
      this.fetchBadge(id);
    });
  }
  
  private fetchBadge(id: string): void {
    // In a real app, this would fetch from a service
    // For now, we'll use mock data
    setTimeout(() => {
      const mockBadge: Badge = {
        id: id,
        name: 'Verified Developer',
        description: 'Awarded to verified developers who contribute to open source projects',
        image: 'https://placehold.co/1024x1024',
        thumbnail: 'https://placehold.co/300x300',
        slug: 'verified-developer',
        tags: ['developer', 'verified', 'contributor'],
        creator: 'npub1xxxxxxxxxx', // This would be the actual creator's pubkey
        created: Date.now() - 3000000
      };
      
      this.badge.set(mockBadge);
      
      // For demo purposes, we'll simulate that the user is the creator
      this.isCreator.set(true);
      
      this.loading.set(false);
    }, 500); // Simulate network delay
  }
  
  editBadge(): void {
    if (this.badge()) {
      this.router.navigate(['/badges/edit', this.badge()?.id]);
    }
  }
  
  toggleIssueBadge(): void {
    this.issuingBadge.update(value => !value);
  }
  
  publishBadgeReward(): void {
    const recipients = this.recipientPubkeys.value;
    if (!recipients || !recipients.trim()) {
      this.snackBar.open('Please enter at least one recipient', 'Close', { duration: 3000 });
      return;
    }
    
    // In a real app, this would publish the badge award to a Nostr relay
    const pubkeys = recipients.split(/[\s,]+/).filter(key => key.trim() !== '');
    
    console.log('Issuing badge to:', pubkeys);
    this.snackBar.open(`Badge awarded to ${pubkeys.length} recipients`, 'Close', { duration: 3000 });
    
    // Reset form
    this.recipientPubkeys.reset();
    this.issuingBadge.set(false);
  }
  
  goBack(): void {
    // Return to the badges page with the stored tab index
    if (this.returnTabIndex() !== null) {
      this.router.navigate(['/badges'], {
        queryParams: { tab: this.returnTabIndex() }
      });
    } else {
      this.router.navigate(['/badges']);
    }
  }
}