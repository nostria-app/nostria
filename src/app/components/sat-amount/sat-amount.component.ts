import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SatDisplayService } from '../../services/sat-display.service';

@Component({
  selector: 'app-sat-amount',
  template: `
    <span class="sat-amount">
      <span class="sat-amount__value">{{ displayValue().value }}</span>
      @if (displayValue().unit) {
        <span class="sat-amount__unit">{{ displayValue().unit }}</span>
      }
    </span>
  `,
  styles: [
    `
      .sat-amount {
        display: inline-flex;
        align-items: baseline;
        gap: 0.25em;
        min-width: 0;
      }

      .sat-amount__value,
      .sat-amount__unit {
        min-width: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SatAmountComponent {
  private readonly satDisplay = inject(SatDisplayService);

  readonly sats = input<number | null | undefined>(undefined);
  readonly msats = input<number | null | undefined>(undefined);
  readonly showUnit = input(true);
  readonly compact = input(false);
  readonly hideWhenWalletHidden = input(false);
  readonly placeholder = input('0');
  readonly prefix = input('');

  protected readonly displayValue = computed(() => {
    const options = {
      showUnit: this.showUnit(),
      compact: this.compact(),
      hideWhenWalletHidden: this.hideWhenWalletHidden(),
      placeholder: this.placeholder(),
      prefix: this.prefix(),
    };

    const msats = this.msats();
    if (typeof msats === 'number') {
      return this.satDisplay.getDisplayValueFromMsats(msats, options);
    }

    return this.satDisplay.getDisplayValueFromSats(this.sats(), options);
  });
}