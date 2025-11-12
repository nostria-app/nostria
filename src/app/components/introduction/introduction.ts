import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-introduction',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatIconModule],
  templateUrl: './introduction.html',
  styleUrl: './introduction.scss',
})
export class Introduction {
  private layout = inject(LayoutService);

  openNewUserFlow(): void {
    this.layout.showLoginDialogWithStep('new-user');
  }

  openLoginFlow(): void {
    this.layout.showLoginDialogWithStep('login');
  }

  showWelcomeDialog(): void {
    this.layout.showWelcomeDialog();
  }

  openTermsOfUse(): void {
    this.layout.openTermsOfUse();
  }
}
