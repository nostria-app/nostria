/**
 * Utility functions for cleaning tracking parameters from URLs
 */

/**
 * Common tracking parameters used by various platforms
 * These parameters are typically used for analytics and should be removed for privacy
 */
const TRACKING_PARAMETERS = [
  // Google Analytics and Google Ads
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  
  // Facebook/Meta
  'fbclid',
  'fb_action_ids',
  'fb_action_types',
  'fb_source',
  'fb_ref',
  
  // Twitter/X
  'twclid',
  's',
  't',
  
  // Microsoft
  'msclkid',
  
  // Mailchimp
  'mc_cid',
  'mc_eid',
  
  // HubSpot
  '_hsenc',
  '_hsmi',
  'hsCtaTracking',
  
  // Marketo
  'mkt_tok',
  
  // Adobe
  'icid',
  
  // Yandex
  'yclid',
  
  // TikTok
  'ttclid',
  
  // LinkedIn
  'li_fat_id',
  'trk',
  
  // Instagram
  'igshid',
  'igsh',
  
  // YouTube
  'si',
  'feature',
  
  // Generic tracking parameters
  'ref',
  'source',
  'campaign_id',
  'ad_id',
  'ad_name',
  'adgroup_id',
  'campaign_name',
  'creative',
  'keyword',
  'matchtype',
  'network',
  'device',
  'devicemodel',
  'placement',
  'target',
  'campaign',
  'content',
  'medium',
  'term',
];

/**
 * Remove tracking parameters from a URL
 * @param url The URL to clean
 * @returns The cleaned URL without tracking parameters
 */
export function removeTrackingParameters(url: string): string {
  try {
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);
    
    // Track if any parameters were removed
    let hasChanges = false;
    
    // Remove tracking parameters
    TRACKING_PARAMETERS.forEach(param => {
      if (params.has(param)) {
        params.delete(param);
        hasChanges = true;
      }
    });
    
    // Only modify the URL if we actually removed something
    if (hasChanges) {
      urlObj.search = params.toString();
    }
    
    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, return the original URL
    console.warn('Failed to parse URL for tracking parameter removal:', error);
    return url;
  }
}

/**
 * Clean tracking parameters from all URLs in a text string
 * @param text The text containing URLs
 * @returns The text with cleaned URLs
 */
export function cleanTrackingParametersFromText(text: string): string {
  // Regular expression to match URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  
  return text.replace(urlRegex, (match) => {
    return removeTrackingParameters(match);
  });
}

/**
 * Check if a URL contains tracking parameters
 * @param url The URL to check
 * @returns True if the URL contains tracking parameters
 */
export function hasTrackingParameters(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);
    
    return TRACKING_PARAMETERS.some(param => params.has(param));
  } catch (error) {
    return false;
  }
}
