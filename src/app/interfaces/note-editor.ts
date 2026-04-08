import type { Event as NostrEvent } from 'nostr-tools';

/**
 * Data passed to the NoteEditorDialogComponent
 * Extracted to a separate file to avoid circular dependencies
 */
export interface NoteEditorDialogData {
  dialogTitle?: string;
  dialogHeaderIcon?: string;
  /**
   * When false, do not navigate to the newly published event after publish succeeds.
   * Useful in thread views where the user should stay in-context.
   */
  navigateOnPublish?: boolean;
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
    identifier?: string;
    relays?: string[];
    /** NIP-40: Expiration timestamp (in seconds) from the quoted event, if still active */
    expiration?: number;
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
