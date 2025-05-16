import { Component, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-settings',
  imports: [MatButtonModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class NotificationSettingsComponent {

  notificationsSupported = computed(() => 'PushManager' in window && 'serviceWorker' in navigator);

  enableNotifications() {

  }
}
