export interface Memo {
  id: string; // Unique identifier for the note
  content: string;
  color: string;
  createdAt: number; // Unix timestamp in seconds
  updatedAt: number; // Unix timestamp in seconds
}

export interface MemoBackup {
  id: string;
  timestamp: number;
  memos: Memo[];
}
