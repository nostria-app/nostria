import { Component, inject, OnInit, signal } from '@angular/core';

import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';

@Component({
  selector: 'app-media-server-dialog',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
    MatChipsModule,
  ],
  templateUrl: './media-server-dialog.component.html',
  styleUrls: ['./media-server-dialog.component.scss'],
})
export class MediaServerDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<MediaServerDialogComponent>);
  private dialogData: string | undefined = inject(MAT_DIALOG_DATA, {
    optional: true,
  });

  serverForm!: FormGroup;
  isEdit = false;
  testing = signal(false);
  testResult: { success: boolean; message: string } | null = null;

  suggestedServers = signal<{ name: string; url: string }[]>([
    { name: 'Nostria (Europe)', url: 'https://mibo.eu.nostria.app/' },
    { name: 'Nostria (USA)', url: 'https://mibo.us.nostria.app/' },
    // { name: 'Nostria (Africa)', url: 'https://mibo.af.nostria.app/' },
    { name: 'Blossom Band', url: 'https://blossom.band/' },
    { name: 'F7Z', url: 'https://blossom.f7z.io/' },
  ]);

  ngOnInit(): void {
    this.isEdit = !!this.dialogData;

    this.serverForm = this.fb.group({
      url: [
        this.dialogData || '',
        [Validators.required],
      ],
      name: [this.dialogData || ''],
      description: [this.dialogData || ''],
    });
  }

  /**
   * Normalizes a media server URL:
   * - Auto-prefixes with https:// if no protocol is provided
   * - Ensures trailing slash for root URLs
   */
  normalizeUrl(url: string): string {
    if (!url) return url;

    let normalized = url.trim();

    // Auto-prefix with https:// if no protocol
    if (!normalized.match(/^https?:\/\//i)) {
      normalized = `https://${normalized}`;
    }

    // Ensure trailing slash if it's a root URL (no path after domain)
    try {
      const urlObj = new URL(normalized);
      if (urlObj.pathname === '' || urlObj.pathname === '/') {
        urlObj.pathname = '/';
        normalized = urlObj.toString();
      }
    } catch {
      // If URL parsing fails, just ensure trailing slash
      if (!normalized.endsWith('/')) {
        normalized = `${normalized}/`;
      }
    }

    return normalized;
  }

  /**
   * Called on blur to normalize the URL input
   */
  onUrlBlur(): void {
    const urlControl = this.serverForm.get('url');
    if (urlControl?.value) {
      const normalized = this.normalizeUrl(urlControl.value);
      urlControl.setValue(normalized, { emitEvent: false });
    }
  }

  selectSuggestedServer(url: string): void {
    this.serverForm.get('url')?.setValue(this.normalizeUrl(url));
    this.serverForm.get('url')?.markAsDirty();
  }

  async testConnection(): Promise<void> {
    let url = this.serverForm.get('url')?.value;
    if (!url) return;

    // Normalize the URL before testing
    url = this.normalizeUrl(url);
    this.serverForm.get('url')?.setValue(url, { emitEvent: false });

    this.testing.set(true);
    this.testResult = null;

    try {
      // First try to fetch info endpoint
      const infoResponse = await fetch(url);

      if (infoResponse.ok) {
        this.testResult = {
          success: true,
          message: `Connected successfully!`,
        };
      } else {
        // Try a HEAD request to see if the server exists at all
        const headResponse = await fetch(url, { method: 'HEAD' });

        if (headResponse.ok) {
          this.testResult = {
            success: true,
            message: 'Server exists but info endpoint not available. Limited functionality.',
          };
        } else {
          this.testResult = {
            success: false,
            message: `Failed to connect: ${headResponse.status} ${headResponse.statusText}`,
          };
        }
      }
    } catch (error) {
      this.testResult = {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      this.testing.set(false);
    }
  }

  onSubmit(): void {
    if (this.serverForm.valid) {
      const normalizedUrl = this.normalizeUrl(this.serverForm.value.url);
      this.dialogRef.close(normalizedUrl);
    }
  }
}
