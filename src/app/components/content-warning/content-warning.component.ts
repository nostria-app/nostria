import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-content-warning',
  imports: [CommonModule, MatButtonModule, MatCardModule, MatIconModule],
  templateUrl: './content-warning.component.html',
  styleUrl: './content-warning.component.scss',
})
export class ContentWarningComponent {
  reason = input<string | null>(null);
  approve = output<void>();

  approveContent() {
    this.approve.emit();
  }
}
