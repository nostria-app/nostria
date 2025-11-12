export interface TimelineFilterOptions {
  showNotes: boolean; // Kind 1: Short text notes
  showReposts: boolean; // Kind 6, 16: Reposts and Generic Reposts
  showReplies: boolean; // Kind 1 notes that are replies
  showReactions: boolean; // Kind 7: Reactions (optional, for future)
}

export const DEFAULT_TIMELINE_FILTER: TimelineFilterOptions = {
  showNotes: true,
  showReposts: true,
  showReplies: true,
  showReactions: false,
};
