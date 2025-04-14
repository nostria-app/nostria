import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ZXingScannerModule } from '@zxing/ngx-scanner';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

@Component({
    selector: 'app-qrcode-scan-dialog',
    imports: [ZXingScannerModule, MatDialogModule, MatButtonModule],
    templateUrl: './qrcode-scan-dialog.component.html',
    styleUrl: './qrcode-scan-dialog.component.scss'
})
export class QRCodeScanDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { did: string },
    private dialogRef: MatDialogRef<QRCodeScanDialogComponent>,
  ) {}

  ngAfterViewInit() {
    // const canvas = document.querySelector('canvas');
    // QRCode.toCanvas(canvas, this.data.did, (error: any) => {
    //   if (error) {
    //     console.error('Error generating QR code: ', error);
    //   }
    // });
  }

  scanSuccessHandler(event: any) {
    console.log('Scan success:', event);
    this.dialogRef.close(event);
  }

  scanErrorHandler(event: any) {
    console.log('Scan success:', event);
  }

  scanFailureHandler(event: any) {
    console.log('Scan success:', event);
  }

  scanCompleteHandler(event: any) {
    console.log('Scan success:', event);
  }
}
