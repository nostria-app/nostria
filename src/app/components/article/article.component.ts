import { Component, inject, input, signal, effect } from '@angular/core';
import { DataService } from '../../services/data.service';
import { Event, nip19 } from 'nostr-tools';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { LayoutService } from '../../services/layout.service';
import { UserDataFactoryService } from '../../services/user-data-factory.service';

@Component({
  selector: 'app-article',
  imports: [UserProfileComponent],
  templateUrl: './article.component.html',
  styleUrl: './article.component.scss',
})
export class ArticleComponent {
  slug = input.required<string>();
  pubkey = input.required<string>();
  kind = input.required<number>();

  data = inject(DataService);
  record = signal<NostrRecord | null>(null);
  layout = inject(LayoutService);
  loading = signal<boolean>(false);

  dataFactory = inject(UserDataFactoryService);

  constructor() {
    effect(async () => {
      if (this.pubkey() && this.slug() && this.kind()) {
        this.loading.set(true);

        const dataService = await this.dataFactory.create(this.pubkey());

        const eventData =
          await dataService.getEventByPubkeyAndKindAndReplaceableEvent(
            this.pubkey(),
            this.kind(),
            this.slug(),
            undefined
          );
        this.record.set(eventData);
        this.loading.set(false);
      }
    });
  }

  openArticle(): void {
    const naddr = nip19.naddrEncode({
      identifier: this.slug(),
      pubkey: this.pubkey(),
      kind: this.kind(),
    });

    this.layout.openArticle(naddr, this.record()?.event);
  }
}
