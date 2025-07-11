/* tslint:disable */
/* eslint-disable */
/* Code generated by ng-openapi-gen DO NOT EDIT. */

export interface ServiceStatus {

  /**
   * Runtime environment
   */
  environment?: 'development' | 'staging' | 'production';

  /**
   * Public VAPID key for Web Push
   */
  key?: string;

  /**
   * Service name
   */
  service?: string;

  /**
   * System information (deprecated - will be removed for security)
   */
  system?: {

/**
 * Operating system platform
 */
'platform'?: string;

/**
 * System architecture
 */
'arch'?: string;
'memory'?: {

/**
 * Total system memory
 */
'total'?: string;

/**
 * Available system memory
 */
'free'?: string;
};
};

  /**
   * Current server timestamp
   */
  timestamp?: number;

  /**
   * Service uptime in seconds
   */
  uptime?: number;

  /**
   * Service version
   */
  version?: string;
}
