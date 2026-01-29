import { Pipe, PipeTransform, inject } from '@angular/core';
import { UtilitiesService } from '../services/utilities.service';

@Pipe({
  name: 'npub',
  standalone: true,
  pure: true,
})
export class NPubPipe implements PipeTransform {
  private utilities = inject(UtilitiesService);

  transform(value?: string, format: 'long' | 'short' = 'long'): string {
    if (!value) {
      return '';
    }

    const npub = this.utilities.getNpubFromPubkey(value);

    return format === 'short'
      ? this.utilities.truncateString(npub, 6, 6)
      : npub;
  }
}
