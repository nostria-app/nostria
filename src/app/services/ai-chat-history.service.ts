import { Injectable, computed, inject, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';

export interface AiHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
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
  private readonly storage = inject(LocalStorageService);
  private readonly storageKey = 'nostria-ai-chat-history';
  private readonly maxHistoryEntries = 30;

  private readonly _histories = signal<AiChatHistoryEntry[]>(this.loadHistory());
  readonly histories = computed(() => this._histories());

  getHistory(id: string): AiChatHistoryEntry | undefined {
    return this._histories().find(entry => entry.id === id);
  }

  saveConversation(input: {
    id?: string | null;
    modelId: string;
    modelName: string;
    messages: AiHistoryMessage[];
  }): string {
    const trimmedMessages = input.messages.filter(message => message.content.trim().length > 0);
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

      this.persist(sorted);
      return sorted;
    });

    return savedId ?? this.createId();
  }

  deleteHistory(id: string): void {
    this._histories.update(entries => {
      const nextEntries = entries.filter(entry => entry.id !== id);
      this.persist(nextEntries);
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

  private loadHistory(): AiChatHistoryEntry[] {
    return this.storage.getObject<AiChatHistoryEntry[]>(this.storageKey) ?? [];
  }

  private persist(entries: AiChatHistoryEntry[]): void {
    this.storage.setObject(this.storageKey, entries);
  }

  private createId(): string {
    return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}