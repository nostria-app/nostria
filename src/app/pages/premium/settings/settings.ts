import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { AccountStateService } from '../../../services/account-state.service';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-premium-settings',
  imports: [MatCardModule, MatListModule, DatePipe],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class PremiumSettings {
  accountState = inject(AccountStateService);
}
