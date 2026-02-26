import { Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-hidden-chat-info-prompt',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './hidden-chat-info-prompt.component.html',
  styleUrl: './hidden-chat-info-prompt.component.scss',
})
export class HiddenChatInfoPromptComponent {
  private bottomSheetRef = inject(MatBottomSheetRef<HiddenChatInfoPromptComponent>);

  dismiss(): void {
    this.bottomSheetRef.dismiss();
  }
}
