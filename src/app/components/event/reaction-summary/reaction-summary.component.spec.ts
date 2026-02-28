import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ReactionSummaryComponent, ZapInfo } from './reaction-summary.component';
import { NostrRecord } from '../../../interfaces';

function makeReactionRecord(id: string, pubkey: string, content = '+'): NostrRecord {
  return {
    event: {
      id,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 7,
      tags: [],
      content,
      sig: '',
    },
    data: null,
  };
}

function makeRepostRecord(id: string, pubkey: string): NostrRecord {
  return {
    event: {
      id,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 6,
      tags: [],
      content: '',
      sig: '',
    },
    data: null,
  };
}

function makeZapInfo(id: string, pubkey: string, amount: number, comment = ''): ZapInfo {
  return {
    receipt: {
      id,
      pubkey: 'lnurl-provider',
      created_at: Math.floor(Date.now() / 1000),
      kind: 9735,
      tags: [],
      content: '',
      sig: '',
    },
    zapRequest: null,
    amount,
    comment,
    senderPubkey: pubkey,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

describe('ReactionSummaryComponent', () => {
  let component: ReactionSummaryComponent;
  let fixture: ComponentFixture<ReactionSummaryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReactionSummaryComponent],
      providers: [
        provideZonelessChangeDetection(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReactionSummaryComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render all five tabs', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const tabs = el.querySelectorAll('.summary-tab');
    expect(tabs.length).toBe(4);

    const labels = Array.from(tabs).map(t => t.querySelector('.tab-label')?.textContent?.trim());
    expect(labels).toEqual(['Reactions', 'Reposts', 'Quotes', 'Zaps']);
  });

  it('should have the first tab (reactions) selected by default', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.selectedTab()).toBe('reactions');
    const el: HTMLElement = fixture.nativeElement;
    const activeTab = el.querySelector('.summary-tab.active');
    expect(activeTab).toBeTruthy();
    expect(activeTab?.querySelector('.tab-label')?.textContent?.trim()).toBe('Reactions');
  });

  it('should show correct counts for each tab', async () => {
    const reactions = [makeReactionRecord('r1', 'p1'), makeReactionRecord('r2', 'p2')];
    fixture.componentRef.setInput('reactions', reactions);
    fixture.componentRef.setInput('repostCount', 1);
    fixture.componentRef.setInput('quoteCount', 2);
    fixture.componentRef.setInput('zapCount', 4);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const tabs = el.querySelectorAll('.summary-tab');
    const counts = Array.from(tabs).map(t => t.querySelector('.tab-count')?.textContent?.trim());
    expect(counts).toEqual(['2', '1', '2', '4']);
  });

  it('should switch tabs when clicked', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const tabs = el.querySelectorAll('.summary-tab');

    // Click "Reposts" tab (index 1)
    (tabs[1] as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.selectedTab()).toBe('reposts');
    expect(tabs[1].classList.contains('active')).toBe(true);
  });

  it('should show empty state when no reactions', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const emptyState = el.querySelector('.empty-state');
    expect(emptyState).toBeTruthy();
    expect(emptyState?.textContent?.trim()).toBe('No reactions yet');
  });

  it('should show reaction list items when reactions exist', async () => {
    const reactions = [
      makeReactionRecord('r1', 'p1'),
      makeReactionRecord('r2', 'p2', '\uD83D\uDE02'),
    ];
    fixture.componentRef.setInput('reactions', reactions);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll('.list-item');
    expect(items.length).toBe(2);
  });

  it('should show empty state for quotes tab when no quotes', async () => {
    fixture.componentRef.setInput('quotes', []);
    component.selectedTab.set('quotes');
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const emptyState = el.querySelector('.empty-state');
    expect(emptyState?.textContent?.trim()).toBe('No quotes yet');
  });

  it('should show quote list for quotes tab', async () => {
    const quotes = [makeRepostRecord('q1', 'p1'), makeRepostRecord('q2', 'p2')];
    fixture.componentRef.setInput('quotes', quotes);
    fixture.componentRef.setInput('quoteCount', 2);
    component.selectedTab.set('quotes');
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll('.list-item');
    expect(items.length).toBe(2);
  });

  it('should show repost list when reposts tab is selected', async () => {
    const reposts = [makeRepostRecord('rp1', 'p1'), makeRepostRecord('rp2', 'p2')];
    fixture.componentRef.setInput('reposts', reposts);
    fixture.componentRef.setInput('repostCount', 2);
    component.selectedTab.set('reposts');
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll('.list-item');
    expect(items.length).toBe(2);
  });

  it('should show zap list with amounts when zaps tab is selected', async () => {
    const zaps = [
      makeZapInfo('z1', 'p1', 1000, 'Great post!'),
      makeZapInfo('z2', 'p2', 500),
    ];
    fixture.componentRef.setInput('zaps', zaps);
    fixture.componentRef.setInput('zapCount', 2);
    component.selectedTab.set('zaps');
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll('.list-item');
    expect(items.length).toBe(2);

    const amounts = el.querySelectorAll('.zap-amount');
    expect(amounts.length).toBe(2);
  });

  it('should show zap comments when present', async () => {
    const zaps = [makeZapInfo('z1', 'p1', 1000, 'Great post!')];
    fixture.componentRef.setInput('zaps', zaps);
    fixture.componentRef.setInput('zapCount', 1);
    component.selectedTab.set('zaps');
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const comment = el.querySelector('.zap-comment');
    expect(comment).toBeTruthy();
    expect(el.querySelector('.comment-text')?.textContent?.trim()).toBe('Great post!');
  });

  it('should not show zap comment when not present', async () => {
    const zaps = [makeZapInfo('z1', 'p1', 1000)];
    fixture.componentRef.setInput('zaps', zaps);
    fixture.componentRef.setInput('zapCount', 1);
    component.selectedTab.set('zaps');
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const comment = el.querySelector('.zap-comment');
    expect(comment).toBeNull();
  });

  it('should display heart emoji for + reaction', () => {
    expect(component.getReactionDisplay('+')).toBe('\u2764\uFE0F');
    expect(component.getReactionDisplay('')).toBe('\u2764\uFE0F');
  });

  it('should display actual emoji for non-+ reactions', () => {
    expect(component.getReactionDisplay('\uD83D\uDE02')).toBe('\uD83D\uDE02');
    expect(component.getReactionDisplay('\uD83D\uDC4D')).toBe('\uD83D\uDC4D');
  });

  it('should stop event propagation on tab click', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const mouseEvent = new MouseEvent('click', { bubbles: true });
    vi.spyOn(mouseEvent, 'stopPropagation');

    component.onTabClick('zaps', mouseEvent);
    expect(mouseEvent.stopPropagation).toHaveBeenCalled();
    expect(component.selectedTab()).toBe('zaps');
  });

  it('should sort reactions by timestamp descending', () => {
    const now = Math.floor(Date.now() / 1000);
    const older = makeReactionRecord('r1', 'p1');
    older.event.created_at = now - 100;
    const newer = makeReactionRecord('r2', 'p2');
    newer.event.created_at = now;

    fixture.componentRef.setInput('reactions', [older, newer]);

    const sorted = component.sortedReactions();
    expect(sorted[0].event.id).toBe('r2');
    expect(sorted[1].event.id).toBe('r1');
  });

  it('should sort zaps by amount descending', () => {
    const zaps = [
      makeZapInfo('z1', 'p1', 100),
      makeZapInfo('z2', 'p2', 5000),
      makeZapInfo('z3', 'p3', 500),
    ];
    fixture.componentRef.setInput('zaps', zaps);

    const sorted = component.sortedZaps();
    expect(sorted[0].amount).toBe(5000);
    expect(sorted[1].amount).toBe(500);
    expect(sorted[2].amount).toBe(100);
  });

  it('should detect custom emoji URLs from event tags', () => {
    const event = {
      id: 'test',
      pubkey: 'pub',
      created_at: Math.floor(Date.now() / 1000),
      kind: 7,
      tags: [['emoji', 'pepe', 'https://example.com/pepe.png']],
      content: ':pepe:',
      sig: '',
    };

    expect(component.getCustomEmojiUrl(event)).toBe('https://example.com/pepe.png');
  });

  it('should return null for non-custom-emoji content', () => {
    const event = {
      id: 'test',
      pubkey: 'pub',
      created_at: Math.floor(Date.now() / 1000),
      kind: 7,
      tags: [],
      content: '+',
      sig: '',
    };

    expect(component.getCustomEmojiUrl(event)).toBeNull();
  });

  it('should format zap amounts correctly', () => {
    expect(component.formatAmount(1000)).toBe('1,000');
    expect(component.formatAmount(0)).toBe('0');
    expect(component.formatAmount(null)).toBe('0');
  });

  it('should always be visible (no hasAnyStats gate)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const summary = el.querySelector('.reaction-summary');
    expect(summary).toBeTruthy();
  });

  it('should show underline on active tab', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const activeTab = el.querySelector('.summary-tab.active') as HTMLElement;
    expect(activeTab).toBeTruthy();

    // The active class applies border-bottom-color via CSS
    // We verify the class is present which triggers the style
    expect(activeTab.classList.contains('active')).toBe(true);
  });

  it('should switch underline when different tab is clicked', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const tabs = el.querySelectorAll('.summary-tab');

    // Initially reactions is active
    expect(tabs[0].classList.contains('active')).toBe(true);
    expect(tabs[2].classList.contains('active')).toBe(false);

    // Click reposts tab
    (tabs[2] as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(tabs[0].classList.contains('active')).toBe(false);
    expect(tabs[2].classList.contains('active')).toBe(true);
  });
});
