export type NotificationType = 'mention' | 'reaction' | 'repost' | 'follow';

export interface Notification {
  id: string;
  type: NotificationType;
  sender: string;
  senderPubkey: string;
  content: string | null;
  noteId?: string;
  timestamp: number;
  read: boolean;
}
