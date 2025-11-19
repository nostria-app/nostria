import { Component, inject, signal, computed } from '@angular/core';
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
  initialAction?: 'generate' | 'translate' | 'sentiment';
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
            <mat-option value="generate" disabled>Generate Text (Temporarily Disabled)</mat-option>
            <mat-option value="translate">Translate</mat-option>
            <mat-option value="sentiment">Sentiment Analysis</mat-option>
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
            <p>Translates the current content.</p>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Target Language</mat-label>
              <mat-select [ngModel]="selectedTranslationModel()" (ngModelChange)="selectedTranslationModel.set($event)">
                <mat-option value="Xenova/opus-mt-en-de">German (De)</mat-option>
                <mat-option value="Xenova/opus-mt-en-es">Spanish (Es)</mat-option>
                <mat-option value="Xenova/opus-mt-en-fr">French (Fr)</mat-option>
              </mat-select>
            </mat-form-field>

             @if (!aiService.isModelLoaded(selectedTranslationModel())) {
                <button mat-stroked-button (click)="loadTranslationModel()" [disabled]="aiService.isModelLoaded(selectedTranslationModel())">
                    {{ aiService.isModelLoaded(selectedTranslationModel()) ? 'Model Loaded' : 'Load Model' }}
                </button>
            }
        }

        @if (selectedAction() === 'sentiment') {
            <p>Analyzes the sentiment of the content.</p>
             @if (!aiService.sentimentModelLoaded()) {
                <button mat-stroked-button (click)="loadSentimentModel()" [disabled]="aiService.sentimentModelLoaded()">
                    {{ aiService.sentimentModelLoaded() ? 'Model Loaded' : 'Load Model' }}
                </button>
            }

            @if (sentimentResult()) {
              <div class="sentiment-result">
                <mat-icon [class]="sentimentResult()?.label === 'POSITIVE' ? 'positive' : 'negative'">
                  {{ sentimentIcon() }}
                </mat-icon>
                <span>{{ sentimentResult()?.label }} ({{ sentimentResult()?.score | percent:'1.0-2' }})</span>
              </div>
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
      padding-top: 8px;
    }
    .full-width {
      width: 100%;
    }
    .sentiment-result {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.2em;
      font-weight: bold;
      padding: 16px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 8px;
    }
    .positive { color: var(--mat-success-color, #4caf50); }
    .negative { color: var(--mat-sys-error, #f44336); }
  `]
})
export class AiToolsDialogComponent {
  readonly dialogRef = inject(MatDialogRef<AiToolsDialogComponent>);
  readonly data = inject<AiToolsDialogData>(MAT_DIALOG_DATA);
  readonly aiService = inject(AiService);

  content = signal(this.data.content);
  selectedAction = signal<'generate' | 'translate' | 'sentiment'>(this.data.initialAction || 'generate');
  selectedTranslationModel = signal<string>('Xenova/opus-mt-en-de');
  isProcessing = signal(false);
  sentimentResult = signal<{ label: string, score: number } | null>(null);

  sentimentIcon = computed(() => {
    const result = this.sentimentResult();
    if (!result) return '';

    if (result.label === 'POSITIVE') {
      return result.score > 0.9 ? 'sentiment_very_satisfied' : 'sentiment_satisfied';
    } else {
      return result.score > 0.9 ? 'sentiment_very_dissatisfied' : 'sentiment_dissatisfied';
    }
  });

  async loadTextModel() {
    await this.aiService.loadModel('text-generation', 'Xenova/distilgpt2');
  }

  async loadTranslationModel() {
    await this.aiService.loadModel('translation', this.selectedTranslationModel());
  }

  async loadSentimentModel() {
    await this.aiService.loadModel('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
  }

  canProcess() {
    if (this.selectedAction() === 'generate') return this.aiService.textModelLoaded();
    if (this.selectedAction() === 'translate') return this.aiService.isModelLoaded(this.selectedTranslationModel());
    if (this.selectedAction() === 'sentiment') return this.aiService.sentimentModelLoaded();
    return false;
  }

  async process() {
    this.isProcessing.set(true);
    this.sentimentResult.set(null);
    try {
      let result: unknown;
      if (this.selectedAction() === 'generate') {
        result = await this.aiService.generateText(this.content());
        const typedResult = result as { generated_text: string }[];
        if (Array.isArray(typedResult) && typedResult.length > 0 && typedResult[0].generated_text) {
          this.content.set(typedResult[0].generated_text);
        }
      } else if (this.selectedAction() === 'translate') {
        result = await this.aiService.translateText(this.content(), this.selectedTranslationModel());
        const typedResult = result as { translation_text: string }[];
        if (Array.isArray(typedResult) && typedResult.length > 0 && typedResult[0].translation_text) {
          this.content.set(typedResult[0].translation_text);
        }
      } else if (this.selectedAction() === 'sentiment') {
        result = await this.aiService.analyzeSentiment(this.content());
        const typedResult = result as { label: string, score: number }[];
        if (Array.isArray(typedResult) && typedResult.length > 0) {
          this.sentimentResult.set(typedResult[0]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      this.isProcessing.set(false);
    }
  }
}
