import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QRCodeScanDialogComponent } from './qrcode-scan-dialog.component';

describe('QrcodeScanDialogComponent', () => {
  let component: QRCodeScanDialogComponent;
  let fixture: ComponentFixture<QRCodeScanDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QRCodeScanDialogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(QRCodeScanDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
