import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../../services/theme.service';
import { NostrService } from '../../services/nostr.service';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { LoginDialogComponent } from '../../components/login-dialog/login-dialog.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [MatCardModule, MatSlideToggleModule, FormsModule, MatButtonModule, MatDividerModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent {
  themeService = inject(ThemeService);
  nostrService = inject(NostrService);
  dialog = inject(MatDialog);
  
  toggleDarkMode() {
    this.themeService.toggleDarkMode();
  }
  
  logout() {
    this.nostrService.logout();
    this.showLoginDialog();
  }
  
  showLoginDialog(): void {
    this.dialog.open(LoginDialogComponent, {
      width: '500px',
      disableClose: true
    });
  }
  
  wipeData(): void {
    if (confirm('Are you sure you want to delete all app data? This action cannot be undone.')) {
      // Clear known localStorage keys related to the app
      const keysToRemove = [
        'nostria-theme',
        'nostria-users',
        'nostria-user',
      ];
      
      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
      });
      
      // Reload the application
      window.location.reload();
    }
  }
}
