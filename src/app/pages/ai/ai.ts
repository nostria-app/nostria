import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { firstValueFrom } from 'rxjs';
import { AiService } from '../../services/ai.service';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';

interface ModelInfo {
  id: string;
  task: string;
  name: string;
  description: string;
  size: string;
  loading: boolean;
  progress: number;
  loaded: boolean;
  cached: boolean;
}

@Component({
  selector: 'app-ai',
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatProgressBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    MatIconModule,
    MatTooltipModule,
    FormsModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatTabsModule
  ],
  templateUrl: './ai.html',
  styleUrl: './ai.scss'
})
export class AiComponent implements OnInit {
  private aiService = inject(AiService);
  private dialog = inject(MatDialog);

  displayedColumns: string[] = ['info', 'size', 'status', 'actions'];

  languageModels = signal<ModelInfo[]>([]);

  models = signal<ModelInfo[]>([
    {
      id: 'Xenova/distilgpt2',
      task: 'text-generation',
      name: 'DistilGPT2',
      description: 'Text Generation',
      size: '~85MB',
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
      size: '~283MB',
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
      size: '~65MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false
    },
    // {
    //   id: 'Xenova/opus-mt-en-de',
    //   task: 'translation',
    //   name: 'English to German',
    //   description: 'Translation',
    //   size: '~160MB',
    //   loading: false,
    //   progress: 0,
    //   loaded: false,
    //   cached: false
    // },
    // {
    //   id: 'Xenova/opus-mt-en-es',
    //   task: 'translation',
    //   name: 'English to Spanish',
    //   description: 'Translation',
    //   size: '~110MB',
    //   loading: false,
    //   progress: 0,
    //   loaded: false,
    //   cached: false
    // },
    // {
    //   id: 'Xenova/opus-mt-en-fr',
    //   task: 'translation',
    //   name: 'English to French',
    //   description: 'Translation',
    //   size: '~107MB',
    //   loading: false,
    //   progress: 0,
    //   loaded: false,
    //   cached: false
    // },
    {
      id: 'Xenova/whisper-tiny.en',
      task: 'automatic-speech-recognition',
      name: 'Whisper Tiny',
      description: 'Speech to Text',
      size: '~40MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false
    },
    {
      id: 'Xenova/speecht5_tts',
      task: 'text-to-speech',
      name: 'SpeechT5',
      description: 'Text to Speech',
      size: '~180MB',
      loading: false,
      progress: 0,
      loaded: false,
      cached: false
    }
  ]);

  inputText = signal(`Hi and welcome to Nostria. We're here to help you.`);
  outputText = signal('');
  selectedTranslationModel = signal('Xenova/opus-mt-en-de');

  speakers = [
    { name: 'Female', id: 'cmu_us_slt_arctic-wav-arctic_a0001', url: '/assets/embeddings/cmu_us_slt_arctic-wav-arctic_a0001.bin' },
    { name: 'Male', id: 'cmu_us_ksp_arctic-wav-arctic_a0584', url: '/assets/embeddings/cmu_us_ksp_arctic-wav-arctic_a0584.bin' },
  ];
  selectedSpeaker = signal(this.speakers[0]);
  isGenerating = signal(false);
  isSpeaking = signal(false);
  audioUrl = signal<string | null>(null);

  async ngOnInit() {
    // Populate language models
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const langs = this.aiService.availableTranslationModels.map(id => {
      const parts = id.replace('Xenova/opus-mt-', '').split('-');
      let name = id;
      if (parts.length >= 2) {
        const source = parts[parts.length - 2];
        const target = parts[parts.length - 1];
        try {
          const sourceName = displayNames.of(source) || source;
          const targetName = displayNames.of(target) || target;
          name = `${sourceName} to ${targetName}`;
        } catch {
          name = `${source} to ${target}`;
        }
      }

      return {
        id: id,
        task: 'translation',
        name: name,
        description: 'Translation',
        size: '~80MB',
        loading: false,
        progress: 0,
        loaded: false,
        cached: false
      };
    });

    // Sort by name
    langs.sort((a, b) => a.name.localeCompare(b.name));
    this.languageModels.set(langs);

    // Check cache status for all models
    for (const model of this.models()) {
      const status = await this.aiService.checkModel(model.task, model.id);
      this.updateModelStatus(model.id, { loaded: status.loaded, cached: status.cached });
    }

    // Check cache status for language models (in parallel to avoid blocking too long)
    // Or maybe just check them one by one but don't await the whole loop?
    // Let's do it one by one for now to avoid overwhelming the worker if it's single threaded for checks.
    for (const model of this.languageModels()) {
      // We can fire and forget or await. Awaiting might be slow if there are many.
      // But checkModel is fast if it just checks cache/loaded map.
      this.aiService.checkModel(model.task, model.id).then(status => {
        this.updateModelStatus(model.id, { loaded: status.loaded, cached: status.cached });
      });
    }
  }

