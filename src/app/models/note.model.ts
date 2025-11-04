export interface Note {
  id: string; // Unique identifier for the note
  content: string;
  color: string;
  createdAt: number; // Unix timestamp in seconds
  updatedAt: number; // Unix timestamp in seconds
}
