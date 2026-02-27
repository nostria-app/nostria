import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';

import { AppContext, PlatformService } from '../../../services/platform.service';
import { RightPanelService } from '../../../services/right-panel.service';

@Component({
  selector: 'app-debug-settings',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
  ],
  templateUrl: './debug.component.html',
  styleUrl: './debug.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
})
export class DebugSettingsComponent {
  readonly platform = inject(PlatformService);
  private readonly rightPanel = inject(RightPanelService);

  readonly platformOptions: { value: AppContext | null; label: string; description: string }[] = [
    { value: null, label: 'Auto-detect', description: 'Use real platform detection' },
    { value: 'web', label: 'Web Browser', description: 'Standard browser — Bitcoin Lightning payments' },
    { value: 'pwa', label: 'PWA (Installed)', description: 'Installed web app — Bitcoin Lightning payments' },
    { value: 'native-android', label: 'Native Android', description: 'Android TWA — Google Play Store payments' },
    { value: 'native-ios', label: 'Native iOS', description: 'iOS native app — Apple App Store / StoreKit payments' },
  ];

  goBack(): void {
    this.rightPanel.goBack();
  }

  setSimulatedPlatform(value: AppContext | null): void {
    this.platform.simulatedAppContext.set(value);
  }
}
