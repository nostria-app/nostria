import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Clipboard } from '@angular/cdk/clipboard';
import { Event } from 'nostr-tools';

@Component({
  selector: 'app-code-snippet-event',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './code-snippet-event.component.html',
  styleUrl: './code-snippet-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeSnippetEventComponent {
  event = input.required<Event>();

  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);

  copied = signal(false);

  /** The actual code from .content */
  code = computed(() => this.event().content || '');

  /** Programming language from 'l' tag */
  language = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'l');
    return tag?.[1] || '';
  });

  /** File name from 'name' tag */
  name = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'name');
    return tag?.[1] || '';
  });

  /** File extension from 'extension' tag */
  extension = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'extension');
    return tag?.[1] || '';
  });

  /** Description from 'description' tag */
  description = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'description');
    return tag?.[1] || '';
  });

  /** Runtime from 'runtime' tag */
  runtime = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'runtime');
    return tag?.[1] || '';
  });

  /** License(s) from 'license' tag(s) */
  licenses = computed(() => {
    return this.event().tags
      .filter(t => t[0] === 'license')
      .map(t => t[1]);
  });

  /** Dependencies from 'dep' tag(s) */
  dependencies = computed(() => {
    return this.event().tags
      .filter(t => t[0] === 'dep')
      .map(t => t[1]);
  });

  /** Repository from 'repo' tag */
  repo = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'repo');
    return tag?.[1] || '';
  });

  /** Display label: filename > language > extension > 'Code Snippet' */
  displayLabel = computed(() => {
    return this.name() || this.language() || (this.extension() ? `.${this.extension()}` : 'Code Snippet');
  });

  /** Whether to show the metadata bar (has any metadata beyond the code) */
  hasMetadata = computed(() => {
    return !!(this.runtime() || this.licenses().length || this.dependencies().length || this.repo());
  });

  copyCode() {
    this.clipboard.copy(this.code());
    this.copied.set(true);
    this.snackBar.open('Code copied to clipboard', 'Close', { duration: 2000 });
    setTimeout(() => this.copied.set(false), 2000);
  }

  downloadSnippet() {
    const ext = this.extension() || 'txt';
    const filename = this.name() || `snippet.${ext}`;
    const blob = new Blob([this.code()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
