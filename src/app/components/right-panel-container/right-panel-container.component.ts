import {
  Component,
  inject,
  ViewContainerRef,
  viewChild,
  effect,
  ChangeDetectionStrategy,
  ComponentRef,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RightPanelService, RightPanelEntry } from '../../services/right-panel.service';

/**
 * Container component for the right panel that dynamically loads
 * components based on the RightPanelService state.
 * 
 * Components are kept alive in the DOM and shown/hidden based on
 * which entry is active. This preserves scroll position and state
 * when navigating back.
 */
@Component({
  selector: 'app-right-panel-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
  ],
  template: `
    <div class="right-panel-wrapper" [class.has-content]="rightPanel.hasContent()">
      @if (rightPanel.hasContent()) {
      <div class="panel-header">
        @if (rightPanel.canGoBack()) {
        <button mat-icon-button (click)="rightPanel.goBack()" class="nav-button back-button" 
                matTooltip="Go back" i18n-matTooltip="@@app.nav.back">
          <mat-icon>arrow_back</mat-icon>
        </button>
        }
        <span>{{ rightPanel.title() }}</span>
        <span class="spacer"></span>
        <button mat-icon-button (click)="rightPanel.close()" class="nav-button close-button"
                matTooltip="Close" i18n-matTooltip="@@app.nav.close">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      }
      
      <!-- Dynamic component container -->
      <div class="panel-content" #panelContent>
        <ng-template #container></ng-template>
      </div>
    </div>
  `,
  styles: [`
    .right-panel-wrapper {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    
    .panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      position: sticky;
      top: var(--toolbar-height, 64px);
      z-index: 201;
      border-radius: 24px;
      height: 48px;
      margin: 8px 16px;
      pointer-events: auto;
      flex-shrink: 0;
      
      // Glass effect - light mode
      background-color: rgba(255, 255, 255, 0.7);
      -webkit-backdrop-filter: blur(20px) saturate(1.8);
      backdrop-filter: blur(20px) saturate(1.8);
      
      box-shadow: 
        inset 0 0 0 1px rgba(255, 255, 255, 0.5),
        inset 0 0 8px 2px rgba(255, 255, 255, 0.2),
        0px 2px 8px rgba(17, 17, 26, 0.08),
        0px 4px 16px rgba(17, 17, 26, 0.06);
    }
    
    :host-context(.dark) .panel-header {
      background-color: rgba(0, 0, 0, 0.4);
      
      box-shadow:
        inset 0 0 0 1px rgba(255, 255, 255, 0.15),
        inset 0 0 8px 2px rgba(255, 255, 255, 0.05),
        0px 2px 8px rgba(0, 0, 0, 0.3),
        0px 4px 16px rgba(0, 0, 0, 0.25);
    }
    
    .nav-button {
      flex-shrink: 0;
    }
    
    span {
      font-size: 1rem;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .spacer {
      flex: 1;
    }
    
    .panel-content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding-top: var(--toolbar-height, 64px);
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
      min-height: 0; // Important for flex children to allow shrinking
    }
    
    // Ensure dynamically inserted components fill the panel content
    .panel-content ::ng-deep > * {
      display: block;
      min-height: 100%;
    }
    
    // Hide inactive components but keep them in DOM
    .panel-content ::ng-deep .panel-item-hidden {
      display: none !important;
    }
    
    // When there's content, the header is shown so reduce top padding
    .right-panel-wrapper.has-content .panel-content {
      padding-top: 0;
    }
  `]
})
export class RightPanelContainerComponent implements AfterViewInit {
  readonly rightPanel = inject(RightPanelService);

  // ViewContainerRef for dynamically creating components
  private readonly container = viewChild('container', { read: ViewContainerRef });
  private readonly panelContent = viewChild<ElementRef>('panelContent');

  // Track created component refs by their stack index
  private componentRefs = new Map<number, ComponentRef<any>>();

  // Track the previous active index to manage visibility
  private previousActiveIndex = -1;

  // Track which entries have been created
  private createdEntryIndices = new Set<number>();

  ngAfterViewInit(): void {
    // Initial setup handled by effect
  }

  constructor() {
    // React to changes in entries and active index
    effect(() => {
      const entries = this.rightPanel.allEntries();
      const activeIndex = this.rightPanel.activeIndex();
      const containerRef = this.container();

      if (!containerRef) {
        return;
      }

      // Create components for new entries that don't have one yet
      for (let i = 0; i < entries.length; i++) {
        if (!this.createdEntryIndices.has(i)) {
          this.createComponentForEntry(i, entries[i], containerRef);
        }
      }

      // Update visibility of all components
      this.updateComponentVisibility(activeIndex);

      // Restore scroll position if going back
      if (activeIndex < this.previousActiveIndex && activeIndex >= 0) {
        const entry = entries[activeIndex];
        if (entry?.scrollPosition !== undefined) {
          setTimeout(() => {
            const content = this.panelContent()?.nativeElement;
            if (content) {
              content.scrollTop = entry.scrollPosition;
            }
          }, 0);
        }
      }

      // Clean up components for removed entries
      this.cleanupRemovedEntries(entries.length);

      this.previousActiveIndex = activeIndex;
    });
  }

  private createComponentForEntry(index: number, entry: RightPanelEntry, containerRef: ViewContainerRef): void {
    const componentRef = containerRef.createComponent(entry.config.component);

    // Set inputs if provided
    if (entry.config.inputs) {
      for (const [key, value] of Object.entries(entry.config.inputs)) {
        componentRef.setInput(key, value);
      }
    }

    // Store the reference
    this.componentRefs.set(index, componentRef);
    this.createdEntryIndices.add(index);

    // Save ref in the service
    this.rightPanel.setComponentRef(index, componentRef);
  }

  private updateComponentVisibility(activeIndex: number): void {
    for (const [index, ref] of this.componentRefs) {
      const hostElement = ref.location.nativeElement as HTMLElement;
      if (index === activeIndex) {
        hostElement.classList.remove('panel-item-hidden');
      } else {
        hostElement.classList.add('panel-item-hidden');
      }
    }
  }

  private cleanupRemovedEntries(currentLength: number): void {
    // Remove component refs for indices that no longer exist
    for (const [index, ref] of this.componentRefs) {
      if (index >= currentLength) {
        ref.destroy();
        this.componentRefs.delete(index);
        this.createdEntryIndices.delete(index);
      }
    }
  }
}
