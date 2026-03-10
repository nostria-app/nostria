import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AngorProject } from '../../services/angor.service';

@Component({
  selector: 'app-angor-project-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './angor-project-card.component.html',
  styleUrl: './angor-project-card.component.scss',
})
export class AngorProjectCardComponent {
  readonly project = input.required<AngorProject>();

  readonly displayName = computed(() => {
    const p = this.project();
    return p.metadata?.display_name || p.metadata?.name || '';
  });

  /** True when we have no name from metadata  */
  readonly hasName = computed(() => !!this.displayName());

  readonly titleText = computed(() => {
    if (this.hasName()) return this.displayName();
    const id = this.project().projectIdentifier;
    if (!id) return 'Unnamed Project';

    // Show truncated identifier as the title
    return id.length > 26 ? id.slice(0, 10) + '…' + id.slice(-8) : id;
  });

  readonly about = computed(() => this.project().metadata?.about || '');
  readonly picture = computed(() => this.project().metadata?.picture || '');
  readonly banner = computed(() => this.project().metadata?.banner || '');
  readonly website = computed(() => this.project().metadata?.website || '');

  /** Target amount formatted in BTC  */
  readonly targetBtc = computed(() => {
    const sats = this.project().targetAmount;
    if (!sats) return null;
    return (sats / 1e8).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    });
  });

  readonly startDateFormatted = computed(() => this.formatDate(this.project().startDate));
  readonly endDateFormatted = computed(() => this.formatDate(this.project().endDate));

  /** Short project identifier shown as a subtitle when nip05 is absent */
  readonly shortIdentifier = computed(() => {
    const id = this.project().projectIdentifier;
    if (!id) return '';
    return id.length > 20 ? id.slice(0, 8) + '…' + id.slice(-6) : id;
  });

  /** Link to the project on Angor Hub */
  readonly angorUrl = computed(() => {
    const id = this.project().projectIdentifier;
    return `https://hub.angor.io/project/${id}`;
  });

  openAngor(): void {
    window.open(this.angorUrl(), '_blank', 'noopener,noreferrer');
  }

  private formatDate(unix: number): string {
    if (!unix) return '';
    return new Date(unix * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}
