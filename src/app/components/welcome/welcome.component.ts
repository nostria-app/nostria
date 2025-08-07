import { Component, inject, signal, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { LayoutService } from '../../services/layout.service';
import { ThemeService } from '../../services/theme.service';

interface SuggestedProfile {
  id: string;
  name: string;
  bio: string;
  avatar: string;
  interests: string[];
  region?: string;
}

@Component({
  selector: 'app-welcome',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatCheckboxModule,
    FormsModule,
  ],
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss',
})
export class WelcomeComponent {
  themeService = inject(ThemeService);
  layout = inject(LayoutService);
  currentOnboardingPage = signal(1);
  totalOnboardingPages = signal(4); // Now 4 main steps, learn more is optional

  // Profile setup signals
  displayName = signal('');
  profileImage = signal<string | null>(null);
  showAdvancedKey = signal(false);

  // Region detection signals
  isDetectingRegion = signal(true);
  detectedRegion = signal('');
  showRegionSelector = signal(false);
  availableRegions = signal([
    { name: 'United States', latency: '45ms', flag: '🇺🇸' },
    { name: 'Europe', latency: '78ms', flag: '🇪🇺' },
    { name: 'Asia Pacific', latency: '120ms', flag: '🌏' },
    { name: 'Canada', latency: '52ms', flag: '🇨🇦' },
  ]);

  // Feature highlights for screen 3 (learn more section)
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

  // Interests and follow suggestions for screen 4
  availableInterests = signal([
    { id: 'regional', name: 'Regional', icon: 'location_on' },
    { id: 'sports', name: 'Sports', icon: 'sports_soccer' },
    { id: 'academic', name: 'Academic', icon: 'school' },
    { id: 'science', name: 'Science', icon: 'science' },
    { id: 'arts', name: 'Arts', icon: 'palette' },
    { id: 'bitcoin', name: 'Bitcoin', icon: 'currency_bitcoin' },
    { id: 'technology', name: 'Technology', icon: 'computer' },
    { id: 'music', name: 'Music', icon: 'music_note' },
    { id: 'gaming', name: 'Gaming', icon: 'sports_esports' },
    { id: 'food', name: 'Food', icon: 'restaurant' },
    { id: 'travel', name: 'Travel', icon: 'flight' },
    { id: 'fitness', name: 'Fitness', icon: 'fitness_center' },
    { id: 'finance', name: 'Finance', icon: 'account_balance' },
    { id: 'fashion', name: 'Fashion', icon: 'checkroom' },
    { id: 'architecture', name: 'Architecture', icon: 'architecture' },
    { id: 'gardening', name: 'Gardening', icon: 'local_florist' },
    { id: 'photography', name: 'Photography', icon: 'photo_camera' },
  ]);

  selectedInterests = signal<string[]>([]);
  followingProfiles = signal<string[]>([]);

  // Sample suggested profiles data
  suggestedProfiles = signal<SuggestedProfile[]>([
    {
      id: 'profile1',
      name: 'Tech Innovator',
      bio: 'Building the future of decentralized tech',
      avatar:
        'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face',
      interests: ['technology', 'bitcoin', 'science'],
    },
    {
      id: 'profile2',
      name: 'Sports Analyst',
      bio: 'Breaking down the game, one play at a time',
      avatar:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face',
      interests: ['sports', 'fitness'],
    },
    {
      id: 'profile3',
      name: 'Art Curator',
      bio: 'Discovering emerging artists and timeless classics',
      avatar:
        'https://images.unsplash.com/photo-1494790108755-2616b67ade43?w=100&h=100&fit=crop&crop=face',
      interests: ['arts', 'music'],
    },
    {
      id: 'profile4',
      name: 'Bitcoin Educator',
      bio: 'Teaching financial sovereignty through Bitcoin',
      avatar:
        'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=100&h=100&fit=crop&crop=face',
      interests: ['bitcoin', 'technology', 'academic'],
    },
    {
      id: 'profile5',
      name: 'Travel Blogger',
      bio: 'Exploring hidden gems around the world',
      avatar:
        'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face',
      interests: ['travel', 'food', 'arts'],
    },
    {
      id: 'profile6',
      name: 'Science Communicator',
      bio: 'Making complex science accessible to everyone',
      avatar:
        'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=100&h=100&fit=crop&crop=face',
      interests: ['science', 'academic', 'technology'],
    },
    // Regional profiles - these will be filtered based on detected region
    {
      id: 'regional1',
      name: 'Local Community Leader',
      bio: 'Connecting neighbors and building stronger communities',
      avatar:
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=face',
      interests: ['regional'],
      region: 'North America', // Will be dynamically updated
    },
    {
      id: 'regional2',
      name: 'Regional News Reporter',
      bio: 'Covering local stories that matter to our community',
      avatar:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face',
      interests: ['regional'],
      region: 'North America', // Will be dynamically updated
    },
    {
      id: 'regional3',
      name: 'Local Business Owner',
      bio: 'Supporting the local economy and community growth',
      avatar:
        'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100&h=100&fit=crop&crop=face',
      interests: ['regional'],
      region: 'North America', // Will be dynamically updated
    },
  ]);

