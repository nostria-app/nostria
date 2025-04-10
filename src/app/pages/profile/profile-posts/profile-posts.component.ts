import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-profile-posts',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule
  ],
  templateUrl: './profile-posts.component.html',
  styleUrl: './profile-posts.component.scss'
})
export class ProfilePostsComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  // We'll get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }
}
