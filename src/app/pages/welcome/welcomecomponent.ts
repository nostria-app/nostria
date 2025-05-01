import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { NostrService } from '../../services/nostr.service';
import { RouterModule } from '@angular/router';

interface Feature {
  icon: string;
  title: string;
  description: string;
}

interface Stat {
  value: string;
  label: string;
}

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    RouterModule,
  ],
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss'
})
export class WelcomeComponent {
  nostr = inject(NostrService);

  features = signal<Feature[]>([
    {
      icon: 'lock',
      title: 'Freedom of expression',
      description: 'Share your thoughts and interact with others in a fully transparent and open manner that is not restricted by any boundaries.'
    },
    {
      icon: 'bolt',
      title: 'Decentralized Social',
      description: 'Connect with others on a truly decentralized platform resistant to censorship.'
    },
    {
      icon: 'people',
      title: 'Global Scale',
      description: 'Nostria is built to scale and implements the Nostr protocol in a way that helps improve decentralization.'
    },
    // {
    //   icon: 'extension',
    //   title: 'Extensible',
    //   description: 'Customize your experience with plugins and extensions built by the community.'
    // }
  ]);

  stats = signal<Stat[]>([
    { value: '12M+', label: 'Users' },
    { value: '100M+', label: 'Posts' },
    { value: '3000+', label: 'Relays' },
    { value: '24/7', label: 'Uptime' }
  ]);
}