  // Add method to navigate to the next onboarding page
  nextOnboardingPage(): void {
    if (this.currentOnboardingPage() === 1) {
      // Start region detection when moving to page 2
      this.startRegionDetection();
    }

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

  // Method to close the welcome screen (Get started)
  closeWelcomeScreen(): void {
    this.layout.setWelcomeScreenPreference(false);
  }

  showLogin(): void {
    // Close the welcome screen and show the login dialog
    this.layout.setWelcomeScreenPreference(false);
    this.layout.showLoginDialog();
  }

  // Method to continue to learn more section
  learnMore(): void {
    this.currentOnboardingPage.set(5);
  }

  // Region detection methods
  startRegionDetection(): void {
    this.isDetectingRegion.set(true);
    this.showRegionSelector.set(false);

    // Simulate region detection with a delay
    setTimeout(() => {
      // In a real app, this would make an API call to detect the closest region
      const regions = this.availableRegions();
      const fastestRegion = regions[0]; // For demo, just pick the first one
      this.detectedRegion.set(fastestRegion.name);
      this.isDetectingRegion.set(false);
    }, 2500); // 2.5 seconds simulation
  }

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
    this.nextOnboardingPage(); // Go to choose your path screen
  }

  completeProfileSetup(): void {
    // TODO: Save profile data to service
    this.nextOnboardingPage(); // Go to choose your path screen
  }

  // Interest and follow suggestion methods
  toggleInterest(interestId: string): void {
    const current = this.selectedInterests();
    if (current.includes(interestId)) {
      this.selectedInterests.set(current.filter(id => id !== interestId));
    } else {
      this.selectedInterests.set([...current, interestId]);
    }
  }

  getSuggestedProfiles() {
    const selected = this.selectedInterests();
    if (selected.length === 0) {
      return [];
    }

    // Filter profiles that have at least one matching interest
    let filteredProfiles = this.suggestedProfiles().filter(profile =>
      profile.interests.some(interest => selected.includes(interest))
    );

    // For regional profiles, update their region to match detected region and filter
    if (selected.includes('regional')) {
      const currentRegion = this.detectedRegion();
      filteredProfiles = filteredProfiles.map(profile => {
        if (profile.interests.includes('regional') && profile.region) {
          return { ...profile, region: currentRegion };
        }
        return profile;
      });
    }

    return filteredProfiles;
  }

  getInterestName(interestId: string): string {
    const interest = this.availableInterests().find(i => i.id === interestId);
    return interest?.name || interestId;
  }

  toggleFollow(profileId: string): void {
    const current = this.followingProfiles();
    if (current.includes(profileId)) {
      this.followingProfiles.set(current.filter(id => id !== profileId));
    } else {
      this.followingProfiles.set([...current, profileId]);
    }
  }

  completeOnboarding(): void {
    // TODO: Save selected interests and following list to service
    this.closeWelcomeScreen();
  }
}
