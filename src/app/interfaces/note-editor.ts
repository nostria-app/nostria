import type { Event as NostrEvent } from 'nostr-tools';

/**
 * Data passed to the NoteEditorDialogComponent
 * Extracted to a separate file to avoid circular dependencies
 */
export interface NoteEditorDialogData {
  replyTo?: {
    id: string;
    pubkey: string;
    rootId?: string | null;
    event?: NostrEvent;
    mentions?: string[]; // Pubkeys mentioned in the parent event
  };
  quote?: {
    id: string;
    pubkey: string;
    content?: string;
    kind?: number;
    relays?: string[];
  };
  mentions?: string[]; // Array of pubkeys to mention
  content?: string; // Initial content
  files?: File[]; // Initial files
  /**
   * NIP-41: Edit mode - the original event being edited
   * When set, the dialog will publish a kind:1010 edit event instead of a new kind:1
   */
  editEvent?: NostrEvent;
}
