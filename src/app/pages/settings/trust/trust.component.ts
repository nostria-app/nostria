import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { LocalSettingsService } from '../../../services/local-settings.service';

interface TrustRelay {
  url: string;
  name: string;
  description: string;
}

@Component({
  selector: 'app-trust-settings',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  templateUrl: './trust.component.html',
  styleUrl: './trust.component.scss',
})
export class TrustSettingsComponent {
  localSettings = inject(LocalSettingsService);

  // Available trust relays
  trustRelays: TrustRelay[] = [
    {
      url: 'wss://nip85.brainstorm.world',
      name: 'Brainstorm World',
      description: 'Default NIP-85 trusted assertions relay',
    },
    {
      url: 'wss://nip85.nostr.band',
      name: 'Nostr Band',
      description: 'Alternative NIP-85 trusted assertions relay',
    },
  ];

  toggleTrustEnabled(): void {
    this.localSettings.setTrustEnabled(!this.localSettings.trustEnabled());
  }

  setTrustRelay(url: string): void {
    this.localSettings.setTrustRelay(url);
  }
}
