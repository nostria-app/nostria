/**
 * Panel type for two-column layout routing
 * 
 * LIST: Components that display lists/feeds/timelines - render in LEFT panel
 *       Examples: Profile, Music, Summary, Collections, Search, Interests
 * 
 * CONTENT: Components that display individual items - render in RIGHT panel
 *          Examples: Article, Event, Song, Playlist, Badge Details
 */
export type PanelType = 'list' | 'content';

/**
 * Route data interface for panel-aware routing
 * Add this to route data to specify which panel a component should render in
 */
export interface PanelRouteData {
  /** The panel type determines which outlet renders the component */
  panelType: PanelType;
  /** Optional: Title for the panel header */
  panelTitle?: string;
}

/**
 * Extended route data with panel information
 */
export interface RouteDataWithPanel {
  panelType?: PanelType;
  panelTitle?: string;
  isRoot?: boolean;
  [key: string]: any;
}
