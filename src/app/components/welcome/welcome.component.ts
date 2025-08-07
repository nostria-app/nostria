import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { LayoutService } from '../../services/layout.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-welcome',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    FormsModule,
  ],
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss',
})
export class WelcomeComponent {
  themeService = inject(ThemeService);
  layout = inject(LayoutService);
  currentOnboardingPage = signal(1);
  totalOnboardingPages = signal(4);

  // Profile setup signals
  displayName = signal('');
  profileImage = signal<string | null>(null);
  showAdvancedKey = signal(false);

  // Region detection signals
  detectedRegion = signal('United States');
  showRegionSelector = signal(false);
  availableRegions = signal([
    { name: 'United States', latency: '45ms', flag: '🇺🇸' },
    { name: 'Europe', latency: '78ms', flag: '🇪🇺' },
    { name: 'Asia Pacific', latency: '120ms', flag: '🌏' },
    { name: 'Canada', latency: '52ms', flag: '🇨🇦' },
  ]);

  // Feature highlights for screen 3
  features = signal([
    {
      icon: 'security',
      title: 'Private & Secure',
      description: 'Only you control your account.',
    },
    {
      icon: 'location_on',
      title: 'Regional Communities',
      description: 'Connect with people near you.',
    },
    {
      icon: 'block',
      title: 'No Passwords, No Ads',
      description: 'Just conversations.',
    },
  ]);
  currentFeatureIndex = signal(0);

  // Add method to navigate to the next onboarding page
  nextOnboardingPage(): void {
    if (this.currentOnboardingPage() < this.totalOnboardingPages()) {
      this.currentOnboardingPage.update(page => page + 1);
    } else {
      // On the last page, close the welcome screen
      this.closeWelcomeScreen();
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
    localStorage.setItem('nostria-welcome', 'false');
    this.layout.showWelcomeScreen.set(false);
  }

  // Region selection methods
  toggleRegionSelector(): void {
    this.showRegionSelector.update(show => !show);
  }

  selectRegion(region: string): void {
    this.detectedRegion.set(region);
    this.showRegionSelector.set(false);
  }

  // Feature carousel methods
  nextFeature(): void {
    const nextIndex = (this.currentFeatureIndex() + 1) % this.features().length;
    this.currentFeatureIndex.set(nextIndex);
  }

  previousFeature(): void {
    const prevIndex =
      this.currentFeatureIndex() === 0
        ? this.features().length - 1
        : this.currentFeatureIndex() - 1;
    this.currentFeatureIndex.set(prevIndex);
  }

  // Profile setup methods
  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = e => {
        this.profileImage.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  skipProfileSetup(): void {
    this.closeWelcomeScreen();
  }

  completeProfileSetup(): void {
    // TODO: Save profile data to service
    this.closeWelcomeScreen();
  }
}
