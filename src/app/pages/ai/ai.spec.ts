import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiComponent } from './ai';

function createComponent(): AiComponent {
  const component = Object.create(AiComponent.prototype) as AiComponent;
  const selectedModel = {
    id: 'model-1',
    name: 'Test Model',
    task: 'text-generation',
    description: 'Test',
    size: 'tiny',
    loading: false,
    progress: 0,
    loaded: true,
    cached: true,
    runtime: 'test',
    chatMode: 'messages',
    preferredParams: undefined,
  };

  (component as any).aiService = {
    generateText: vi.fn().mockResolvedValue([{ generated_text: 'Assistant reply' }]),
    isAbortError: vi.fn().mockReturnValue(false),
  };
  (component as any).historyService = {
    saveConversation: vi.fn().mockReturnValue('ai-history-id'),
  };
  (component as any).logger = {
    error: vi.fn(),
    warn: vi.fn(),
  };
  (component as any).chatError = signal('');
  (component as any).composerText = signal('');
  (component as any).attachedFiles = signal([]);
  (component as any).conversation = signal([]);
  (component as any).autoScrollPinned = signal(false);
  (component as any).showHistoryDrawer = signal(true);
  (component as any).currentConversationId = signal<string | null>(null);
  (component as any).isGenerating = signal(false);
  (component as any).nextMessageId = signal(0);
  (component as any).selectedModel = () => selectedModel;
  (component as any).systemPrompt = 'Test system prompt';

  return component;
}

describe('AiComponent #fetch prompt support', () => {
  let component: AiComponent;

  beforeEach(() => {
    component = createComponent();
    vi.restoreAllMocks();
  });

  it('removes #fetch commands from the visible prompt and injects fetched markdown into model context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# Page Title\n\nFetched markdown content.'),
    });
    vi.stubGlobal('fetch', fetchMock);

    (component as any).composerText.set('Summarize this page #fetch https://sondreb.com');

    await component.sendMessage();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://metadata.nostria.app/markdown?url=https%3A%2F%2Fsondreb.com%2F',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: expect.stringContaining('text/markdown'),
        }),
      }),
    );

    const generateInput = (component as any).aiService.generateText.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(generateInput[1]).toEqual(expect.objectContaining({
      role: 'user',
      content: expect.stringContaining('Summarize this page'),
    }));
    expect(generateInput[1].content).not.toContain('#fetch');
    expect(generateInput[1].content).toContain('Fetched web content:');
    expect(generateInput[1].content).toContain('https://sondreb.com/');
    expect(generateInput[1].content).toContain('Fetched markdown content.');

    const conversation = (component as any).conversation();
    expect(conversation[0].content).toBe('Summarize this page');
  });

  it('uses a default prompt when the composer only contains a #fetch command', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('Fetched content'),
    }));

    (component as any).composerText.set('#fetch https://nostria.app');

    await component.sendMessage();

    const conversation = (component as any).conversation();
    expect(conversation[0].content).toBe('Use the fetched page content from https://nostria.app/ as context.');
  });

  it('shows an error and aborts when the #fetch URL is invalid', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    (component as any).composerText.set('#fetch');

    await component.sendMessage();

    expect(fetchMock).not.toHaveBeenCalled();
    expect((component as any).chatError()).toContain('Invalid #fetch URL');
    expect((component as any).aiService.generateText).not.toHaveBeenCalled();
  });

  it('parses markdown suggestion headings and preserves each option as a separate card', () => {
    const parsed = (component as any).parseAssistantSuggestions(`Here are a few options for a short-form Nostr note.\n\n**Option 1: Informative/Historical**\n\n> Tributary tales from the Viking Age. Explore the seafaring prowess and expansion of these formidable Norse seafarers. #Vikings\n\n**Option 2: Evocative/Mysterious**\n\n> Echoes of longships and frost. What secrets do the Vikings still hold? #NorseMyth`);

    expect(parsed).not.toBeNull();
    expect(parsed.suggestions).toHaveLength(2);
    expect(parsed.suggestions[0].title).toBe('Option 1: Informative/Historical');
    expect(parsed.suggestions[1].title).toBe('Option 2: Evocative/Mysterious');
  });

  it('normalizes quoted suggestion content before using it for sharing', () => {
    const shared = (component as any).suggestionShareContent({
      id: 'option-1',
      title: 'Option 1: Informative/Historical',
      content: '> Tributary tales from the Viking Age.\n> #Vikings #History',
    });

    expect(shared).toBe('Tributary tales from the Viking Age.\n#Vikings #History');
  });

  it('moves trailing follow-up questions out of the last suggestion', () => {
    const parsed = (component as any).parseAssistantSuggestions(`Here are a few options for a short-form Nostr note.\n\nOption 1: Informative/Historical\n\n> Viking lore: Raiders, explorers, and masterful seafarers. #Vikings\n\nOption 2: Intriguing/Mysterious\n\n> Echoes of the longships. What secrets do the Vikings still hold? #VikingAge\n\nOption 3: Simple/Engaging\n\n> Thinking about Viking sagas today. Incredible stories of exploration and bravery. #NorseMyth\n\nWhich style do you prefer, or would you like me to adjust the focus?`);

    expect(parsed).not.toBeNull();
    expect(parsed.suggestions).toHaveLength(3);
    expect(parsed.suggestions[2].content).not.toContain('Which style do you prefer');
    expect(parsed.outro).toBe('Which style do you prefer, or would you like me to adjust the focus?');
  });

  it('moves single-line trailing follow-up text out of the last suggestion without a blank separator', () => {
    const parsed = (component as any).parseAssistantSuggestions(`Here are a few options for a short-form Nostr note.\n\nOption 1: Informative/Historical\n\n> Viking saga alert! These Norse seafarers shaped history. #Vikings\n\nOption 2: Intriguing/Mysterious\n\n> Echoes of the longships. What secrets do the Vikings still hold? #VikingLore\n\nOption 3: Short & Punchy\n\n> Vikings: Warriors, traders, and explorers. Powerful legacy. #Norse #HistoryFacts\nWhich style works best for what you're looking for? I can refine one further!`);

    expect(parsed).not.toBeNull();
    expect(parsed.suggestions[2].content).toContain('Vikings: Warriors, traders, and explorers.');
    expect(parsed.suggestions[2].content).not.toContain('Which style works best');
    expect(parsed.outro).toBe("Which style works best for what you're looking for? I can refine one further!");
  });

  it('moves parenthetical follow-up prompts out of the last suggestion card', () => {
    const parsed = (component as any).parseAssistantSuggestions(`Here are a few options for a short-form Nostr note post about Vikings, depending on the tone you want:\n\nOption 1: Informative/Historical\n\n> Viking lore: Fierce seafarers and explorers who shaped early medieval Europe. #Vikings #History #Norse\n\nOption 2: Evocative/Mysterious\n\n> Echoes of the North. Vikings. Warriors of the sea, charting unknown horizons. #NorseMyth #AncientHistory\n\nOption 3: Short & Punchy\n\n> Vikings: Raiders, traders, pioneers. A legacy carved into history. #HistoryFacts #VikingAge\n\nWhich style do you prefer, or would you like me to adjust the focus (e.g., focus more on mythology, exploration, or daily life)?`);

    expect(parsed).not.toBeNull();
    expect(parsed.suggestions[2].content).not.toContain('Which style do you prefer');
    expect(parsed.outro).toBe('Which style do you prefer, or would you like me to adjust the focus (e.g., focus more on mythology, exploration, or daily life)?');
  });
});