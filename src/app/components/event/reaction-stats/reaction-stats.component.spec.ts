import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ReactionStatsComponent } from './reaction-stats.component';
import { NostrRecord } from '../../../interfaces';

function makeRecord(id: string, pubkey: string): NostrRecord {
  return {
    event: {
      id,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 7,
      tags: [],
      content: '+',
      sig: '',
    },
    data: null,
  };
}

describe('ReactionStatsComponent', () => {
  let component: ReactionStatsComponent;
  let fixture: ComponentFixture<ReactionStatsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReactionStatsComponent],
      providers: [
        provideZonelessChangeDetection(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReactionStatsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not show stats when all counts are zero', () => {
    expect(component.hasAnyStats()).toBeFalse();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.reaction-stats')).toBeNull();
  });

  it('should show stats when reactions exist', async () => {
    const records = [makeRecord('1', 'pub1'), makeRecord('2', 'pub2')];
    fixture.componentRef.setInput('reactions', records);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.hasAnyStats()).toBeTrue();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.reaction-stats')).toBeTruthy();
    expect(el.querySelector('.reactions-icon')).toBeTruthy();
  });

  it('should show reply count when replies exist', async () => {
    fixture.componentRef.setInput('replyCount', 5);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.hasAnyStats()).toBeTrue();
    const el: HTMLElement = fixture.nativeElement;
    const labels = el.querySelectorAll('.stat-label');
    const found = Array.from(labels).some(l => l.textContent?.trim() === 'Replies');
    expect(found).toBeTrue();
  });

  it('should show singular label for single reply', async () => {
    fixture.componentRef.setInput('replyCount', 1);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const labels = el.querySelectorAll('.stat-label');
    const found = Array.from(labels).some(l => l.textContent?.trim() === 'Reply');
    expect(found).toBeTrue();
  });

  it('should show repost count', async () => {
    fixture.componentRef.setInput('repostCount', 3);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.hasAnyStats()).toBeTrue();
    const el: HTMLElement = fixture.nativeElement;
    const labels = el.querySelectorAll('.stat-label');
    const found = Array.from(labels).some(l => l.textContent?.trim() === 'Reposts');
    expect(found).toBeTrue();
  });

  it('should show zap amount when zaps exist', async () => {
    fixture.componentRef.setInput('totalZapAmount', 1200);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.hasAnyStats()).toBeTrue();
    const el: HTMLElement = fixture.nativeElement;
    const labels = el.querySelectorAll('.stat-label');
    const found = Array.from(labels).some(l => l.textContent?.trim() === 'sats');
    expect(found).toBeTrue();
  });

  it('should format large zap amounts with K suffix', () => {
    fixture.componentRef.setInput('totalZapAmount', 5000);
    expect(component.formattedZapAmount()).toBe('5.0K');
  });

  it('should format million zap amounts with M suffix', () => {
    fixture.componentRef.setInput('totalZapAmount', 2500000);
    expect(component.formattedZapAmount()).toBe('2.5M');
  });

  it('should format small zap amounts as locale string', () => {
    fixture.componentRef.setInput('totalZapAmount', 500);
    expect(component.formattedZapAmount()).toBe('500');
  });

  it('should emit tabClicked with correct tab on click', async () => {
    const records = [makeRecord('1', 'pub1')];
    fixture.componentRef.setInput('reactions', records);
    fixture.detectChanges();
    await fixture.whenStable();

    let emittedTab: string | undefined;
    component.tabClicked.subscribe((tab: string) => {
      emittedTab = tab;
    });

    const statButton = fixture.nativeElement.querySelector('.stat-item') as HTMLButtonElement;
    statButton.click();

    expect(emittedTab).toBe('likes');
  });

  it('should show separators between stat groups', async () => {
    const records = [makeRecord('1', 'pub1')];
    fixture.componentRef.setInput('reactions', records);
    fixture.componentRef.setInput('replyCount', 3);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const separators = el.querySelectorAll('.stat-separator');
    expect(separators.length).toBeGreaterThan(0);
  });

  it('should show singular label for single reaction', async () => {
    const records = [makeRecord('1', 'pub1')];
    fixture.componentRef.setInput('reactions', records);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const labels = el.querySelectorAll('.stat-label');
    const found = Array.from(labels).some(l => l.textContent?.trim() === 'Reaction');
    expect(found).toBeTrue();
  });

  it('should show singular label for single repost', async () => {
    fixture.componentRef.setInput('repostCount', 1);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const labels = el.querySelectorAll('.stat-label');
    const found = Array.from(labels).some(l => l.textContent?.trim() === 'Repost');
    expect(found).toBeTrue();
  });

  it('should display multiple stat types together', async () => {
    const records = [makeRecord('1', 'pub1'), makeRecord('2', 'pub2')];
    fixture.componentRef.setInput('reactions', records);
    fixture.componentRef.setInput('replyCount', 3);
    fixture.componentRef.setInput('repostCount', 1);
    fixture.componentRef.setInput('totalZapAmount', 500);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const statItems = el.querySelectorAll('.stat-item');
    expect(statItems.length).toBe(4); // reactions, replies, reposts, zaps
  });

  it('should not show zaps section when totalZapAmount is 0', async () => {
    fixture.componentRef.setInput('totalZapAmount', 0);
    fixture.componentRef.setInput('replyCount', 1);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const zapsIcon = el.querySelector('.zaps-icon');
    expect(zapsIcon).toBeNull();
  });

  it('reply stat should not be a button', async () => {
    fixture.componentRef.setInput('replyCount', 5);
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    const replyItem = el.querySelector('.stat-item-static');
    expect(replyItem).toBeTruthy();
    expect(replyItem?.tagName.toLowerCase()).toBe('span');
  });

  it('should not render anything when hasAnyStats is false', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.children.length).toBe(0);
  });
});
