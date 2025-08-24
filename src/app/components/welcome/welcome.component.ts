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
  imports: [MatIconModule, MatButtonModule, MatInputModule, MatFormFieldModule, FormsModule],
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss',
})
export class WelcomeComponent {
  themeService = inject(ThemeService);
  layout = inject(LayoutService);

  // Wizard state
  currentWizardStep = signal(1);
  totalWizardSteps = signal(4);

  // Introduction content for each step
  wizardSteps = signal([
    {
      id: 1,
      icon: 'public',
      title: 'Welcome to Nostria',
      subtitle: 'Your Gateway to the Decentralized Web',
      content: [
        'Nostria is the easy way to experience Nostr - a decentralized social protocol that puts you in control.',
        'No central algorithms deciding what you see. No ads. No data harvesting. Just authentic connections.',
        'Join thousands who have discovered a better way to connect and share ideas.',
      ],
      features: [
        { icon: 'security', text: 'Complete ownership of your data' },
        { icon: 'groups', text: 'Connect without intermediaries' },
        { icon: 'block', text: 'Censorship-resistant communication' },
      ],
    },
    {
      id: 2,
      icon: 'hub',
      title: 'What is Nostr?',
      subtitle: 'Notes and Other Stuff Transmitted by Relays',
      content: [
        'Nostr is a simple, open protocol that enables global, censorship-resistant social media.',
        "Instead of posting to a single company's servers, your messages are distributed across a network of independent relays.",
        'You own your identity through cryptographic keys - no account can be banned or deleted by others.',
      ],
      features: [
        { icon: 'vpn_key', text: 'Your keys, your identity' },
        { icon: 'dns', text: 'Distributed relay network' },
        { icon: 'language', text: 'Global, open protocol' },
      ],
    },
    {
      id: 3,
      icon: 'star',
      title: 'Why Choose Nostria?',
      subtitle: 'Built for Performance and Ease of Use',
      content: [
        'Nostria makes Nostr accessible to everyone with an intuitive interface and powerful features.',
        'We handle the complexity so you can focus on connecting and sharing.',
        'Our global infrastructure ensures fast, reliable access to the Nostr network from anywhere.',
      ],
      features: [
        { icon: 'speed', text: 'Optimized for global performance' },
        { icon: 'auto_awesome', text: 'Automatic relay discovery' },
        { icon: 'devices', text: 'Seamless cross-platform sync' },
      ],
    },
    {
      id: 4,
      icon: 'rocket_launch',
      title: 'Ready to Learn More',
      subtitle: 'Start your Nostr journey',
      content: [
        'You now understand the basics of Nostr and why Nostria is the best way to experience it.',
        "When you're ready to create your account and start using Nostria, we'll guide you through the simple setup process.",
        'Welcome to the future of decentralized social networking!',
      ],
      features: [
        { icon: 'school', text: 'Learn as you go' },
        { icon: 'explore', text: 'Discover communities' },
        { icon: 'connect_without_contact', text: 'Connect authentically' },
      ],
    },
  ]);

  // Get current step data
  getCurrentStep() {
    const steps = this.wizardSteps();
    return steps.find((step) => step.id === this.currentWizardStep()) || steps[0];
  }

  // Navigation methods
  nextStep(): void {
    if (this.currentWizardStep() < this.totalWizardSteps()) {
      this.currentWizardStep.update((step) => step + 1);
    } else {
      this.completeWizard();
    }
  }

  previousStep(): void {
    if (this.currentWizardStep() > 1) {
      this.currentWizardStep.update((step) => step - 1);
    }
  }

  skipToEnd(): void {
    this.completeWizard();
  }

  completeWizard(): void {
    // TODO: Save any profile setup data
    this.closeWelcomeScreen();
  }

  closeWelcomeScreen(): void {
    this.layout.setWelcomeScreenPreference(false);
  }

  showLogin(): void {
    this.layout.setWelcomeScreenPreference(false);
    this.layout.showLoginDialog();
  }
}
