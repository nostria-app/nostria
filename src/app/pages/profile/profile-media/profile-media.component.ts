import { Component, inject, signal, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatGridListModule } from '@angular/material/grid-list';
import { ProfileStateService } from '../../../services/profile-state.service';
import { EventComponent } from '../../../components/event/event.component';

@Component({
  selector: 'app-profile-media',
  imports: [MatIconModule, MatGridListModule, EventComponent],
  templateUrl: './profile-media.component.html',
  styleUrl: './profile-media.component.scss',
})
export class ProfileMediaComponent {
  private profileState = inject(ProfileStateService);

  error = signal<string | null>(null);

  // Get media from profile state service
  media = computed(() => this.profileState.sortedMedia());
}
