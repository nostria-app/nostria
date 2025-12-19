import { Component, inject, signal, computed, ElementRef, ViewChild, ViewChildren, QueryList, AfterViewInit, OnDestroy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatInputModule } from '@angular/material/input';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventService } from '../../services/event';
import { LayoutService } from '../../services/layout.service';
import { AccountStateService } from '../../services/account-state.service';
import { SettingsService } from '../../services/settings.service';
import { SpeechService } from '../../services/speech.service';

export interface Command {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  keywords?: string[];
  description?: string;
}

@Component({
  selector: 'app-command-palette-dialog',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    MatInputModule
  ],
  templateUrl: './command-palette-dialog.component.html',
  styleUrls: ['./command-palette-dialog.component.scss']
})
export class CommandPaletteDialogComponent implements AfterViewInit, OnDestroy {
  dialogRef = inject(CustomDialogRef<CommandPaletteDialogComponent>);
  private router = inject(Router);
  private eventService = inject(EventService);
  private layoutService = inject(LayoutService);
  private speechService = inject(SpeechService);
  private settings = inject(SettingsService);
  private snackBar = inject(MatSnackBar);
  private accountState = inject(AccountStateService);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  @ViewChildren('listItem', { read: ElementRef }) listItems!: QueryList<ElementRef>;

  searchQuery = signal('');
  selectedIndex = signal(0);
  isListening = signal(false);
  isTranscribing = signal(false);

  commands: Command[] = [
    {
      id: 'nav-messages',
      label: 'Open Messages',
      icon: 'mail',
      action: () => this.router.navigate(['/messages']),
      keywords: ['messages', 'inbox', 'dm', 'chat']
    },
    {
      id: 'nav-settings',
      label: 'Open Settings',
      icon: 'settings',
      action: () => this.router.navigate(['/settings']),
      keywords: ['settings', 'config', 'preferences', 'options']
    },
    {
      id: 'nav-profile',
      label: 'Open Profile',
      icon: 'person',
      action: () => this.router.navigate(['/p', this.accountState.pubkey()]), // Assuming /profile redirects to current user
      keywords: ['profile', 'me', 'account', 'user']
    },
    {
      id: 'nav-profile-edit',
      label: 'Edit Profile',
      icon: 'edit',
      action: () => this.router.navigate(['/p', this.accountState.pubkey(), 'edit']), // Assuming /profile redirects to current user
      keywords: ['profile', 'me', 'account', 'user', 'edit']
    },
    {
      id: 'nav-feeds',
      label: 'Open Feeds',
      icon: 'dynamic_feed',
      action: () => this.router.navigate(['/']),
      keywords: ['feeds', 'home', 'timeline', 'posts']
    },
    {
      id: 'nav-streams',
      label: 'Open Streams',
      icon: 'live_tv',
      action: () => this.router.navigate(['/streams']),
      keywords: ['streams', 'live', 'video', 'tv']
    },
    {
      id: 'nav-media',
      label: 'Open Media',
      icon: 'photo_library',
      action: () => this.router.navigate(['/media']),
      keywords: ['media', 'photos', 'images', 'gallery']
    },
    {
      id: 'nav-bookmarks',
      label: 'Open Bookmarks',
      icon: 'bookmarks',
      action: () => this.router.navigate(['/bookmarks']),
      keywords: ['bookmarks', 'saved', 'favorites']
    },
    {
      id: 'nav-meetings',
      label: 'Open Meetings',
      icon: 'meeting_room',
      action: () => this.router.navigate(['/meetings']),
      keywords: ['meetings', 'calls', 'video chat']
    },
    {
      id: 'nav-badges',
      label: 'Open Badges',
      icon: 'badge',
      action: () => this.router.navigate(['/badges']),
      keywords: ['badges', 'achievements', 'awards']
    },
    {
      id: 'nav-notes',
      label: 'Open Notes',
      icon: 'notes',
      action: () => this.router.navigate(['/notes']), // Assuming there is a notes route or feed
      keywords: ['notes', 'text']
    },
    {
      id: 'act-create-note',
      label: 'Create Note',
      icon: 'edit_note',
      action: () => this.openNoteEditor(),
      keywords: ['create note', 'write note', 'new note', 'post']
    },
    {
      id: 'act-create-article',
      label: 'Create Article',
      icon: 'article',
      action: () => this.layoutService.createArticle(),
      keywords: ['create article', 'write article', 'new article', 'blog']
    },
    {
      id: 'nav-analytics',
      label: 'Open Analytics',
      icon: 'analytics',
      action: () => this.router.navigate(['/analytics']),
      keywords: ['analytics', 'stats', 'statistics', 'insights']
    },
    {
      id: 'nav-summary',
      label: 'Open Summary',
      icon: 'summarize',
      action: () => this.router.navigate(['/summary']),
      keywords: ['summary', 'overview', 'dashboard']
    },
    {
      id: 'nav-memos',
      label: 'Open Memos',
      icon: 'sticky_note_2',
      action: () => this.router.navigate(['/memos']),
      keywords: ['memos', 'notes', 'reminders', 'private notes']
    },
    {
      id: 'nav-calendar',
      label: 'Open Calendar',
      icon: 'calendar_month',
      action: () => this.router.navigate(['/calendar']),
      keywords: ['calendar', 'events', 'schedule', 'dates']
    },
    {
      id: 'nav-backup',
      label: 'Open Backup',
      icon: 'backup',
      action: () => this.router.navigate(['/backup']),
      keywords: ['backup', 'export', 'save', 'restore']
    },
    {
      id: 'nav-playlists',
      label: 'Open Playlists',
      icon: 'playlist_play',
      action: () => this.router.navigate(['/playlists']),
      keywords: ['playlists', 'music', 'queue', 'videos']
    },
    {
      id: 'nav-media-queue',
      label: 'Open Media Queue',
      icon: 'queue_music',
      action: () => this.router.navigate(['/queue']),
      keywords: ['queue', 'media queue', 'playlist', 'watch later']
    },
    {
      id: 'nav-lists',
      label: 'Open Lists',
      icon: 'list',
      action: () => this.router.navigate(['/lists']),
      keywords: ['lists', 'people lists', 'groups']
    },
    {
      id: 'nav-polls',
      label: 'Open Polls',
      icon: 'poll',
      action: () => this.router.navigate(['/polls']),
      keywords: ['polls', 'voting', 'survey']
    },
    {
      id: 'nav-notifications',
      label: 'Open Notifications',
      icon: 'notifications',
      action: () => this.router.navigate(['/notifications']),
      keywords: ['notifications', 'alerts', 'mentions', 'replies']
    }
  ];

