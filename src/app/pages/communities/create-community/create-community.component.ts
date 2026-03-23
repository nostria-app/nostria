import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommunityService } from '../../../services/community.service';
import { ApplicationService } from '../../../services/application.service';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-create-community',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    FormsModule,
    RouterLink,
  ],
  templateUrl: './create-community.component.html',
  styleUrls: ['./create-community.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateCommunityComponent {
  private communityService = inject(CommunityService);
  private app = inject(ApplicationService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private readonly logger = inject(LoggerService);

  name = signal('');
  description = signal('');
  image = signal('');
  rules = signal('');
  isPublishing = signal(false);

  async createCommunity(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.snackBar.open('Community name is required', 'Close', { duration: 3000 });
      return;
    }

    // Generate a URL-safe d-tag from the name
    const dTag = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 64);

    if (!dTag) {
      this.snackBar.open('Invalid community name', 'Close', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);

    try {
      const result = await this.communityService.publishCommunity({
        dTag,
        name,
        description: this.description().trim() || undefined,
        image: this.image().trim() || undefined,
        rules: this.rules().trim() || undefined,
      });

      if (result.success && result.event) {
        this.snackBar.open('Community created!', 'Close', { duration: 3000 });
        // Navigate to the new community
        const coordinate = `34550:${result.event.pubkey}:${dTag}`;
        this.router.navigate(['/communities', encodeURIComponent(coordinate)]);
      } else {
        this.snackBar.open(result.error || 'Failed to create community', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[CreateCommunity] Error creating community:', error);
      this.snackBar.open('Error creating community', 'Close', { duration: 3000 });
    } finally {
      this.isPublishing.set(false);
    }
  }
}
