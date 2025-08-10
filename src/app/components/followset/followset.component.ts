import { Component, input, output, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';

export interface Interest {
    id: string;
    name: string;
    icon: string;
}

export interface SuggestedProfile {
    id: string;
    name: string;
    bio: string;
    avatar: string;
    interests: string[];
    region?: string;
}

@Component({
    selector: 'app-followset',
    imports: [MatIconModule, MatButtonModule, MatCheckboxModule, FormsModule],
    templateUrl: './followset.component.html',
    styleUrl: './followset.component.scss',
})
export class FollowsetComponent {
    // Inputs
    title = input<string>('What interests you?');
    description = input<string>(
        "Select topics you're interested in to discover people and content you'll love. You can always change these later."
    );
    availableInterests = input<Interest[]>([]);
    suggestedProfiles = input<SuggestedProfile[]>([]);
    selectedInterests = input<string[]>([]);
    followingProfiles = input<string[]>([]);
    detectedRegion = input<string>('');

    // Outputs
    interestToggled = output<string>();
    profileToggled = output<string>();
    completed = output<void>();

    // Internal computed property for filtered profiles
    filteredProfiles = computed(() => {
        const selected = this.selectedInterests();
        const profiles = this.suggestedProfiles();
        const region = this.detectedRegion();

        if (selected.length === 0) {
            return [];
        }

        // Filter profiles that have at least one matching interest
        let filteredProfiles = profiles.filter(profile =>
            profile.interests.some(interest => selected.includes(interest))
        );

        // For regional profiles, update their region to match detected region
        if (selected.includes('regional')) {
            filteredProfiles = filteredProfiles.map(profile => {
                if (profile.interests.includes('regional') && profile.region) {
                    return { ...profile, region: region };
                }
                return profile;
            });
        }

        return filteredProfiles;
    });

    // Check if user is ready to get started (has selected interests and at least one follow)
    canGetStarted = computed(() => {
        return (
            this.selectedInterests().length > 0 && this.followingProfiles().length > 0
        );
    });

    toggleInterest(interestId: string): void {
        this.interestToggled.emit(interestId);
    }

    toggleFollow(profileId: string): void {
        this.profileToggled.emit(profileId);
    }

    getStarted(): void {
        this.completed.emit();
    }

    getInterestName(interestId: string): string {
        const interest = this.availableInterests().find(i => i.id === interestId);
        return interest?.name || interestId;
    }
}
