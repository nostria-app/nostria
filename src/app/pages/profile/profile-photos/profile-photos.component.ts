import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-profile-photos',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule
  ],
  templateUrl: './profile-photos.component.html',
  styleUrl: './profile-photos.component.scss'
})
export class ProfilePhotosComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }
}
