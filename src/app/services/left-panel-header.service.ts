import { Injectable, signal, TemplateRef } from '@angular/core';

/**
 * Service to manage the left panel header content.
 * 
 * Components rendered in the left panel can use this service to provide
 * their header content (title, buttons, menus) which will be rendered
 * at the app level - directly inside .left-panel before .panel-content-wrapper.
 * 
 * This ensures the header is a direct child of the scroll container,
 * making position: sticky work reliably.
 */
@Injectable({
  providedIn: 'root'
})
export class LeftPanelHeaderService {
  // Template for the header content
  private _headerTemplate = signal<TemplateRef<unknown> | null>(null);
  headerTemplate = this._headerTemplate.asReadonly();

  // Simple title (used when no template is provided)
  private _title = signal<string>('');
  title = this._title.asReadonly();

  // Whether to show the back button
  private _showBackButton = signal<boolean>(true);
  showBackButton = this._showBackButton.asReadonly();

  // Back button click handler
  private _onBackClick = signal<(() => void) | null>(null);
  onBackClick = this._onBackClick.asReadonly();

  /**
   * Set the header template for the left panel.
   * The template will be rendered at the app level for proper sticky behavior.
   * 
   * @param template TemplateRef containing the header content
   */
  setHeaderTemplate(template: TemplateRef<unknown> | null): void {
    this._headerTemplate.set(template);
  }

  /**
   * Set a simple title (alternative to full template)
   */
  setTitle(title: string): void {
    this._title.set(title);
  }

  /**
   * Set whether to show the back button
   */
  setShowBackButton(show: boolean): void {
    this._showBackButton.set(show);
  }

  /**
   * Set the back button click handler
   */
  setOnBackClick(handler: (() => void) | null): void {
    this._onBackClick.set(handler);
  }

  /**
   * Clear all header state (call on component destroy)
   */
  clear(): void {
    this._headerTemplate.set(null);
    this._title.set('');
    this._showBackButton.set(true);
    this._onBackClick.set(null);
  }
}
