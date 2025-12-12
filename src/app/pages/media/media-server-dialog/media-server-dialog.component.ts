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
  standalone: true,
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
    { name: 'Primal', url: 'https://blossom.primal.net/' },
    { name: 'F7Z', url: 'https://blossom.f7z.io/' },
  ]);

  ngOnInit(): void {
    this.isEdit = !!this.dialogData;

    this.serverForm = this.fb.group({
      url: [
        this.dialogData || '',
        [
          Validators.required,
          // Updated pattern to allow both http:// and https:// protocols
          Validators.pattern('^https?://.+'),
        ],
      ],
      name: [this.dialogData || ''],
      description: [this.dialogData || ''],
    });
  }

  selectSuggestedServer(url: string): void {
    this.serverForm.get('url')?.setValue(url);
    this.serverForm.get('url')?.markAsDirty();
  }

  async testConnection(): Promise<void> {
    const url = this.serverForm.get('url')?.value;
    if (!url) return;

    this.testing.set(true);
    this.testResult = null;

    try {
      // Add trailing slash if not present
      const normalizedUrl = url.endsWith('/') ? url : `${url}/`;

      // First try to fetch info endpoint
      const infoResponse = await fetch(`${normalizedUrl}`);

      if (infoResponse.ok) {
        this.testResult = {
          success: true,
          message: `Connected successfully!`,
        };
      } else {
        // Try a HEAD request to see if the server exists at all
        const headResponse = await fetch(normalizedUrl, { method: 'HEAD' });

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
      // const serverData: string = {
      //   url: this.serverForm.value.url,
      //   name: this.serverForm.value.name,
      //   description: this.serverForm.value.description,
      //   status: 'unknown'
      // };

      this.dialogRef.close(this.serverForm.value.url);
    }
  }
}
