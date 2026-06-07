import { Service } from '@angular/core';

export interface AiPromptHandlerResult {
  handled: boolean;
}

export type AiPromptHandler = (prompt: string) => AiPromptHandlerResult | Promise<AiPromptHandlerResult>;

@Service()
export class AiPromptActionService {
  private handlers = new Set<AiPromptHandler>();

  registerHandler(handler: AiPromptHandler): void {
    this.handlers.add(handler);
  }

  unregisterHandler(handler: AiPromptHandler): void {
    this.handlers.delete(handler);
  }

  async triggerPrompt(prompt: string): Promise<boolean> {
    for (const handler of this.handlers) {
      const result = await handler(prompt);
      if (result.handled) {
        return true;
      }
    }

    return false;
  }
}