  filteredCommands = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return this.commands;

    return this.commands.filter(cmd =>
      cmd.label.toLowerCase().includes(query) ||
      cmd.keywords?.some(k => k.toLowerCase().includes(query))
    );
  });

  ngAfterViewInit() {
    // Small delay to ensure dialog is fully rendered and focusable
    setTimeout(() => {
      if (this.searchInput) {
        this.searchInput.nativeElement.focus();
      }
    }, 100);
  }

  ngOnDestroy() {
    this.speechService.cleanup();
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex.update(i => Math.min(i + 1, this.filteredCommands().length - 1));
      this.scrollToSelected();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex.update(i => Math.max(i - 1, 0));
      this.scrollToSelected();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.executeSelected();
    } else if (event.key === 'Escape') {
      this.dialogRef.close();
    }
  }

  scrollToSelected() {
    setTimeout(() => {
      const selectedEl = this.listItems.get(this.selectedIndex())?.nativeElement;
      selectedEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  executeSelected() {
    const commands = this.filteredCommands();
    if (commands.length > 0 && this.selectedIndex() >= 0 && this.selectedIndex() < commands.length) {
      const cmd = commands[this.selectedIndex()];
      this.executeCommand(cmd);
    }
  }

  executeCommand(cmd: Command) {
    this.dialogRef.close();
    cmd.action();
  }

  openNoteEditor() {
    this.eventService.createNote();
  }

  // Voice Command Implementation
  async toggleRecording() {
    if (this.isListening()) {
      this.speechService.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async startRecording() {
    // Check if AI transcription is enabled
    if (!this.settings.settings().aiEnabled || !this.settings.settings().aiTranscriptionEnabled) {
      this.snackBar.open('AI transcription is disabled in settings', 'Open Settings', { duration: 5000 })
        .onAction().subscribe(() => {
          this.dialogRef.close();
          this.router.navigate(['/ai/settings']);
        });
      return;
    }

    this.isListening.set(true);
    this.searchQuery.set('Listening...');

    await this.speechService.startRecording({
      silenceDuration: 2000,
      onRecordingStateChange: (isRecording) => {
        this.isListening.set(isRecording);
        if (!isRecording && !this.isTranscribing()) {
          this.searchQuery.set('Processing...');
        }
      },
      onTranscribingStateChange: (isTranscribing) => {
        this.isTranscribing.set(isTranscribing);
        if (isTranscribing) {
          this.searchQuery.set('Processing...');
        }
      },
      onTranscription: (text) => {
        this.handleTranscription(text);
      }
    });
  }

  private handleTranscription(text: string) {
    // Filter out common Whisper hallucinations/noise
    const hallucinations = [
      /^\[.*\]$/i,  // [music playing], [Music], etc.
      /^music$/i,
      /^music playing$/i,
      /^\(.*\)$/i,  // (music), etc.
      /^\.+$/,      // Just periods
      /^,+$/,       // Just commas
      /^\s*$/,      // Empty or whitespace only
    ];

    const trimmedText = text.trim();
    if (hallucinations.some(pattern => pattern.test(trimmedText))) {
      // Ignore hallucination, don't update the search query
      return;
    }

    const cleanText = trimmedText.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()[\]]/g, "").trim();

    // Ignore if cleaned text is empty
    if (!cleanText) {
      return;
    }

    // Check for "search <term>" command
    const searchMatch = cleanText.match(/^search\s+(.+)$/i);
    if (searchMatch) {
      const searchTerm = searchMatch[1].trim();
      this.dialogRef.close();
      this.layoutService.openSearchWithValue(searchTerm);
      return;
    }

    // Check for "find <term>" command (alternative)
    const findMatch = cleanText.match(/^find\s+(.+)$/i);
    if (findMatch) {
      const searchTerm = findMatch[1].trim();
      this.dialogRef.close();
      this.layoutService.openSearchWithValue(searchTerm);
      return;
    }

    this.searchQuery.set(cleanText);

    // Try to find a match
    const commands = this.commands;
    const match = commands.find(cmd =>
      cmd.label.toLowerCase() === cleanText ||
      cmd.keywords?.some(k => k.toLowerCase() === cleanText)
    );

    if (match) {
      this.executeCommand(match);
      return;
    }

    // Also try partial matching for common voice command patterns
    const partialMatch = commands.find(cmd =>
      cleanText.includes(cmd.label.toLowerCase()) ||
      cmd.keywords?.some(k => cleanText.includes(k.toLowerCase()))
    );

    if (partialMatch) {
      this.executeCommand(partialMatch);
      return;
    }
    // If no match, leave the text in search box so user can see it filtered
    // The computed filteredCommands will update automatically
  }
}
