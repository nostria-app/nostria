import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';

@Component({
  selector: 'app-ai',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatProgressBarModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule
  ],
  templateUrl: './ai.html',
  styleUrl: './ai.scss'
})
export class AiComponent {
  private aiService = inject(AiService);

  textModel = 'Xenova/distilgpt2';
  translationModel = 'Xenova/opus-mt-en-de'; // Default to En-De for demo

  textModelLoading = signal(false);
  translationModelLoading = signal(false);

  textModelProgress = signal(0);
  translationModelProgress = signal(0);

  inputText = signal('');
  outputText = signal('');

  isGenerating = signal(false);

  get textModelLoaded() { return this.aiService.textModelLoaded; }
  get translationModelLoaded() { return this.aiService.translationModelLoaded; }

  async loadTextModel() {
    this.textModelLoading.set(true);
    this.textModelProgress.set(0);
    try {
      await this.aiService.loadModel('text-generation', this.textModel, (data: any) => {
        if (data.status === 'progress') {
          this.textModelProgress.set(data.progress);
        }
      });
    } catch (err) {
      console.error(err);
    } finally {
      this.textModelLoading.set(false);
    }
  }

  async loadTranslationModel() {
    this.translationModelLoading.set(true);
    this.translationModelProgress.set(0);
    try {
      await this.aiService.loadModel('translation', this.translationModel, (data: any) => {
        if (data.status === 'progress') {
          this.translationModelProgress.set(data.progress);
        }
      });
    } catch (err) {
      console.error(err);
    } finally {
      this.translationModelLoading.set(false);
    }
  }

  async generate() {
    if (!this.inputText()) return;
    this.isGenerating.set(true);
    try {
      const result: any = await this.aiService.generateText(this.inputText());
      // Result is usually array of objects
      if (Array.isArray(result) && result.length > 0 && result[0].generated_text) {
        this.outputText.set(result[0].generated_text);
      } else {
        this.outputText.set(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error(err);
      this.outputText.set('Error: ' + err);
    } finally {
      this.isGenerating.set(false);
    }
  }

  async translate() {
    if (!this.inputText()) return;
    this.isGenerating.set(true);
    try {
      const result: any = await this.aiService.translateText(this.inputText());
      if (Array.isArray(result) && result.length > 0 && result[0].translation_text) {
        this.outputText.set(result[0].translation_text);
      } else {
        this.outputText.set(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error(err);
      this.outputText.set('Error: ' + err);
    } finally {
      this.isGenerating.set(false);
    }
  }
}
