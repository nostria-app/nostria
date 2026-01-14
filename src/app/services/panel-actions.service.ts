import { Injectable, signal, TemplateRef } from '@angular/core';

export interface PanelAction {
  id: string;
  icon: string;
  label: string;
  tooltip?: string;
  action: () => void;
  disabled?: boolean;
  menu?: boolean; // If true, this is a menu trigger (like "...")
}

/**
 * Service to manage dynamic actions in panel headers.
 * Components can register their actions to be displayed in the glass toolbar.
 */
@Injectable({
  providedIn: 'root'
})
export class PanelActionsService {
  // Actions for left panel header
  private _leftPanelActions = signal<PanelAction[]>([]);
  leftPanelActions = this._leftPanelActions.asReadonly();

  // Actions for right panel header
  private _rightPanelActions = signal<PanelAction[]>([]);
  rightPanelActions = this._rightPanelActions.asReadonly();

  // Template refs for custom menu content (for "..." menus)
  private _leftPanelMenuTemplate = signal<TemplateRef<unknown> | null>(null);
  leftPanelMenuTemplate = this._leftPanelMenuTemplate.asReadonly();

  private _rightPanelMenuTemplate = signal<TemplateRef<unknown> | null>(null);
  rightPanelMenuTemplate = this._rightPanelMenuTemplate.asReadonly();

  /**
   * Set actions for the left panel header
   */
  setLeftPanelActions(actions: PanelAction[]): void {
    this._leftPanelActions.set(actions);
  }

  /**
   * Set actions for the right panel header
   */
  setRightPanelActions(actions: PanelAction[]): void {
    this._rightPanelActions.set(actions);
  }

  /**
   * Set custom menu template for left panel
   */
  setLeftPanelMenuTemplate(template: TemplateRef<unknown> | null): void {
    this._leftPanelMenuTemplate.set(template);
  }

  /**
   * Set custom menu template for right panel
   */
  setRightPanelMenuTemplate(template: TemplateRef<unknown> | null): void {
    this._rightPanelMenuTemplate.set(template);
  }

  /**
   * Clear left panel actions (call on component destroy)
   */
  clearLeftPanelActions(): void {
    this._leftPanelActions.set([]);
    this._leftPanelMenuTemplate.set(null);
  }

  /**
   * Clear right panel actions (call on component destroy)
   */
  clearRightPanelActions(): void {
    this._rightPanelActions.set([]);
    this._rightPanelMenuTemplate.set(null);
  }

  /**
   * Add a single action to left panel
   */
  addLeftPanelAction(action: PanelAction): void {
    this._leftPanelActions.update(actions => [...actions, action]);
  }

  /**
   * Add a single action to right panel
   */
  addRightPanelAction(action: PanelAction): void {
    this._rightPanelActions.update(actions => [...actions, action]);
  }

  /**
   * Remove an action by id from left panel
   */
  removeLeftPanelAction(id: string): void {
    this._leftPanelActions.update(actions => actions.filter(a => a.id !== id));
  }

  /**
   * Remove an action by id from right panel
   */
  removeRightPanelAction(id: string): void {
    this._rightPanelActions.update(actions => actions.filter(a => a.id !== id));
  }
}
