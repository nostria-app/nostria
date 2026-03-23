import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { NostrService } from '../../services/nostr.service';

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'c', 'cpp', 'csharp',
  'ruby', 'php', 'swift', 'kotlin', 'dart', 'html', 'css', 'scss', 'sql', 'bash',
  'shell', 'powershell', 'json', 'yaml', 'toml', 'xml', 'markdown', 'solidity',
  'haskell', 'elixir', 'lua', 'r', 'scala', 'perl', 'zig', 'nim', 'ocaml',
];

const LANG_EXTENSION_MAP: Record<string, string> = {
  javascript: 'js', typescript: 'ts', python: 'py', rust: 'rs', go: 'go',
  java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', ruby: 'rb', php: 'php',
  swift: 'swift', kotlin: 'kt', dart: 'dart', html: 'html', css: 'css',
  scss: 'scss', sql: 'sql', bash: 'sh', shell: 'sh', powershell: 'ps1',
  json: 'json', yaml: 'yml', toml: 'toml', xml: 'xml', markdown: 'md',
  solidity: 'sol', haskell: 'hs', elixir: 'ex', lua: 'lua', r: 'r',
  scala: 'scala', perl: 'pl', zig: 'zig', nim: 'nim', ocaml: 'ml',
};

@Component({
  selector: 'app-code-snippet-editor-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './code-snippet-editor-dialog.component.html',
  styleUrl: './code-snippet-editor-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeSnippetEditorDialogComponent {
  private dialogRef = inject(CustomDialogRef);
  private nostrService = inject(NostrService);
  private snackBar = inject(MatSnackBar);

  languages = LANGUAGES;

  code = signal('');
  language = signal('');
  name = signal('');
  description = signal('');
  runtime = signal('');
  license = signal('');
  repo = signal('');

  isPublishing = signal(false);

  async publish() {
    const codeContent = this.code().trim();
    if (!codeContent) {
      this.snackBar.open('Code content is required', 'Close', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);

    try {
      const tags: string[][] = [];
      const lang = this.language();
      const ext = lang ? (LANG_EXTENSION_MAP[lang] || lang) : '';

      if (lang) tags.push(['l', lang]);
      if (ext) tags.push(['extension', ext]);
      if (this.name()) tags.push(['name', this.name()]);
      if (this.description()) tags.push(['description', this.description()]);
      if (this.runtime()) tags.push(['runtime', this.runtime()]);
      if (this.license()) tags.push(['license', this.license()]);
      if (this.repo()) tags.push(['repo', this.repo()]);
      tags.push(['alt', `Code snippet: ${this.name() || this.description() || 'Untitled'}`]);

      const event = this.nostrService.createEvent(1337, codeContent, tags);
      const result = await this.nostrService.signAndPublish(event);

      if (result.success) {
        this.snackBar.open('Code snippet published!', 'Close', { duration: 3000 });
        this.dialogRef.close(result.event);
      } else {
        this.snackBar.open('Failed to publish code snippet', 'Close', { duration: 5000 });
      }
    } catch {
      this.snackBar.open('Error publishing code snippet', 'Close', { duration: 5000 });
    } finally {
      this.isPublishing.set(false);
    }
  }

  cancel() {
    this.dialogRef.close();
  }
}
