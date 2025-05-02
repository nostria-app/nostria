import { inject, Injectable, signal } from "@angular/core";
import { StorageService } from "./storage.service";
import { NostrService } from "./nostr.service";
import { RelayService } from "./relay.service";
import { NostrEvent } from "../interfaces";

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private readonly storage = inject(StorageService);
    private readonly nost = inject(NostrService);
    private readonly relay = inject(RelayService);

    /** Will read event from local database, if available, or get from relay, and then save to database. */
    async getEventByPubkeyAndKind(pubkey: string | string[], kind: number): Promise<NostrEvent | null> {
        let event = await this.storage.getEventByPubkeyAndKind(pubkey, kind);

        if (event) {

            return event;
        }

        event = await this.relay.getEventByPubkeyAndKind(pubkey, kind);

        if (event) {
            this.storage.saveEvent(event);
            return event;
        }

        return null;
    }

}