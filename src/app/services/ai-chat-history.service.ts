import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { AiImageProvider } from './ai.service';
import { DatabaseService, StoredAiChatHistoryEntry } from './database.service';
import { LoggerService } from './logger.service';
import { LocalStorageService } from './local-storage.service';

export interface AiHistoryGeneratedImage {
  id: string;
  provider: AiImageProvider;
  providerLabel: string;
  model: string;
  prompt: string;
  revisedPrompt?: string;
  cacheKey?: string;
  mimeType?: string;
}

export interface AiHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  generatedImages?: AiHistoryGeneratedImage[];
}

export interface AiChatHistoryEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  modelId: string;
  modelName: string;
  messages: AiHistoryMessage[];
}

@Injectable({
  providedIn: 'root',
})
export class AiChatHistoryService {
  private readonly accountState = inject(AccountStateService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);
  private readonly storage = inject(LocalStorageService);
  private readonly storageKey = 'nostria-ai-chat-history';
  private readonly maxHistoryEntries = 30;

  private readonly _histories = signal<AiChatHistoryEntry[]>([]);
  readonly histories = computed(() => this._histories());

  constructor() {
    effect(() => {
      const accountPubkey = this.accountState.account()?.pubkey ?? null;
      void this.refreshHistory(accountPubkey);
    });
  }

  getHistory(id: string): AiChatHistoryEntry | undefined {
    return this._histories().find(entry => entry.id === id);
  }

  saveConversation(input: {
    id?: string | null;
    modelId: string;
    modelName: string;
    messages: AiHistoryMessage[];
  }): string {
    const trimmedMessages = input.messages.filter(message => {
      if (message.content.trim().length > 0) {
        return true;
      }

      return (message.generatedImages?.length ?? 0) > 0;
    });
    if (trimmedMessages.length === 0) {
      return input.id ?? this.createId();
    }

    const now = Date.now();
    const existingId = input.id ?? null;
    const title = this.buildTitle(trimmedMessages);

    let savedId = existingId;
    this._histories.update(entries => {
      const nextEntries = [...entries];
      const existingIndex = existingId ? nextEntries.findIndex(entry => entry.id === existingId) : -1;

      if (existingIndex >= 0) {
        const current = nextEntries[existingIndex];
        nextEntries[existingIndex] = {
          ...current,
          title,
          updatedAt: now,
          modelId: input.modelId,
          modelName: input.modelName,
          messages: trimmedMessages,
        };
        savedId = current.id;
      } else {
        savedId = this.createId();
        nextEntries.unshift({
          id: savedId,
          title,
          createdAt: now,
          updatedAt: now,
          modelId: input.modelId,
          modelName: input.modelName,
          messages: trimmedMessages,
        });
      }

      const sorted = nextEntries
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, this.maxHistoryEntries);

      void this.persist(sorted);
      return sorted;
    });

    return savedId ?? this.createId();
  }

  deleteHistory(id: string): void {
    this._histories.update(entries => {
      const nextEntries = entries.filter(entry => entry.id !== id);
      void this.persist(nextEntries);
      return nextEntries;
    });
  }

  private buildTitle(messages: AiHistoryMessage[]): string {
    const firstUserMessage = messages.find(message => message.role === 'user')?.content.trim();
    if (!firstUserMessage) {
      return 'Untitled chat';
    }

    return firstUserMessage.length > 56 ? `${firstUserMessage.slice(0, 56).trimEnd()}...` : firstUserMessage;
  }

  private loadLegacyHistory(): AiChatHistoryEntry[] {
    return this.storage.getObject<AiChatHistoryEntry[]>(this.storageKey) ?? [];
  }

  private async refreshHistory(accountPubkey: string | null): Promise<void> {
    if (accountPubkey && this.database.hasAccountDb()) {
      try {
        const entries = await this.database.getAiChatHistoryEntries(accountPubkey);
        this._histories.set(this.fromStoredEntries(entries));
        return;
      } catch (error) {
        this.logger.warn('Failed to load AI chat history from account database, falling back to localStorage', error);
      }
    }

    this._histories.set(this.loadLegacyHistory());
  }

  private async persist(entries: AiChatHistoryEntry[]): Promise<void> {
    const accountPubkey = this.accountState.account()?.pubkey ?? null;

    if (accountPubkey && this.database.hasAccountDb()) {
      try {
        await this.database.replaceAiChatHistoryEntries(accountPubkey, this.toStoredEntries(entries, accountPubkey));
        return;
      } catch (error) {
        this.logger.warn('Failed to save AI chat history to account database, falling back to localStorage', error);
      }
    }

    this.storage.setObject(this.storageKey, entries);
  }

  private toStoredEntries(entries: AiChatHistoryEntry[], accountPubkey: string): StoredAiChatHistoryEntry[] {
    return entries.map(entry => ({
      ...entry,
      accountPubkey,
      messages: entry.messages.map(message => ({
        role: message.role,
        content: message.content,
        generatedImages: message.generatedImages?.map(image => ({
          ...image,
        })),
      })),
    }));
  }

  private fromStoredEntries(entries: StoredAiChatHistoryEntry[]): AiChatHistoryEntry[] {
    return entries.map(entry => ({
      id: entry.id,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      modelId: entry.modelId,
      modelName: entry.modelName,
      messages: entry.messages.map(message => ({
        role: message.role,
        content: message.content,
        generatedImages: message.generatedImages?.map(image => ({
          ...image,
        })),
      })),
    }));
  }

  private createId(): string {
    return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}