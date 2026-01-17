import { Component, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ExternalLinkHandlerService } from '../../../services/external-link-handler.service';

@Component({
  selector: 'app-setting-external-links',
  imports: [FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <h2 i18n="@@settings.external-links.title">External Links</h2>
      <p i18n="@@settings.external-links.description">Configure which external domains should open within the app instead of a new browser tab</p>

      <div class="external-domains-list">
        @for (domain of configuredDomains(); track domain) {
          <div class="domain-item">
            <span class="domain-name">{{ domain }}</span>
            <button mat-icon-button (click)="removeDomain(domain)" [attr.aria-label]="'Remove ' + domain">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
      </div>

      <div class="add-domain-container">
        <mat-form-field appearance="outline" class="domain-input">
          <mat-label i18n="@@settings.external-links.add-domain">Add Domain</mat-label>
          <input matInput [(ngModel)]="newDomain" placeholder="example.com" (keyup.enter)="addNewDomain()"
            i18n-placeholder="@@settings.external-links.domain-placeholder">
        </mat-form-field>
        <button mat-flat-button (click)="addNewDomain()" [disabled]="!newDomain"
          i18n="@@settings.external-links.add-button">
          Add
        </button>
      </div>

      <button mat-stroked-button (click)="resetDomainsToDefault()" i18n="@@settings.external-links.reset-button">
        Reset to Defaults
      </button>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }
    h2 {
      margin-top: 0;
    }
    .external-domains-list {
      margin-bottom: 16px;
    }
    .domain-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--mat-sys-surface-container);
      border-radius: var(--mat-sys-corner-small);
      margin-bottom: 8px;
    }
    .add-domain-container {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .domain-input {
      flex: 1;
    }
  `]
})
export class SettingExternalLinksComponent {
  private readonly externalLinkHandler = inject(ExternalLinkHandlerService);

  configuredDomains = signal<string[]>(this.externalLinkHandler.getConfiguredDomains());
  newDomain = '';

  addNewDomain(): void {
    if (!this.newDomain.trim()) {
      return;
    }
    this.externalLinkHandler.addDomain(this.newDomain.trim());
    this.configuredDomains.set(this.externalLinkHandler.getConfiguredDomains());
    this.newDomain = '';
  }

  removeDomain(domain: string): void {
    this.externalLinkHandler.removeDomain(domain);
    this.configuredDomains.set(this.externalLinkHandler.getConfiguredDomains());
  }

  resetDomainsToDefault(): void {
    this.externalLinkHandler.resetToDefaults();
    this.configuredDomains.set(this.externalLinkHandler.getConfiguredDomains());
  }
}
