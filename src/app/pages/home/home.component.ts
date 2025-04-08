import { Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

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
  selector: 'app-home',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  features = signal<Feature[]>([
    {
      icon: 'lock',
      title: 'Privacy-Focused',
      description: 'Your data stays yours with no centralized servers.'
    },
    {
      icon: 'bolt',
      title: 'Lightning Fast',
      description: 'Experience quick message delivery and seamless interactions across the network.'
    },
    {
      icon: 'people',
      title: 'Decentralized Social',
      description: 'Connect with others on a truly decentralized platform resistant to censorship.'
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
