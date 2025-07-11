import { Component, OnInit, OnDestroy, Renderer2, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { NavigationHistoryItem, RouteDataService } from '../../services/route-data.service';
import { DOCUMENT } from '@angular/common';

@Component({
  selector: 'app-navigation-context-menu',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './navigation-context-menu.component.html',
  styleUrl: './navigation-context-menu.component.scss'
})
export class NavigationContextMenuComponent implements OnInit, OnDestroy {
  private renderer = inject(Renderer2);
  private document = inject(DOCUMENT);
  private routeDataService = inject(RouteDataService);
  
  // Menu state
  isVisible = signal<boolean>(false);
  menuPosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  
  // Callback for item selection
  private onItemSelected: ((index: number) => void) | null = null;

  ngOnInit() {
    // Listen for the custom event from navigation component
    window.addEventListener('show-navigation-context-menu', this.handleShowContextMenu.bind(this));
    
    // Close menu when clicking outside
    this.document.addEventListener('click', this.closeMenu.bind(this));
  }

  ngOnDestroy() {
    window.removeEventListener('show-navigation-context-menu', this.handleShowContextMenu.bind(this));
    this.document.removeEventListener('click', this.closeMenu.bind(this));
  }

  private handleShowContextMenu(event: Event) {
    const customEvent = event as CustomEvent;
    const { x, y, onItemSelected } = customEvent.detail;
    
    this.showMenu(x, y, onItemSelected);
  }

  onClearHistory() {
    // Clear navigation history but keep the current page
    const currentHistory = this.routeDataService.navigationHistory();
    if (currentHistory.length > 0) {
      // Keep only the current page (last item in history)
      const currentPage = currentHistory[currentHistory.length - 1];
      this.routeDataService.navigationHistory.set([currentPage]);
    }
  }

  showMenu(x: number, y: number, onItemSelected: (index: number) => void) {
    // Get history from the service
    const history = this.routeDataService.navigationHistory();
    
    // Calculate optimal menu position
    const menuWidth = 250;
    const menuHeight = Math.min(300, (history.length - 1) * 50 + 60);
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    
    // Adjust horizontal position if menu would go off-screen
    if (x + menuWidth > viewport.width) {
      x = viewport.width - menuWidth - 8;
    }
    
    // Adjust vertical position if menu would go off-screen
    if (y + menuHeight > viewport.height) {
      y = viewport.height - menuHeight - 8;
    }
    
    // Ensure minimum distance from edges
    x = Math.max(8, x);
    y = Math.max(8, y);
    
    this.menuPosition.set({ x, y });
    this.onItemSelected = onItemSelected;
    this.isVisible.set(true);
  }

  closeMenu(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.isVisible.set(false);
    this.onItemSelected = null;
  }

  selectItem(index: number) {
    // Get display items (excluding current page)
    const displayItems = this.getDisplayItems();
    
    // Convert back to original index 
    // Display items are reversed, so we need to account for that
    const originalIndex = displayItems.length - 1 - index;
    
    if (this.onItemSelected && originalIndex >= 0) {
      this.onItemSelected(originalIndex);
    }
    
    this.closeMenu();
  }

  // Get history items excluding the current page
  getDisplayItems() {
    const items = this.routeDataService.navigationHistory();
    // Return all items except the last one (current page), reversed
    return items.slice(0, -1).reverse();
  }
}
