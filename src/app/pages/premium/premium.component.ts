import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { PremiumComparisonDialogComponent } from './premium-comparison-dialog/premium-comparison-dialog.component';

interface PremiumFeature {
  title: string;
  description: string;
  icon: string;
}

interface FaqItem {
  question: string;
  answer: string;
}

@Component({
  selector: 'app-premium',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    MatDividerModule,
    MatDialogModule,
    RouterLink
  ],
  templateUrl: './premium.component.html',
  styleUrl: './premium.component.scss'
})
export class PremiumComponent {
  dialog = inject(MatDialog);
  
  features = signal<PremiumFeature[]>([
    {
      title: 'Media Hosting',
      description: 'Upload and store images, videos, and files with our reliable cloud storage.',
      icon: 'cloud_upload'
    },
    {
      title: 'Dedicated Relay',
      description: 'Get priority access to a dedicated relay for faster performance and better reliability.',
      icon: 'speed'
    },
    {
      title: 'Automated Backup',
      description: 'Keep your notes and data safe with automated daily backups.',
      icon: 'backup'
    },
    {
      title: 'Bitcoin Payment Address',
      description: 'Receive payments directly to your profile with a custom Bitcoin payment address.',
      icon: 'account_balance_wallet'
    },
    {
      title: 'Verified Username',
      description: 'Get a verified username that uniquely identifies you across the Nostr network.',
      icon: 'verified'
    }
  ]);

  faqItems = signal<FaqItem[]>([
    {
      question: 'What is Nostria Premium?',
      answer: 'Nostria Premium is a subscription service that enhances your Nostr experience with additional storage, dedicated relays, verified usernames, and more features designed for power users.'
    },
    {
      question: 'How much does Nostria Premium cost?',
      answer: 'Nostria Premium is available for $6/month when paying quarterly ($18 every 3 months) or $5/month when paying yearly ($60/year), offering you significant savings with the annual plan.'
    },
    {
      question: 'How can I pay for Nostria Premium?',
      answer: 'You can pay through in-app purchases on iOS App Store or Google Play Store when using our mobile apps. For desktop and web versions, you can pay using Bitcoin Lightning Network for a seamless, privacy-preserving experience.'
    },
    {
      question: 'Can I cancel my subscription anytime?',
      answer: 'Yes, you can cancel your Premium subscription at any time. Your benefits will continue until the end of your current billing period.'
    },
    {
      question: 'What happens to my uploaded content if I cancel?',
      answer: 'If you cancel, you\'ll have 30 days to download your content that exceeds the free storage limit (50MB). After that period, content exceeding the free tier limit may be removed.'
    },
    {
      question: 'What is the Content Backup feature?',
      answer: 'Once you subscribe to Nostria Premium, a new "Content Backup" section will appear in your sidebar menu, where you can manage all your backup settings, download backup locally, and restore previous content if needed.'
    }
  ]);

  openComparisonDialog(): void {
    this.dialog.open(PremiumComparisonDialogComponent, {
      width: '800px',
      maxWidth: '95vw'
    });
  }
}
