import { Component, effect, inject, signal } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { ApplicationService } from '../../services/application.service';

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
  app = inject(ApplicationService);

  constructor() {

  }
}
