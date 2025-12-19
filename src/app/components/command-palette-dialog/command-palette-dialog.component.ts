import { Component, inject, signal, computed, ElementRef, ViewChild, ViewChildren, QueryList, AfterViewInit, OnDestroy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatInputModule } from '@angular/material/input';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { Router } from '@angular/router';
import { AiService } from '../../services/ai.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventService } from '../../services/event';
import { LayoutService } from '../../services/layout.service';
import { AccountStateService } from '../../services/account-state.service';
import { SettingsService } from '../../services/settings.service';

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
  standalone: true,
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
  private aiService = inject(AiService);
  private settings = inject(SettingsService);
  private snackBar = inject(MatSnackBar);
  private accountState = inject(AccountStateService);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  @ViewChildren('listItem', { read: ElementRef }) listItems!: QueryList<ElementRef>;

  searchQuery = signal('');
  selectedIndex = signal(0);
  isListening = signal(false);
  isTranscribing = signal(false);

  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  // Silence detection
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private silenceStart: number | null = null;
  private animationFrameId: number | null = null;
  private readonly SILENCE_THRESHOLD = 0.02; // Adjust as needed
  private readonly SILENCE_DURATION = 2000; // 2 seconds of silence to stop

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
    this.stopRecording();
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
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async startRecording() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
        await this.processVoiceCommand(audioBlob);

        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop());
          this.stream = null;
        }
      };

      this.mediaRecorder.start();
      this.isListening.set(true);
      this.searchQuery.set('Listening...');

      // Start silence detection
      this.startSilenceDetection(this.stream);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      this.snackBar.open('Error accessing microphone', 'Close', { duration: 3000 });
    }
  }

  startSilenceDetection(stream: MediaStream) {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.microphone = this.audioContext.createMediaStreamSource(stream);
    this.microphone.connect(this.analyser);

    this.analyser.fftSize = 2048;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    this.silenceStart = Date.now();

    const checkSilence = () => {
      if (!this.isListening()) return;

      this.analyser!.getByteTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const x = (dataArray[i] - 128) / 128.0;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / bufferLength);

      if (rms < this.SILENCE_THRESHOLD) {
        if (this.silenceStart === null) {
          this.silenceStart = Date.now();
        } else if (Date.now() - this.silenceStart > this.SILENCE_DURATION) {
          this.stopRecording();
          return;
        }
      } else {
        this.silenceStart = null;
      }

      this.animationFrameId = requestAnimationFrame(checkSilence);
    };

    checkSilence();
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.isListening.set(false);
    }

    // Clean up silence detection
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.microphone = null;
    this.silenceStart = null;
  }

  async processVoiceCommand(blob: Blob) {
    this.isTranscribing.set(true);
    this.searchQuery.set('Processing...');

    try {
      // Check if AI transcription is enabled
      if (!this.settings.settings().aiEnabled || !this.settings.settings().aiTranscriptionEnabled) {
        this.snackBar.open('AI transcription is disabled in settings', 'Open Settings', { duration: 5000 })
          .onAction().subscribe(() => {
            this.dialogRef.close();
            this.router.navigate(['/ai/settings']);
          });
        this.searchQuery.set('');
        return;
      }

      // Check/Load Whisper model
      const status = await this.aiService.checkModel('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
      if (!status.loaded) {
        this.snackBar.open('Loading Whisper model...', 'Close', { duration: 2000 });
        await this.aiService.loadModel('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
      }

      // Transcribe
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0);

      const result = await this.aiService.transcribeAudio(audioData) as { text: string };

      if (result && result.text) {
        const text = result.text.trim().toLowerCase();
        // Remove punctuation
        const cleanText = text.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
        this.searchQuery.set(cleanText);

        // Try to find a match
        const commands = this.commands;
        const match = commands.find(cmd =>
          cmd.label.toLowerCase() === cleanText ||
          cmd.keywords?.some(k => k.toLowerCase() === cleanText)
        );

        if (match) {
          this.executeCommand(match);
        } else {
          // If no exact match, leave the text in search box so user can see it filtered
          // The computed filteredCommands will update automatically
        }
      } else {
        this.searchQuery.set('');
      }
    } catch (err) {
      console.error('Transcription error:', err);
      this.searchQuery.set('');
      this.snackBar.open('Voice command failed', 'Close', { duration: 3000 });
    } finally {
      this.isTranscribing.set(false);
    }
  }
}
