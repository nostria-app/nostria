import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AiChatHistoryService } from '../../../services/ai-chat-history.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';

@Component({
  selector: 'app-ai-history-detail',
  imports: [
    CommonModule,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './history-detail.component.html',
  styleUrl: './history-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
})
export class AiHistoryDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly historyService = inject(AiChatHistoryService);
  private readonly panelNav = inject(PanelNavigationService);

  readonly historyId = computed(() => this.route.snapshot.paramMap.get('id') ?? '');
  readonly history = computed(() => this.historyService.getHistory(this.historyId()));
  readonly isInRightPanel = this.route.outlet === 'right';

  goBack(): void {
    if (this.isInRightPanel) {
      this.panelNav.goBackRight();
    }
  }

  deleteCurrentHistory(): void {
    const id = this.historyId();
    if (!id) {
      return;
    }

    this.historyService.deleteHistory(id);
    if (this.isInRightPanel) {
      this.panelNav.goBackRight();
    }
  }
}