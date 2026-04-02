import { Injectable, inject } from '@angular/core';
import { Event, UnsignedEvent } from 'nostr-tools';
import { CustomDialogService } from './custom-dialog.service';
import {
  DeleteConfirmationDialogComponent,
  DeleteConfirmationDialogData,
  DeleteConfirmationResult,
  DeleteEventReferenceMode,
} from '../components/delete-confirmation-dialog/delete-confirmation-dialog.component';

export interface DeleteEventTarget {
  event?: Event;
  title: string;
  entityLabel?: string;
  confirmText?: string;
}

export interface DeleteCoordinateTarget {
  id: string;
  kind: number;
  pubkey: string;
  identifier?: string;
}

@Injectable({
  providedIn: 'root',
})
export class DeleteEventService {
  private readonly customDialog = inject(CustomDialogService);

  async confirmDeletion(target: DeleteEventTarget): Promise<DeleteConfirmationResult | null> {
    const dialogRef = this.customDialog.open<DeleteConfirmationDialogComponent, DeleteConfirmationResult>(
      DeleteConfirmationDialogComponent,
      {
        data: {
          title: target.title,
          entityLabel: target.entityLabel,
          confirmText: target.confirmText,
          event: target.event,
        } satisfies DeleteConfirmationDialogData,
        width: '520px',
        maxWidth: '92vw',
        panelClass: 'delete-confirmation-dialog',
      }
    );

    const result = await new Promise<DeleteConfirmationResult | undefined>((resolve) => {
      dialogRef.afterClosed$.subscribe(closeResult => resolve(closeResult.result));
    });

    if (!result?.confirmed) {
      return null;
    }

    return result;
  }

  createDeletionTags(event: Event, referenceMode: DeleteEventReferenceMode = 'e'): string[][] {
    const tags: string[][] = [];
    const dTag = event.tags.find(tag => tag[0] === 'd' && tag[1]?.trim())?.[1]?.trim();

    if (referenceMode === 'a' && dTag) {
      tags.push(['a', `${event.kind}:${event.pubkey}:${dTag}`]);
    } else {
      tags.push(['e', event.id]);
    }

    tags.push(['k', String(event.kind)]);
    return tags;
  }

  createRetractionEvent(
    createEvent: (kind: number, content: string, tags: string[][]) => UnsignedEvent,
    event: Event,
    referenceMode: DeleteEventReferenceMode = 'e',
    content = ''
  ): UnsignedEvent {
    return createEvent(5, content, this.createDeletionTags(event, referenceMode));
  }

  createDeletionTagsForCoordinate(
    target: DeleteCoordinateTarget,
    referenceMode: DeleteEventReferenceMode = 'e'
  ): string[][] {
    const tags: string[][] = [];

    if (referenceMode === 'a' && target.identifier) {
      tags.push(['a', `${target.kind}:${target.pubkey}:${target.identifier}`]);
    } else {
      tags.push(['e', target.id]);
    }

    tags.push(['k', String(target.kind)]);
    return tags;
  }
}
