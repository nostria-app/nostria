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
      <!-- Note: Header is handled by app.html's right panel header -->
      <!-- This component only renders dynamic content -->
      
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
    
    .panel-content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
      min-height: 0; // Important for flex children to allow shrinking
    }
    
    // Ensure dynamically inserted components fill the panel content
    // No padding-top by default - components either have their own sticky header
    // or the content should start at the top
    .panel-content ::ng-deep > * {
      display: block;
      min-height: 100%;
    }
    
    // Hide inactive components but keep them in DOM
    .panel-content ::ng-deep .panel-item-hidden {
      display: none !important;
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
