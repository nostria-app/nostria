import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';

interface FeatureComparison {
    feature: string;
    free: string | boolean;
    premium: string | boolean;
    description?: string;
}

@Component({
    selector: 'app-premium-comparison-dialog',
    standalone: true,
    imports: [
        CommonModule,
        MatDialogModule,
        MatButtonModule,
        MatIconModule,
        MatTableModule
    ],
    templateUrl: './premium-comparison-dialog.component.html',
    styleUrl: './premium-comparison-dialog.component.scss'
})
export class PremiumComparisonDialogComponent {
    displayedColumns: string[] = ['feature', 'free', 'premium'];

    features = signal<FeatureComparison[]>([
        {
            feature: 'Storage Space',
            free: '50MB',
            premium: '2GB',
            description: 'Available space for storing media and content'
        },
        {
            feature: 'Media Hosting',
            free: 'Limited',
            premium: 'Full Support',
            description: 'Upload and host images, videos, and files'
        },
        {
            feature: 'Dedicated Relay',
            free: false,
            premium: true,
            description: 'Priority access to a dedicated relay'
        },
        {
            feature: 'Verified Username',
            free: false,
            premium: true,
            description: 'Get a verified username on Nostr'
        },
        {
            feature: 'Bitcoin Payment Address',
            free: false,
            premium: true,
            description: 'Receive payments directly to your profile'
        },
        {
            feature: 'Automated Backup',
            free: false,
            premium: true,
            description: 'Automated daily backups of your data'
        },
        {
            feature: 'Relay Migration',
            free: false,
            premium: true,
            description: 'Automatic migration of your data'
        },
        {
            feature: 'Content Backup Access',
            free: false,
            premium: true,
            description: 'Access to backup management features'
        },
        {
            feature: 'Nostr Client',
            free: true,
            premium: true,
            description: 'Full access to Nostria client'
        },
        {
            feature: 'Basic Relays',
            free: true,
            premium: true,
            description: 'Connection to public Nostr relays'
        },
        {
            feature: 'Multiple Account Support',
            free: 'Up to 2',
            premium: 'Unlimited',
            description: 'Number of accounts you can manage'
        },
    ]);

    constructor(public dialogRef: MatDialogRef<PremiumComparisonDialogComponent>) { }

    closeDialog(): void {
        this.dialogRef.close();
    }
}
