import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../../services/ai.service';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatIconModule } from '@angular/material/icon';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';

export interface TranslateDialogData {
  content: string;
}

@Component({
  selector: 'app-translate-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    FormsModule,
    MatProgressBarModule,
    MatIconModule
  ],
  templateUrl: './translate-dialog.component.html',
  styleUrls: ['./translate-dialog.component.scss'],
})
export class TranslateDialogComponent {
  private dialogRef = inject(MatDialogRef<TranslateDialogComponent>);
  private accountLocalState = inject(AccountLocalStateService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  data: TranslateDialogData = inject(MAT_DIALOG_DATA);
  ai = inject(AiService);

  sourceLang = signal('en');
  targetLang = signal('es');
  translatedText = signal('');
  isTranslating = signal(false);
  error = signal('');

  availableLanguages = computed(() => {
    const models = this.ai.availableTranslationModels;
    const languages = new Set<string>();

    models.forEach(model => {
      const parts = model.replace('Xenova/opus-mt-', '').split('-');
      if (parts.length >= 2) {
        parts.forEach(p => {
          if (p.length >= 2 && p.length <= 3 && p !== 'mul' && p !== 'gem' && p !== 'gmw' && p !== 'big' && p !== 'tc') {
            languages.add(p);
          }
        });
      }
    });

    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });

    return Array.from(languages)
      .map(code => {
        try {
          return { code, name: displayNames.of(code) || code };
        } catch {
          return { code, name: code };
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  constructor() {
    // Load saved translation preferences and validate against available languages
    const pubkey = this.accountState.pubkey();
    const savedSourceLang = pubkey ? this.accountLocalState.getTranslationSourceLang(pubkey) : undefined;
    const savedTargetLang = pubkey ? this.accountLocalState.getTranslationTargetLang(pubkey) : undefined;
    const availableCodes = this.availableLanguages().map(lang => lang.code);

    if (savedSourceLang && availableCodes.includes(savedSourceLang)) {
      this.sourceLang.set(savedSourceLang);
    }
    if (savedTargetLang && availableCodes.includes(savedTargetLang)) {
      this.targetLang.set(savedTargetLang);
    }
  }

  setSourceLang(lang: string): void {
    this.sourceLang.set(lang);
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setTranslationSourceLang(pubkey, lang);
    }
  }

  setTargetLang(lang: string): void {
    this.targetLang.set(lang);
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setTranslationTargetLang(pubkey, lang);
    }
  }

  swapLanguages(): void {
    const temp = this.sourceLang();
    this.setSourceLang(this.targetLang());
    this.setTargetLang(temp);
  }

  async translate() {
    this.isTranslating.set(true);
    this.error.set('');
    this.translatedText.set('');

    try {
      const model = this.ai.getTranslationModel(this.sourceLang(), this.targetLang());

      if (!model) {
        this.error.set(`No translation model found for ${this.sourceLang()} to ${this.targetLang()}`);
        this.isTranslating.set(false);
        return;
      }

      // Ensure model is loaded
      // We might need to handle model loading progress here or in AI service
      // For now, let's assume AI service handles it or we trigger it.
      // The original code called ensureModelLoaded.

      // We can call translateText directly, it might fail if not loaded?
      // ai.worker.ts throws if not loaded.

      // We should check if loaded.
      const isLoaded = this.ai.isModelLoaded(model);
      if (!isLoaded) {
        // Trigger load?
        // ai.service.ts has loadModel.
        // But translateText doesn't seem to auto-load.
        // We should probably try to load it.
        await this.ai.loadModel('translation', model, (data: unknown) => {
          // Handle progress if needed
        });
      }

      const result = await this.ai.translateText(this.data.content, model);

      // Handle result format
      if (Array.isArray(result) && result.length > 0) {
        const firstItem = result[0];
        if (typeof firstItem === 'object' && firstItem !== null && 'translation_text' in firstItem) {
          this.translatedText.set((firstItem as { translation_text: string }).translation_text);
        } else {
          this.translatedText.set(JSON.stringify(result));
        }
      } else if (typeof result === 'string') {
        this.translatedText.set(result);
      } else {
        this.translatedText.set(JSON.stringify(result));
      }

    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      this.isTranslating.set(false);
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
