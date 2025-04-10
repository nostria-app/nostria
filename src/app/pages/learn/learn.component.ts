import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

interface LearnSection {
  title: string;
  content: string;
  icon: string;
}

@Component({
  selector: 'app-learn',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatDividerModule,
    MatIconModule,
    MatExpansionModule,
    RouterLink,
    MatButtonModule
  ],
  templateUrl: './learn.component.html',
  styleUrl: './learn.component.scss'
})
export class LearnComponent {
  sections = signal<LearnSection[]>([
    {
      title: 'What is Nostria?',
      content: 'Nostria is a client for the Nostr protocol designed for global scale and enhanced user experience. It aims to make the Nostr protocol accessible to everyone, focusing on performance and ease of use.',
      icon: 'info'
    },
    {
      title: 'Global Scale',
      content: 'The goal of Nostria is to have a client that can enable global scale on Nostr. This means efficient data handling, optimized network requests, and a responsive interface that works well and is fully decentralized.',
      icon: 'public'
    },
    {
      title: 'Relay Connectivity',
      content: 'One of the important features is that the client will automatically connect to each individual user\'s Relays and get their data. This can be a privacy concern for some users, so it is advised to either use Tor or another Nostr client if automatic connection across relays is not wanted.',
      icon: 'dns'
    },
    {
      title: 'Multiple Accounts',
      content: 'Nostria works great with multiple accounts, with quick account switching. You can easily manage different identities for different purposes, all from within the same application interface.',
      icon: 'people'
    },
    {
      title: 'Security Options',
      content: 'Nostria allows many different ways to keep your private key secure, from extension signing, hardware NFC card signing on Android phones, to remote signing. This flexibility ensures you can choose the security level that best fits your needs.',
      icon: 'security'
    }
  ]);

  faqs = signal<{ question: string; answer: string }[]>([
    {
      question: 'What is Nostr?',
      answer: 'Nostr (Notes and Other Stuff Transmitted by Relays) is a decentralized protocol that enables global, censorship-resistant social media. It uses public-key cryptography and doesn\'t rely on any trusted central server.'
    },
    {
      question: 'How does Nostria handle privacy?',
      answer: 'Nostria connects to multiple relays to fetch user data, which may raise privacy concerns. If you\'re concerned about this, you can use Tor for additional privacy or choose another client with different connectivity patterns.'
    },
    {
      question: 'Can I use Nostria without exposing my private key?',
      answer: 'Yes! Nostria supports various signing methods including browser extensions (like nos2x), NFC hardware cards on Android, and remote signing, allowing you to keep your private key secure and offline.'
    },
    {
      question: 'How do I switch between accounts?',
      answer: 'Nostria makes account switching simple. Just open the profile menu and select from your available accounts to instantly switch between them.'
    },
    {
      question: 'What makes Nostria different from other Nostr clients?',
      answer: 'Nostria is designed with global scale in mind, focusing on performance optimization and user experience. Its intelligent relay connectivity and multi-account support make it particularly suited for power users and those needing fast access to data across the Nostr network.'
    }
  ]);
}
