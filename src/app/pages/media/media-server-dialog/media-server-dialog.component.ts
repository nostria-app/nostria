import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';

import { MediaServer } from '../../../services/media.service';

@Component({
  selector: 'app-media-server-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
    MatChipsModule
  ],
  templateUrl: './media-server-dialog.component.html',
  styleUrls: ['./media-server-dialog.component.scss']
})
export class MediaServerDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<MediaServerDialogComponent>);
  private dialogData: MediaServer | undefined = inject(MAT_DIALOG_DATA, { optional: true });
  
  serverForm!: FormGroup;
  isEdit = false;
  testing = signal(false);
  testResult: { success: boolean, message: string } | null = null;
  
  suggestedServers = signal<string[]>([
    'https://blossom.band/',
    'https://blossom.primal.net/',
    'https://blossom.f7z.io/'
  ]);
  
  ngOnInit(): void {
    this.isEdit = !!this.dialogData;
    
    this.serverForm = this.fb.group({
      url: [this.dialogData?.url || '', [
        Validators.required,
        Validators.pattern('^https://.+')
      ]],
      name: [this.dialogData?.name || ''],
      description: [this.dialogData?.description || '']
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
          message: `Connected successfully!}`
        };
      } else {
        // Try a HEAD request to see if the server exists at all
        const headResponse = await fetch(normalizedUrl, { method: 'HEAD' });
        
        if (headResponse.ok) {
          this.testResult = {
            success: true,
            message: 'Server exists but info endpoint not available. Limited functionality.'
          };
        } else {
          this.testResult = {
            success: false,
            message: `Failed to connect: ${headResponse.status} ${headResponse.statusText}`
          };
        }
      }
    } catch (error) {
      this.testResult = {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : String(error)}`
      };
    } finally {
      this.testing.set(false);
    }
  }
  
  onSubmit(): void {
    if (this.serverForm.valid) {
      const serverData: MediaServer = {
        url: this.serverForm.value.url,
        name: this.serverForm.value.name,
        description: this.serverForm.value.description,
        status: 'unknown'
      };
      
      this.dialogRef.close(serverData);
    }
  }
}
