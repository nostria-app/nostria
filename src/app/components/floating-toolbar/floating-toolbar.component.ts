import {
  Component,
  input,
  output,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';

export interface FloatingToolbarPosition {
  top: number;
  left: number;
}

@Component({
  selector: 'app-floating-toolbar',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, MatDividerModule],
  templateUrl: './floating-toolbar.component.html',
  styleUrl: './floating-toolbar.component.scss',
})
export class FloatingToolbarComponent {
  visible = input<boolean>(false);
  position = input<FloatingToolbarPosition>({ top: 0, left: 0 });

  bold = output<void>();
  italic = output<void>();
  link = output<void>();
  heading1 = output<void>();
  heading2 = output<void>();
  heading3 = output<void>();
  quote = output<void>();
  bulletList = output<void>();
  orderedList = output<void>();
  code = output<void>();
  uploadFiles = output<void>();

  @ViewChild('toolbar') toolbar?: ElementRef<HTMLDivElement>;

  onBold() {
    this.bold.emit();
  }

  onItalic() {
    this.italic.emit();
  }

  onLink() {
    this.link.emit();
  }

  onHeading1() {
    this.heading1.emit();
  }

  onHeading2() {
    this.heading2.emit();
  }

  onHeading3() {
    this.heading3.emit();
  }

  onQuote() {
    this.quote.emit();
  }

  onBulletList() {
    this.bulletList.emit();
  }

  onOrderedList() {
    this.orderedList.emit();
  }

  onCode() {
    this.code.emit();
  }

  onUploadFiles() {
    this.uploadFiles.emit();
  }
}
