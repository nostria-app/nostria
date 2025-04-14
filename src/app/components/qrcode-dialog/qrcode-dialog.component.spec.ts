import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QRCodeDialogComponent } from './qrcode-dialog.component';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

describe('QRCodeDialogComponent', () => {
  let component: QRCodeDialogComponent;
  let fixture: ComponentFixture<QRCodeDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QRCodeDialogComponent],
      providers: [
        {
          // I was expecting this will pass the desired value
          provide: MAT_DIALOG_DATA,
          useValue: { did: 'did:dht:y31q7b9acubm9r7cgnpyef3db1st97smsrgamsjfshf1gictromo' },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QRCodeDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
