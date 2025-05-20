import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-welcome',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss'
})
export class WelcomeComponent {
  layout = inject(LayoutService)
  currentOnboardingPage = signal(1);
  totalOnboardingPages = signal(3);

  // Add method to navigate to the next onboarding page
  nextOnboardingPage(): void {
    if (this.currentOnboardingPage() < this.totalOnboardingPages()) {
      this.currentOnboardingPage.update(page => page + 1);
    } else {
      // On the last page, close the welcome screen
      this.layout.showWelcomeScreen.set(false);
    }
  }

  // Add method to navigate to the previous onboarding page
  previousOnboardingPage(): void {
    if (this.currentOnboardingPage() > 1) {
      this.currentOnboardingPage.update(page => page - 1);
    }
  }

  // Method to close the welcome screen
  closeWelcomeScreen(): void {
    this.layout.showWelcomeScreen.set(false);
  }
}
