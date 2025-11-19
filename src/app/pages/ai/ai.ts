import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../services/ai.service';

interface ModelInfo {
  id: string;
  task: string;
  name: string;
  description: string;
  loading: boolean;
  progress: number;
  loaded: boolean;
  cached: boolean;
}

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
    MatSelectModule,
    FormsModule
  ],
  templateUrl: './ai.html',
  styleUrl: './ai.scss'
})
export class AiComponent implements OnInit {
  private aiService = inject(AiService);

  models = signal<ModelInfo[]>([
    {
      id: 'Xenova/distilgpt2',
      task: 'text-generation',
      name: 'DistilGPT2',
      description: 'Text Generation',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false
    },
    {
      id: 'Xenova/distilbart-cnn-6-6',
      task: 'summarization',
      name: 'DistilBART CNN',
      description: 'Summarization',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false
    },
    {
      id: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      task: 'sentiment-analysis',
      name: 'DistilBERT Sentiment',
      description: 'Sentiment Analysis',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false
    },
    {
      id: 'Xenova/opus-mt-en-de',
      task: 'translation',
      name: 'English to German',
      description: 'Translation',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false
    },
    {
      id: 'Xenova/opus-mt-en-es',
      task: 'translation',
      name: 'English to Spanish',
      description: 'Translation',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false
    },
    {
      id: 'Xenova/opus-mt-en-fr',
      task: 'translation',
      name: 'English to French',
      description: 'Translation',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false
    }
  ]);

  inputText = signal('');
  outputText = signal('');
  selectedTranslationModel = signal('Xenova/opus-mt-en-de');

  isGenerating = signal(false);

  async ngOnInit() {
    // Check cache status for all models
    for (const model of this.models()) {
      const status = await this.aiService.checkModel(model.task, model.id);
      this.updateModelStatus(model.id, { loaded: status.loaded, cached: status.cached });
    }
  }

  updateModelStatus(id: string, updates: Partial<ModelInfo>) {
    this.models.update(models =>
      models.map(m => m.id === id ? { ...m, ...updates } : m)
    );
  }

  async loadModel(model: ModelInfo) {
    this.updateModelStatus(model.id, { loading: true, progress: 0 });
    try {
      await this.aiService.loadModel(model.task, model.id, (data: any) => {
        if (data.status === 'progress') {
          this.updateModelStatus(model.id, { progress: data.progress });
        }
      });
      this.updateModelStatus(model.id, { loaded: true, cached: true });
    } catch (err) {
      console.error(err);
    } finally {
      this.updateModelStatus(model.id, { loading: false });
    }
  }

  async generate() {
    if (!this.inputText()) return;
    this.isGenerating.set(true);
    try {
      const result: any = await this.aiService.generateText(this.inputText());
      if (Array.isArray(result) && result.length > 0 && result[0].generated_text) {
        this.outputText.set(result[0].generated_text);
      } else {
        this.outputText.set(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      this.outputText.set('Error: ' + err);
    } finally {
      this.isGenerating.set(false);
    }
  }

  async summarize() {
    if (!this.inputText()) return;
    this.isGenerating.set(true);
    try {
      const result: any = await this.aiService.summarizeText(this.inputText());
      if (Array.isArray(result) && result.length > 0 && result[0].summary_text) {
        this.outputText.set(result[0].summary_text);
      } else {
        this.outputText.set(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      this.outputText.set('Error: ' + err);
    } finally {
      this.isGenerating.set(false);
    }
  }

  async analyzeSentiment() {
    if (!this.inputText()) return;
    this.isGenerating.set(true);
    try {
      const result: any = await this.aiService.analyzeSentiment(this.inputText());
      // Result is usually [{ label: 'POSITIVE', score: 0.99 }]
      if (Array.isArray(result) && result.length > 0) {
        this.outputText.set(JSON.stringify(result, null, 2));
      } else {
        this.outputText.set(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      this.outputText.set('Error: ' + err);
    } finally {
      this.isGenerating.set(false);
    }
  }

  async translate() {
    if (!this.inputText()) return;
    this.isGenerating.set(true);
    try {
      const result: any = await this.aiService.translateText(this.inputText(), this.selectedTranslationModel());
      if (Array.isArray(result) && result.length > 0 && result[0].translation_text) {
        this.outputText.set(result[0].translation_text);
      } else {
        this.outputText.set(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      this.outputText.set('Error: ' + err);
    } finally {
      this.isGenerating.set(false);
    }
  }

  isModelLoaded(id: string) {
    return this.models().find(m => m.id === id)?.loaded;
  }
}
