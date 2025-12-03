export interface TimelineFilterOptions {
  showNotes: boolean; // Kind 1: Short text notes
  showReposts: boolean; // Kind 6, 16: Reposts and Generic Reposts
  showReplies: boolean; // Kind 1 notes that are replies
  showReactions: boolean; // Kind 7: Reactions (optional, for future)
  showAudio: boolean; // Kind 1222, 1244: Audio clips
  showVideo: boolean; // Kind 21, 22, 34235, 34236: Video clips
}

export const DEFAULT_TIMELINE_FILTER: TimelineFilterOptions = {
  showNotes: true,
  showReposts: true,
  showReplies: false,
  showReactions: false,
  showAudio: true,
  showVideo: true,
};
