import { Pipe, PipeTransform } from '@angular/core';
import { nip19 } from 'nostr-tools';

@Pipe({
    name: 'npub',
    standalone: true,
    pure: true
})
export class NPubPipe implements PipeTransform {
    transform(value?: string, format: 'long' | 'short' = 'long'): string {
        if (!value) {
            return '';
        }

        console.debug('Converting public key to npub', value);
        const npub = nip19.npubEncode(value);

        return format === 'short'
            ? `${npub.substring(0, 6)}...${npub.substring(npub.length - 6)}`
            : npub;
    }
}