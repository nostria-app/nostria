import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';


@Component({
  selector: 'app-content-warning',
  imports: [MatButtonModule, MatCardModule, MatIconModule],
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
