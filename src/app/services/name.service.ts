import { Injectable, inject, signal } from '@angular/core';
import { routes } from '../app.routes';
import { Route } from '@angular/router';
import { AccountService } from '../api/services';
import { catchError, map, Observable, of, tap, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NameService {
  // Reserved route paths extracted from app.routes.ts
  private readonly reservedPaths = signal<string[]>(this.extractReservedPathsFromRoutes());

  private accountService = inject(AccountService)
  
  // Bad words that are not allowed as usernames
  private readonly badWords = signal<string[]>([
    'admin', 'root', 'moderator', 'system', 'support', 
    'help', 'official', 'mod', 'nostria'
  ]);
  
  /**
   * Extract all top-level route paths from the routes configuration
   * @returns Array of reserved path strings
   */
  private extractReservedPathsFromRoutes(): string[] {
    const reservedPaths = new Set<string>();
    
    // Helper function to recursively extract paths from routes
    const extractPaths = (routeList: Route[], parentPath: string = '') => {
      routeList.forEach(route => {
        // Skip wildcard route
        if (route.path === '**') return;
        
        // Get the current path
        const path = route.path || '';
        
        // Skip route parameter paths (those with : in them)
        if (path && !path.includes(':')) {
          // Combine parent path with current path if needed
          const fullPath = parentPath ? 
            `${parentPath}/${path}`.replace(/\/\//g, '/') : path;
          
          // Add the path to our set (avoid duplicates)
          reservedPaths.add(fullPath);
          
          // Also add the path segments individually
          if (fullPath.includes('/')) {
            const segments = fullPath.split('/');
            segments.forEach(segment => {
              if (segment) reservedPaths.add(segment);
            });
          }
        }
        
        // Recursively process child routes if they exist
        if (route.children) {
          const newParentPath = path ? 
            (parentPath ? `${parentPath}/${path}` : path) : parentPath;
          extractPaths(route.children, newParentPath);
        }
      });
    };
    
    // Start extraction from the root routes
    extractPaths(routes);
    
    // Add additional known reserved paths
    const additionalPaths = ['api', 'auth', 'feed', 'explore', 'search', 'trending', 'tag', 'hashtag'];
    additionalPaths.forEach(path => reservedPaths.add(path));
    
    return Array.from(reservedPaths).filter(path => path.length > 0);
  }
  
  /**
   * Validates a username against reserved paths and bad words
   * @param username The username to validate
   * @returns An object containing validation result and optional error message
   */
  validateUsername(username: string): { isValid: boolean; error?: string } {
    if (!username) {
      return { isValid: false, error: 'Username cannot be empty' };
    }
    
    // Clean the username for comparison (lowercase, trim)
    const cleanUsername = username.toLowerCase().trim();
    
    // Check if username is too short
    if (cleanUsername.length < 3) {
      return { isValid: false, error: 'Username must be at least 3 characters' };
    }
    
    // Check against reserved paths
    if (this.reservedPaths().includes(cleanUsername)) {
      return { isValid: false, error: 'This username is reserved' };
    }
    
    // Check against bad words
    if (this.badWords().some(word => cleanUsername.includes(word))) {
      return { isValid: false, error: 'This username contains inappropriate content' };
    }
    
    // Add additional validation rules here if needed
    // For example, only allow alphanumeric characters and underscores
    if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      return { isValid: false, error: 'Username can only contain letters, numbers, and underscores' };
    }
    
    return { isValid: true };
  }
  
  /**
   * Checks if a username is available:
   * - not reserved
   * - doesn't contain bad words
   * - is not taken by other account
   * @param username The username to check
   * @returns A boolean indicating whether the username is available
   */
  isUsernameAvailable(username: string): Observable<boolean> {
    const isValid = this.validateUsername(username).isValid;
    if (!isValid) return of(false);

    // check if we have account with such username
    return this.accountService.getPublicAccount({ pubkeyOrUsername: username }).pipe(
      map(() => false),
      catchError(err => {
        if (err.status === 404) {
          return of(true);
        }
        console.error(err);
        return of(false);
      })
    );
  }
  
  /**
   * Gets all reserved paths that cannot be used as usernames
   * @returns Array of reserved path strings
   */
  getReservedPaths(): string[] {
    return this.reservedPaths();
  }
}
