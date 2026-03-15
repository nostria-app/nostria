import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-settings-link-card',
  imports: [MatIconModule],
  templateUrl: './settings-link-card.component.html',
  styleUrl: './settings-link-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsLinkCardComponent {
  readonly title = input.required<string>();
  readonly description = input('');
  readonly icon = input('arrow_forward');
  readonly activated = output<void>();

  onActivate(): void {
    this.activated.emit();
  }
}
