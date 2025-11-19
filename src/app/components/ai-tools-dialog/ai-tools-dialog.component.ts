import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';

export interface AiToolsDialogData {
  content: string;
}

@Component({
  selector: 'app-ai-tools-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatProgressBarModule,
    FormsModule
  ],
  template: `
    <h2 mat-dialog-title>AI Tools</h2>
    <mat-dialog-content>
      <div class="tools-container">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Action</mat-label>
          <mat-select [ngModel]="selectedAction()" (ngModelChange)="selectedAction.set($event)">
            <mat-option value="generate">Generate Text</mat-option>
            <mat-option value="translate">Translate (En->De)</mat-option>
          </mat-select>
        </mat-form-field>

        @if (selectedAction() === 'generate') {
            <p>Generates text based on the current content as prompt.</p>
            @if (!aiService.textModelLoaded()) {
                <button mat-stroked-button (click)="loadTextModel()" [disabled]="aiService.textModelLoaded()">
                    {{ aiService.textModelLoaded() ? 'Model Loaded' : 'Load Model' }}
                </button>
            }
        }

        @if (selectedAction() === 'translate') {
            <p>Translates the current content to German.</p>
             @if (!aiService.translationModelLoaded()) {
                <button mat-stroked-button (click)="loadTranslationModel()" [disabled]="aiService.translationModelLoaded()">
                    {{ aiService.translationModelLoaded() ? 'Model Loaded' : 'Load Model' }}
                </button>
            }
        }

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Content</mat-label>
          <textarea matInput [ngModel]="content()" (ngModelChange)="content.set($event)" rows="6"></textarea>
        </mat-form-field>

        @if (isProcessing()) {
            <mat-progress-bar mode="indeterminate"></mat-progress-bar>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="process()" [disabled]="isProcessing() || !canProcess()">
        Process
      </button>
      <button mat-button [mat-dialog-close]="content()" [disabled]="isProcessing()">
        Use Result
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .tools-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 400px;
    }
    .full-width {
      width: 100%;
    }
  `]
})
export class AiToolsDialogComponent {
  readonly dialogRef = inject(MatDialogRef<AiToolsDialogComponent>);
  readonly data = inject<AiToolsDialogData>(MAT_DIALOG_DATA);
  readonly aiService = inject(AiService);

  content = signal(this.data.content);
  selectedAction = signal<'generate' | 'translate'>('generate');
  isProcessing = signal(false);

  async loadTextModel() {
    await this.aiService.loadModel('text-generation', 'Xenova/distilgpt2');
  }

  async loadTranslationModel() {
    await this.aiService.loadModel('translation', 'Xenova/opus-mt-en-de');
  }

  canProcess() {
    if (this.selectedAction() === 'generate') return this.aiService.textModelLoaded();
    if (this.selectedAction() === 'translate') return this.aiService.translationModelLoaded();
    return false;
  }

  async process() {
    this.isProcessing.set(true);
    try {
      let result: any;
      if (this.selectedAction() === 'generate') {
        result = await this.aiService.generateText(this.content());
        if (Array.isArray(result) && result.length > 0 && result[0].generated_text) {
          this.content.set(result[0].generated_text);
        }
      } else {
        result = await this.aiService.translateText(this.content());
        if (Array.isArray(result) && result.length > 0 && result[0].translation_text) {
          this.content.set(result[0].translation_text);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      this.isProcessing.set(false);
    }
  }
}
