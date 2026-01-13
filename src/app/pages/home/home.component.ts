import { Component, inject, computed, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { FeedsComponent } from '../feeds/feeds.component';
import { EventPageComponent } from '../event/event.component';
import { ProfileComponent } from '../profile/profile.component';
import { NavigationStackService, NavigationItem } from '../../services/navigation-stack.service';
import { LayoutService } from '../../services/layout.service';
import { ApplicationService } from '../../services/application.service';

@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    FeedsComponent,
    EventPageComponent,
    ProfileComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  private navigationStack = inject(NavigationStackService);
  private router = inject(Router);
  private layout = inject(LayoutService);
  protected app = inject(ApplicationService);

  // Track screen width for responsive behavior
  screenWidth = signal(typeof window !== 'undefined' ? window.innerWidth : 1024);

  // Header hidden state for scroll behavior
  contentHeaderHidden = signal(false);
  private lastScrollTop = 0;

  // Computed signals from navigation stack
  hasNavigatedItems = computed(() => this.navigationStack.hasItems());
  hasMultipleItems = computed(() => this.navigationStack.hasMultipleItems());
  currentItem = computed(() => this.navigationStack.currentItem());

  // Feed collapsed state from layout service
  feedCollapsed = computed(() => this.layout.feedCollapsed());

  // Mobile breakpoint
  isMobile = computed(() => this.screenWidth() < 1024);

  // Show feed or content on mobile
  showFeedOnMobile = computed(() => {
    const mobile = this.isMobile();
    const hasItems = this.hasNavigatedItems();
    // On mobile, show feed when there are no navigated items
    return mobile && !hasItems;
  });

  showContentOnMobile = computed(() => {
    const mobile = this.isMobile();
    const hasItems = this.hasNavigatedItems();
    // On mobile, show content when there are navigated items
    return mobile && hasItems;
  });

  constructor() {
    // Set up resize listener for responsive behavior
    if (typeof window !== 'undefined') {
      effect(() => {
        const handleResize = () => {
          this.screenWidth.set(window.innerWidth);
        };

        window.addEventListener('resize', handleResize);
        return () => {
          window.removeEventListener('resize', handleResize);
        };
      });
    }
  }

  /**
   * Go back to the previous item in the navigation stack
   */
  goBack() {
    this.navigationStack.pop();
  }

  /**
   * Close the current view and return to the feed
   */
  close() {
    this.navigationStack.clear();
  }

  /**
   * Get the appropriate title for the navigation bar
   */
  getNavigationTitle(): string {
    const item = this.currentItem();
    if (!item) return '';

    if (item.type === 'event') {
      return 'Event';
    } else {
      return 'Profile';
    }
  }

  /**
   * Called when content area scrolls - handles header hide/show
   */
  onContentScroll(event: Event): void {
    const container = event.target as HTMLElement;
    const scrollTop = container.scrollTop;
    const scrollDelta = scrollTop - this.lastScrollTop;

    // Scrolling down - hide header after scrolling down past threshold
    if (scrollDelta > 10 && scrollTop > 100) {
      this.contentHeaderHidden.set(true);
    }
    // Scrolling up - show header immediately
    else if (scrollDelta < -10) {
      this.contentHeaderHidden.set(false);
    }
    // At the very top - always show header
    else if (scrollTop <= 50) {
      this.contentHeaderHidden.set(false);
    }

    this.lastScrollTop = scrollTop;
  }
}
