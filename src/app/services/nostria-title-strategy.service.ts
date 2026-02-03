import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/**
 * Custom TitleStrategy that prepends "Nostria – " to all page titles
 * 
 * This ensures consistent branding in browser tabs while keeping
 * the route-defined titles simple (e.g., "Music" becomes "Nostria – Music").
 */
@Injectable({ providedIn: 'root' })
export class NostriaTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(routerState: RouterStateSnapshot): void {
    const title = this.buildTitle(routerState);
    if (title !== undefined) {
      this.title.setTitle(`Nostria – ${title}`);
    } else {
      // Default title when no route title is defined
      this.title.setTitle('Nostria');
    }
  }
}
