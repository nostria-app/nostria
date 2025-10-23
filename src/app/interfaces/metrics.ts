export interface UserMetric {
  accountPubkey: string; // The account that recorded these metrics
  pubkey: string; // The user being tracked
  // Profile engagement metrics
  viewed: number; // Number of times profile has been viewed
  profileClicks: number; // Number of times profile link was clicked

  // Content engagement metrics
  liked: number; // Number of posts we have liked by this author
  read: number; // Number of articles by author we have read
  replied: number; // Number of times we replied to this author
  reposted: number; // Number of times we reposted this author's content
  quoted: number; // Number of times we quoted this author

  // Interaction metrics
  messaged: number; // Number of direct messages sent to this author
  mentioned: number; // Number of times we mentioned this author

  // Time-based metrics
  timeSpent: number; // Total time spent viewing this author's content (in seconds)
  lastInteraction: number; // Timestamp of last interaction with this author

  // Derived metrics (can be calculated)
  averageTimePerView?: number; // timeSpent / viewed
  engagementScore?: number; // Calculated engagement score

  // Metadata
  firstInteraction: number; // Timestamp of first interaction
  updated: number; // Timestamp of last update
}

export interface MetricUpdate {
  accountPubkey?: string; // Optional: if not provided, will use current account
  pubkey: string;
  metric: keyof Omit<
    UserMetric,
    'pubkey' | 'accountPubkey' | 'updated' | 'firstInteraction' | 'averageTimePerView' | 'engagementScore'
  >;
  increment?: number; // Amount to increment (default: 1)
  value?: number; // Absolute value to set
  timestamp?: number; // Timestamp for the update (default: Date.now())
}

export interface MetricQuery {
  accountPubkey?: string; // Optional: filter by account
  pubkey?: string;
  minViewed?: number;
  minLiked?: number;
  minEngagementScore?: number;
  sortBy?: keyof UserMetric;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}
