import { ComponentFixture, TestBed } from '@angular/core/testing';
import { QrCodeComponent } from './qr-code.component';

describe('QrCodeComponent', () => {
  let component: QrCodeComponent;
  let fixture: ComponentFixture<QrCodeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QrCodeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(QrCodeComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should generate SVG QR code by default', () => {
    fixture.componentRef.setInput('qrdata', 'test data');
    fixture.detectChanges();
    
    expect(component.svgData()).toBeTruthy();
    expect(component.svgData()).toContain('<svg');
  });

  it('should update QR code when input changes', () => {
    fixture.componentRef.setInput('qrdata', 'test data 1');
    fixture.detectChanges();
    const firstSvg = component.svgData();
    
    fixture.componentRef.setInput('qrdata', 'test data 2');
    fixture.detectChanges();
    const secondSvg = component.svgData();
    
    expect(firstSvg).not.toEqual(secondSvg);
  });
});