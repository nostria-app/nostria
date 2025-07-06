import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { QrCodeComponent } from './qr-code.component';

describe('QrCodeComponent', () => {
  let component: QrCodeComponent;
  let fixture: ComponentFixture<QrCodeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QrCodeComponent],
      providers: [
        provideZonelessChangeDetection()
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(QrCodeComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should generate SVG QR code by default', async () => {
    fixture.componentRef.setInput('qrdata', 'test data');
    
    // In zoneless mode, we need to trigger change detection manually
    fixture.detectChanges();
    
    // Wait for effects to run
    await fixture.whenStable();
    
    expect(component.svgData()).toBeTruthy();
    // Convert SafeHtml to string for testing
    const svgString = component.svgData().toString();
    expect(svgString).toContain('<svg');
  });

  it('should update QR code when input changes', async () => {
    fixture.componentRef.setInput('qrdata', 'test data 1');
    fixture.detectChanges();
    await fixture.whenStable();
    const firstSvg = component.svgData().toString();
    
    fixture.componentRef.setInput('qrdata', 'test data 2');
    fixture.detectChanges();
    await fixture.whenStable();
    const secondSvg = component.svgData().toString();
    
    expect(firstSvg).not.toEqual(secondSvg);
  });
});