  updateModelStatus(id: string, updates: Partial<ModelInfo>) {
    this.models.update(models =>
      models.map(m => m.id === id ? { ...m, ...updates } : m)
    );
    this.languageModels.update(models =>
      models.map(m => m.id === id ? { ...m, ...updates } : m)
    );
  }

  async loadModel(model: ModelInfo) {
    this.updateModelStatus(model.id, { loading: true, progress: 0 });
    try {
      await this.aiService.loadModel(model.task, model.id, (data: unknown) => {
        const progressData = data as { status: string, progress: number };
        if (progressData.status === 'progress') {
          this.updateModelStatus(model.id, { progress: progressData.progress });
        }
      });
      this.updateModelStatus(model.id, { loaded: true, cached: true });
    } catch (err) {
      console.error(err);
    } finally {
      this.updateModelStatus(model.id, { loading: false });
    }
  }

  async downloadAll() {
    for (const model of this.models()) {
      if (!model.loaded && !model.cached) {
        await this.loadModel(model);
      }
    }
  }

  async deleteModel(model: ModelInfo) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Model',
        message: `Are you sure you want to delete the cached files for ${model.name}?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn'
      }
    });

    const confirmed = await firstValueFrom(dialogRef.afterClosed());

    if (confirmed) {
      await this.aiService.deleteModelFromCache(model.id);
      this.updateModelStatus(model.id, { loaded: false, cached: false });
    }
  }

  async clearAllCache() {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Wipe All Cache',
        message: 'Are you sure you want to delete ALL cached AI models? This cannot be undone.',
        confirmText: 'Wipe All',
        cancelText: 'Cancel',
        confirmColor: 'warn'
      }
    });

    const confirmed = await firstValueFrom(dialogRef.afterClosed());

    if (confirmed) {
      await this.aiService.clearAllCache();
      this.models.update(models => models.map(m => ({ ...m, loaded: false, cached: false })));
    }
  }

  async generate() {
    if (this.inputText().trim() === '') return;
    this.isGenerating.set(true);
    try {
      const result = await this.aiService.generateText(this.inputText(), {
        max_new_tokens: 100,
        temperature: 0.7,
        do_sample: true,
        return_full_text: false
      }) as { generated_text: string }[];
      console.log('Generate result:', result);
      if (Array.isArray(result) && result.length > 0 && result[0].generated_text) {
        this.outputText.set(result[0].generated_text.trim());
      } else {
        this.outputText.set(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error('Generate error:', err);
      this.outputText.set('Error: ' + err);
    } finally {
      this.isGenerating.set(false);
    }
  }

  async summarize() {
    if (!this.inputText()) return;
    this.isGenerating.set(true);
    try {
      const result = await this.aiService.summarizeText(this.inputText()) as { summary_text: string }[];
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
      const result = await this.aiService.analyzeSentiment(this.inputText()) as { label: string, score: number }[];
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
      const result = await this.aiService.translateText(this.inputText(), this.selectedTranslationModel()) as { translation_text: string }[];
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

  async speak() {
    if (this.inputText().trim() === '') return;
    this.isSpeaking.set(true);

    try {
      const model = 'Xenova/speecht5_tts';
      const status = await this.aiService.checkModel('text-to-speech', model);
      if (!status.loaded) {
        await this.aiService.loadModel('text-to-speech', model);
      }

      const result = await this.aiService.synthesizeSpeech(this.inputText(), {
        speaker_embeddings: this.selectedSpeaker().url
      }) as { blob: Blob, sampling_rate: number };

      if (result && result.blob) {
        this.playAudio(result.blob);
      }
    } catch (err) {
      console.error('Speech error', err);
    } finally {
      this.isSpeaking.set(false);
    }
  }

  playAudio(blob: Blob) {
    const url = URL.createObjectURL(blob);
    this.audioUrl.set(url);
  }

  isModelLoaded(id: string) {
    return this.models().find(m => m.id === id)?.loaded;
  }
}
