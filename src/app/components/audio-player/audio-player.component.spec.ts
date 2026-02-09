import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { AudioPlayerComponent } from './audio-player.component';

describe('AudioPlayerComponent', () => {
  let component: AudioPlayerComponent;
  let fixture: ComponentFixture<AudioPlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AudioPlayerComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(AudioPlayerComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have default input values', () => {
    expect(component.src()).toBe('');
    expect(component.waveform()).toEqual([]);
    expect(component.duration()).toBe(0);
  });

  it('should accept src input', async () => {
    fixture.componentRef.setInput('src', 'https://example.com/audio.mp3');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.src()).toBe('https://example.com/audio.mp3');
    expect(component.currentSrc()).toBe('https://example.com/audio.mp3');
  });

  it('should accept waveform input', async () => {
    const waveform = [10, 20, 30, 40, 50];
    fixture.componentRef.setInput('waveform', waveform);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.waveform()).toEqual(waveform);
  });

  it('should accept duration input', async () => {
    fixture.componentRef.setInput('duration', 120);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.duration()).toBe(120);
  });

  it('should update currentSrc when src changes', async () => {
    fixture.componentRef.setInput('src', 'https://example.com/first.mp3');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.currentSrc()).toBe('https://example.com/first.mp3');

    fixture.componentRef.setInput('src', 'https://example.com/second.mp3');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.currentSrc()).toBe('https://example.com/second.mp3');
  });

  it('should set totalDuration from duration input when no audio metadata', async () => {
    fixture.componentRef.setInput('duration', 60);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.totalDuration()).toBe(60);
  });

  it('should calculate waveform bar height correctly', () => {
    expect(component.getWaveformBarHeight(50)).toBeGreaterThanOrEqual(15);
    expect(component.getWaveformBarHeight(0)).toBe(15);
  });

  it('should render waveform bars in template when waveform is provided', async () => {
    fixture.componentRef.setInput('waveform', [10, 20, 30]);
    fixture.detectChanges();
    await fixture.whenStable();

    const bars = fixture.nativeElement.querySelectorAll('.bar');
    expect(bars.length).toBe(3);
  });

  it('should render slider when no waveform is provided', async () => {
    fixture.componentRef.setInput('waveform', []);
    fixture.detectChanges();
    await fixture.whenStable();

    const slider = fixture.nativeElement.querySelector('mat-slider');
    expect(slider).toBeTruthy();
    const bars = fixture.nativeElement.querySelectorAll('.bar');
    expect(bars.length).toBe(0);
  });
});
