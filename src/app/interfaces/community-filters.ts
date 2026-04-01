export interface CommunityListFilters {
  joinedOnly: boolean;
  hasImage: boolean;
  hasRules: boolean;
}

export type CommunitySortOption = 'default' | 'name-asc' | 'name-desc' | 'oldest';

export const DEFAULT_COMMUNITY_LIST_FILTERS: CommunityListFilters = {
  joinedOnly: false,
  hasImage: false,
  hasRules: false,
};
