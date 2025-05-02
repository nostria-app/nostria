import { inject, Injectable, signal } from "@angular/core";
import { StorageService } from "./storage.service";
import { NostrService } from "./nostr.service";
import { RelayService } from "./relay.service";
import { NostrEvent } from "../interfaces";
import { kinds } from "nostr-tools";

@Injectable({
    providedIn: 'root'
})
export class BadgeService {
    private readonly storage = inject(StorageService);
    private readonly nost = inject(NostrService);
    private readonly relay = inject(RelayService);

    // Signal to store the list of badges
    badgeDefinitions = signal<NostrEvent[]>([]);

    getBadgeDefinition(pubkey: string, slug: string): NostrEvent | undefined {
        const badge = this.badgeDefinitions().find(badge => {
            const tags = badge.tags || [];
            return tags.some(tag => badge.pubkey === pubkey && tag[0] === 'd' && tag[1] === slug);
        });

        return badge;
    }

    putBadgeDefinition(badge: NostrEvent): void {
        if (badge.kind === kinds.BadgeDefinition) {
            this.badgeDefinitions.update(badges => {
                const index = badges.findIndex(b => b.id === badge.id);
                if (index !== -1) {
                    badges[index] = badge;
                } else {
                    badges.push(badge);
                }
                return badges;
            });
        }
    }
}