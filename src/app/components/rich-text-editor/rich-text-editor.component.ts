import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  AfterViewInit,
  ViewChild,
  ElementRef,
  input,
  output,
  effect,
} from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { FormsModule } from '@angular/forms';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { marked } from 'marked';
import { MediaService } from '../../services/media.service';
import { ImageUrlDialogComponent } from '../image-url-dialog/image-url-dialog.component';
import {
  FloatingToolbarComponent,
  FloatingToolbarPosition,
} from '../floating-toolbar/floating-toolbar.component';
import { LocalSettingsService } from '../../services/local-settings.service';
import { cleanTrackingParametersFromText } from '../../utils/url-cleaner';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';

@Component({
  selector: 'app-rich-text-editor',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    MatMenuModule,
    FormsModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDialogModule,
    FloatingToolbarComponent
  ],
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RichTextEditorComponent implements AfterViewInit {
  readonly content = input('');
  readonly contentChange = output<string>();

  readonly richTextMode = input(true);
  readonly richTextModeChange = output<boolean>();
  readonly disableAdvancedActions = input(false);
  readonly showArticleActions = input(false);
  readonly showFeaturedImageAction = input(false);
  readonly hasFeaturedImage = input(false);
  readonly previewActive = input(false);
  readonly splitViewActive = input(false);
  readonly canUseSplitView = input(false);
  readonly showEditorContent = input(true);
  readonly actionsDisabled = input(false);
  readonly recording = input(false);
  readonly transcribing = input(false);
  readonly requireContentFocusForActions = input(true);

  readonly insertReferenceRequest = output<void>();
  readonly aiActionRequest = output<'generate' | 'translate' | 'sentiment'>();
  readonly toggleRecordingRequest = output<void>();
  readonly togglePreviewRequest = output<void>();
  readonly toggleSplitViewRequest = output<void>();
  readonly contentFocusChange = output<boolean>();
  readonly featuredImageUploadRequest = output<void>();
  readonly featuredImageLibraryRequest = output<void>();
  readonly featuredImageUrlRequest = output<void>();
  readonly importArticleRequest = output<void>();

  @ViewChild('editorContent') editorContent!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef;
  @ViewChild('markdownTextarea') markdownTextarea!: ElementRef;

  isRichTextMode = signal(true);
  markdownContent = signal('');
  isUploading = signal(false);
  isDragOver = signal(false);
  showFloatingToolbar = signal(false);
  floatingToolbarPosition = signal<FloatingToolbarPosition>({ top: 0, left: 0 });
  isContentFocused = signal(false);
  disableContextActions = computed(() =>
    this.requireContentFocusForActions() && !this.isContentFocused()
  );
  private dragCounter = 0;
  private isInternalChange = false; // Flag to track internal vs external changes
  private viewInitialized = false;
  private focusBlurTimeout?: ReturnType<typeof setTimeout>;
  private markdownInsertionCursorPosition: number | null = null;
  private richTextInsertionRange: Range | null = null;

  private sanitizer = inject(DomSanitizer);
  private mediaService = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private customDialog = inject(CustomDialogService);
  private localSettingsService = inject(LocalSettingsService);

  constructor() {
    // Sync richTextMode input to internal signal
    effect(() => {
      this.isRichTextMode.set(this.richTextMode());
    });

    // React to external content changes
    effect(() => {
      const newContent = this.content();
      if (this.viewInitialized && !this.isInternalChange) {
        this.setContent(newContent || '');
      }
      this.isInternalChange = false;
    });
  }

  ngAfterViewInit() {
    this.viewInitialized = true;
    this.setContent(this.content() || '');

    // Reset drag counter when component initializes
    this.dragCounter = 0;
    this.isDragOver.set(false);

    // Add paste event listener for clipboard image handling
    this.setupPasteHandler();
  }

  onEditorFocus(): void {
    if (this.focusBlurTimeout) {
      clearTimeout(this.focusBlurTimeout);
      this.focusBlurTimeout = undefined;
    }
    this.isContentFocused.set(true);
    this.contentFocusChange.emit(true);
  }

  onEditorBlur(): void {
    this.focusBlurTimeout = setTimeout(() => {
      this.isContentFocused.set(false);
      this.contentFocusChange.emit(false);
    }, 60);
  }

  requestInsertReference(): void {
    this.captureInsertionPoint();
    this.insertReferenceRequest.emit();
  }

  preserveInsertionPoint(event: MouseEvent): void {
    event.preventDefault();
    this.captureInsertionPoint();
  }

  insertMarkdownAtCursor(markdown: string): void {
    if (!markdown.trim()) {
      return;
    }

    this.insertMarkdown(markdown);
  }

  requestAiAction(action: 'generate' | 'translate' | 'sentiment'): void {
    this.aiActionRequest.emit(action);
  }

  requestToggleRecording(): void {
    this.toggleRecordingRequest.emit();
  }

  requestTogglePreview(): void {
    this.togglePreviewRequest.emit();
  }

  requestToggleSplitView(): void {
    this.toggleSplitViewRequest.emit();
  }

  requestFeaturedImageUpload(): void {
    this.featuredImageUploadRequest.emit();
  }

  requestFeaturedImageLibrary(): void {
    this.featuredImageLibraryRequest.emit();
  }

  requestFeaturedImageUrl(): void {
    this.featuredImageUrlRequest.emit();
  }

  requestImportArticle(): void {
    this.importArticleRequest.emit();
  }

  setContent(content: string) {
    // Store the original markdown content
    this.markdownContent.set(content);

    // If in rich text mode, render the markdown as HTML
    if (this.isRichTextMode()) {
      this.renderMarkdownToEditor(content);
    }
  }

  toggleEditorMode() {
    const currentMode = this.isRichTextMode();

    // Always dismiss floating selection toolbar when changing modes.
    // Without this, toolbar can remain visible after switching to markdown.
    this.showFloatingToolbar.set(false);

    // Clear browser text selection to avoid stale selection state.
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    if (currentMode) {
      // Switching to markdown mode, convert rich text to markdown
      const markdown = this.convertRichTextToMarkdown();
      this.markdownContent.set(markdown);
    } else {
      // Switching to rich text mode, convert markdown to rich text
      this.renderMarkdownToEditor(this.markdownContent());
    }

    this.isRichTextMode.update(mode => !mode);

    // Emit mode change to parent component
    this.richTextModeChange.emit(this.isRichTextMode());

    // Set up paste handlers for the newly active editor
    setTimeout(() => {
      if (!this.isRichTextMode() && this.markdownTextarea) {
        this.markdownTextarea.nativeElement.addEventListener('paste', this.handlePaste.bind(this));
      }
    }, 100);
  }

  setEditorMode(richTextMode: boolean): void {
    if (this.isRichTextMode() === richTextMode) {
      return;
    }

    this.toggleEditorMode();
  }

  onMarkdownContentChange(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;
    // Mark this as an internal change to prevent re-rendering
    this.isInternalChange = true;
    // Update the stored markdown content
    this.markdownContent.set(value);
    // Emit the change event with the raw markdown
    this.contentChange.emit(value);
  }

  onRichTextContentChange() {
    const markdown = this.convertRichTextToMarkdown();
    // Mark this as an internal change to prevent re-rendering
    this.isInternalChange = true;
    this.markdownContent.set(markdown);
    this.contentChange.emit(markdown);
  }

  private renderMarkdownToEditor(markdown: string) {
    if (!markdown) {
      if (this.editorContent) {
        this.editorContent.nativeElement.innerHTML = '';
      }
      return;
    }

    // Use marked with the same configuration as the preview
    // This ensures consistency between editor and preview
    marked.use({
      gfm: true,
      breaks: true, // Enable line breaks like in the preview
      pedantic: false,
    });

    // Parse markdown to HTML using marked
    const html = marked.parse(markdown) as string;

    // Set content safely
    setTimeout(() => {
      if (this.editorContent) {
        this.editorContent.nativeElement.innerHTML = html;
      }
    }, 0);
  }

  private convertRichTextToMarkdown(): string {
    if (!this.editorContent) return '';

    let html = this.editorContent.nativeElement.innerHTML;

    // First, normalize browser-specific paragraph handling
    // Different browsers use different elements for paragraphs in contenteditable:
    // - Chrome/Edge use <div> elements
    // - marked.parse() creates <p> elements
    // We need to treat both as paragraph separators

    // Convert <div> elements to <p> for consistent handling
    // BUT preserve <div><br></div> as they represent blank lines
    html = html
      .replace(/<div><br><\/div>/gi, '<p><br></p>') // Blank line
      .replace(/<div([^>]*)>(.*?)<\/div>/gi, '<p$1>$2</p>'); // Regular div to p

    // Clean up spans that might be inserted by contenteditable
    html = html.replace(/<span[^>]*>(.*?)<\/span>/gi, '$1');

    // Convert HTML to Markdown with proper line break handling
    let markdown = html
      // Handle images BEFORE links (images have similar syntax)
      .replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)')
      .replace(/<img[^>]+alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '![$1]($2)')
      .replace(/<img[^>]+src="([^"]*)"[^>]*>/gi, '![]($1)')

      // Handle headings
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
      .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n')
      .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n')

      // Handle text formatting
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
      .replace(/<del[^>]*>(.*?)<\/del>/gi, '~~$1~~')
      .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')

      // Handle links (after images to avoid conflict)
      .replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')

      // Handle lists - more complex handling needed for nested lists
      .replace(/<ul[^>]*>(.*?)<\/ul>/gi, function (match: string, content: string) {
        const items = content
          .split(/<li[^>]*>(.*?)<\/li>/gi)
          .filter((item: string, i: number) => i % 2 === 1);
        return items.map((item: string) => `- ${item.trim()}`).join('\n') + '\n';
      })
      .replace(/<ol[^>]*>(.*?)<\/ol>/gi, function (match: string, content: string) {
        const items = content
          .split(/<li[^>]*>(.*?)<\/li>/gi)
          .filter((item: string, i: number) => i % 2 === 1);
        return items.map((item: string, i: number) => `${i + 1}. ${item.trim()}`).join('\n') + '\n';
      })

      // Handle blockquotes - MUST be done before handling <p> tags
      // because marked wraps blockquote content in <p> tags
      .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, function (match: string, content: string) {
        // Remove any <p> tags inside the blockquote first
        const cleanContent = content
          .replace(/<p[^>]*>(.*?)<\/p>/gis, '$1')
          .replace(/<br\s*\/?>/gi, '\n')
          .trim();
        // Split by newlines and prefix each line with >
        const lines = cleanContent.split('\n');
        return lines.map(line => `> ${line.trim()}`).join('\n') + '\n';
      })

      // Handle line breaks - CRITICAL for preserving single line breaks
      // Convert <br> tags to single newlines
      .replace(/<br\s*\/?>/gi, '\n')

      // Handle paragraphs - convert to double newlines for paragraph separation
      // Note: marked adds \n after </p> tags, so we end up with content\n\n\n which gets collapsed
      .replace(/<p[^>]*>(.*?)<\/p>/gis, function (match: string, content: string) {
        // Trim whitespace from inside the paragraph but preserve the content
        const trimmed = content.trim();
        // Empty paragraphs (or paragraphs with just whitespace/newlines) become blank lines
        if (!trimmed || trimmed === '\n') {
          return '\n\n';
        }
        return trimmed + '\n\n';
      })

      // Clean up any remaining HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");

    // CRITICAL: Remove ANY remaining HTML tags that might have slipped through
    markdown = markdown.replace(/<[^>]*>/g, '');

    // Clean up whitespace while preserving intentional line breaks
    markdown = markdown
      .replace(/ +\n/g, '\n') // Remove trailing spaces before newlines
      .replace(/\n +/g, '\n') // Remove leading spaces after newlines
      .replace(/\n\n\n+/g, '\n\n') // Collapse multiple blank lines to double newlines
      .trim();

    return markdown;
  }

  // Rich text formatting methods
  applyBold() {
    this.execCommand('bold');
  }

  applyItalic() {
    this.execCommand('italic');
  }

  applyHeading(level: number) {
    this.execCommand('formatBlock', `h${level}`);
  }

  applyQuote() {
    this.execCommand('formatBlock', 'blockquote');
  }

  applyUnorderedList() {
    this.execCommand('insertUnorderedList');
  }

  applyOrderedList() {
    this.execCommand('insertOrderedList');
  }

  applyLink() {
    const url = prompt('Enter link URL:', 'https://');
    if (url) {
      this.execCommand('createLink', url);
    }
  }

  insertCode() {
    const selection = window.getSelection();

    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const span = document.createElement('code');
      span.innerText = range.toString();
      range.deleteContents();
      range.insertNode(span);
      this.onRichTextContentChange();
    }
  }

  insertHorizontalRule() {
    this.execCommand('insertHorizontalRule');
  }

  private execCommand(command: string, value = '') {
    document.execCommand(command, false, value);
    this.onRichTextContentChange();
  }

  // File upload functionality
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.uploadFiles(Array.from(input.files));
    }
    // Reset the input so the same file can be selected again
    input.value = '';
  }

  openFileDialog(): void {
    this.fileInput.nativeElement.click();
  }

  openImageDialog(): void {
    this.fileInput.nativeElement.accept = 'image/*';
    this.fileInput.nativeElement.click();
  }

  private hasConfiguredMediaServers(): boolean {
    return this.mediaService.mediaServers().length > 0;
  }

  private showMediaServerWarning(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'No Media Server Configured',
        message: 'You need to configure a media server before selecting media. Would you like to set one up now?',
        confirmText: 'Setup Media Server',
        cancelText: 'Cancel',
        confirmColor: 'primary',
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
      }
    });
  }

  async openMediaChooser(): Promise<void> {
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    const { MediaChooserDialogComponent } = await import('../media-chooser-dialog/media-chooser-dialog.component');
    type MediaChooserResult = import('../media-chooser-dialog/media-chooser-dialog.component').MediaChooserResult;

    const dialogRef = this.customDialog.open<typeof MediaChooserDialogComponent.prototype, MediaChooserResult>(
      MediaChooserDialogComponent,
      {
        title: 'Choose from Library',
        width: '700px',
        maxWidth: '95vw',
        data: {
          multiple: true,
          mediaType: 'all',
        },
      }
    );

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (!result?.items?.length) {
        return;
      }

      const currentContent = this.content();
      for (const item of result.items) {
        if (currentContent.includes(item.url)) {
          continue;
        }
        this.insertFileLink(item.url, this.getFileNameFromUrl(item.url), item.type || '');
      }
    });
  }

  openAnyFileDialog(): void {
    this.fileInput.nativeElement.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar';
    this.fileInput.nativeElement.click();
  }

  insertImageFromUrl(): void {
    const dialogRef = this.dialog.open(ImageUrlDialogComponent, {
      width: '500px',
    });

    dialogRef.afterClosed().subscribe((url: string | undefined) => {
      if (url) {
        const markdown = `\n![Image](${url})\n`;
        this.insertMarkdown(markdown);
      }
    });
  }

  private insertMarkdown(markdown: string): void {
    if (this.isRichTextMode()) {
      // In rich text mode, insert at cursor or end
      const editor = this.editorContent.nativeElement;
      const selection = window.getSelection();
      let activeRange: Range | null = null;

      if (selection && selection.rangeCount > 0) {
        const currentRange = selection.getRangeAt(0);
        if (this.isRangeInsideEditor(currentRange)) {
          activeRange = currentRange;
        }
      }

      if (!activeRange) {
        activeRange = this.richTextInsertionRange;
      }

      if (activeRange) {
        try {
          const range = activeRange.cloneRange();
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = this.convertMarkdownToHtml(markdown);
          range.deleteContents();
          range.insertNode(tempDiv.firstChild || document.createTextNode(markdown));

          range.collapse(false);
          this.richTextInsertionRange = range.cloneRange();

          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        } catch {
          editor.innerHTML += this.convertMarkdownToHtml(markdown);
        }
      } else {
        editor.innerHTML += this.convertMarkdownToHtml(markdown);
      }
      this.onRichTextContentChange();
    } else {
      // In markdown mode, insert at cursor position
      const textarea = this.markdownTextarea.nativeElement;
      const rememberedCursor = this.markdownInsertionCursorPosition;
      const start = rememberedCursor ?? textarea.selectionStart;
      const end = rememberedCursor ?? textarea.selectionEnd;
      const currentValue = this.markdownContent();
      const newValue = currentValue.substring(0, start) + markdown + currentValue.substring(end);
      this.markdownContent.set(newValue);
      textarea.value = newValue;
      this.contentChange.emit(newValue);
      this.markdownInsertionCursorPosition = start + markdown.length;
      // Set cursor position after inserted content
      setTimeout(() => {
        const cursorPosition = this.markdownInsertionCursorPosition ?? start + markdown.length;
        textarea.selectionStart = textarea.selectionEnd = cursorPosition;
        textarea.focus();
      });
    }
  }

  private captureInsertionPoint(): void {
    if (this.isRichTextMode()) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (this.isRangeInsideEditor(range)) {
          this.richTextInsertionRange = range.cloneRange();
        }
      }
      return;
    }

    if (this.markdownTextarea) {
      const textarea = this.markdownTextarea.nativeElement as HTMLTextAreaElement;
      this.markdownInsertionCursorPosition = textarea.selectionStart;
    }
  }

  private isRangeInsideEditor(range: Range): boolean {
    if (!this.editorContent) {
      return false;
    }

    const editor = this.editorContent.nativeElement as HTMLElement;
    return editor.contains(range.startContainer);
  }

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter++;
    if (this.dragCounter === 1) {
      this.isDragOver.set(true);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Don't change state here, just prevent default
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;
    if (this.dragCounter <= 0) {
      this.dragCounter = 0;
      this.isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isDragOver.set(false);

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.uploadFiles(Array.from(event.dataTransfer.files));
    }
  }

  private async uploadFiles(files: File[]): Promise<void> {
    if (files.length === 0) return Promise.resolve();

    this.isUploading.set(true);

    try {
      // Load media service if not already loaded
      await this.mediaService.load();

      const uploadPromises = files.map(async file => {
        try {
          const result = await this.mediaService.uploadFile(
            file,
            false,
            this.mediaService.mediaServers()
          );

          if (result.status === 'success' && result.item) {
            this.insertFileLink(result.item.url, file.name, file.type);
            return { success: true, fileName: file.name };
          } else {
            return {
              success: false,
              fileName: file.name,
              error: result.message,
            };
          }
        } catch (error) {
          return {
            success: false,
            fileName: file.name,
            error: error instanceof Error ? error.message : 'Upload failed',
          };
        }
      });

      const results = await Promise.all(uploadPromises);

      // Show success/error messages
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      if (successful.length > 0) {
        this.snackBar.open(`${successful.length} file(s) uploaded successfully`, 'Close', {
          duration: 3000,
        });
      }

      if (failed.length > 0) {
        this.snackBar.open(`${failed.length} file(s) failed to upload`, 'Close', {
          duration: 5000,
        });
      }
    } catch (error) {
      this.snackBar.open(
        'Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
        'Close',
        { duration: 5000 }
      );
    } finally {
      this.isUploading.set(false);
    }

    return Promise.resolve();
  }

  private insertFileLink(url: string, fileName: string, fileType: string): void {
    const isImage = fileType.startsWith('image/');
    let markdownLink: string;

    if (isImage) {
      // For images, use image syntax with alt text
      markdownLink = `![${fileName}](${url})`;
    } else {
      // For other files, use link syntax
      markdownLink = `[${fileName}](${url})`;
    }

    if (this.isRichTextMode()) {
      // Insert into rich text editor
      this.insertMarkdownIntoRichText(markdownLink);
    } else {
      // Insert into markdown editor
      this.insertMarkdownIntoTextarea(markdownLink);
    }
  }

  private getFileNameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').pop() || url;
    } catch {
      return url;
    }
  }

  private insertMarkdownIntoRichText(markdown: string): void {
    if (!this.editorContent) return;

    // Convert markdown to HTML for rich text display
    const html = this.convertMarkdownToHtml(markdown);

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);

      // Create a temporary container to hold the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html + '<br><br>';

      // Insert all nodes from the temp div
      range.deleteContents();
      let node: Node | null;
      while ((node = tempDiv.firstChild)) {
        range.insertNode(node);
        range.setStartAfter(node);
      }

      // Collapse the range and update selection
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      this.onRichTextContentChange();
    } else {
      // No selection, append to end
      const content = this.editorContent.nativeElement;
      content.innerHTML += html + '<br><br>';
      this.onRichTextContentChange();
    }
  }

  private convertMarkdownToHtml(markdown: string): string {
    // Use marked for consistency with the editor and preview
    marked.use({
      gfm: true,
      breaks: true,
      pedantic: false,
    });
    return marked.parse(markdown) as string;
  }

  private insertMarkdownIntoTextarea(markdown: string): void {
    const currentContent = this.markdownContent();
    const cursorPosition = this.getCursorPositionInTextarea();

    const beforeCursor = currentContent.substring(0, cursorPosition);
    const afterCursor = currentContent.substring(cursorPosition);
    const insertedContent = markdown + '\n\n';

    const newContent = beforeCursor + insertedContent + afterCursor;
    this.markdownContent.set(newContent);
    this.contentChange.emit(newContent);

    const newCursorPosition = cursorPosition + insertedContent.length;
    this.markdownInsertionCursorPosition = newCursorPosition;

    if (this.markdownTextarea) {
      const textarea = this.markdownTextarea.nativeElement as HTMLTextAreaElement;
      textarea.value = newContent;
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = newCursorPosition;
        textarea.focus();
      });
    }
  }

  private getCursorPositionInTextarea(): number {
    if (this.markdownInsertionCursorPosition !== null) {
      return this.markdownInsertionCursorPosition;
    }

    if (this.markdownTextarea) {
      const textarea = this.markdownTextarea.nativeElement as HTMLTextAreaElement;
      return textarea.selectionStart;
    }

    return this.markdownContent().length;
  }

  private setupPasteHandler(): void {
    // Add paste handler to rich text editor
    if (this.editorContent) {
      this.editorContent.nativeElement.addEventListener('paste', this.handlePaste.bind(this));
    }

    // Add paste handler to markdown textarea (will be available when component switches to markdown mode)
    setTimeout(() => {
      if (this.markdownTextarea) {
        this.markdownTextarea.nativeElement.addEventListener('paste', this.handlePaste.bind(this));
      }
    }, 100);
  }

  private handlePaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    let hasImageFile = false;
    const imageFiles: File[] = [];

    // First pass: check for image files
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && this.isImageFile(file)) {
          hasImageFile = true;
          imageFiles.push(file);
        }
      }
    }

    // If we found image files, prevent ALL default behavior and upload them
    if (hasImageFile && imageFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Clear any selection to prevent unwanted HTML insertion
      if (this.isRichTextMode()) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          // Store the current selection to restore cursor position after upload
          const range = selection.getRangeAt(0);
          const startContainer = range.startContainer;
          const startOffset = range.startOffset;

          // Upload files and restore cursor position
          this.uploadFiles(imageFiles).then(() => {
            // Restore cursor position after upload
            setTimeout(() => {
              try {
                const newRange = document.createRange();
                newRange.setStart(startContainer, startOffset);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
              } catch (e) {
                // If restoring cursor position fails, just focus the editor
                this.editorContent.nativeElement.focus();
              }
            }, 100);
          });
        } else {
          this.uploadFiles(imageFiles);
        }
      } else {
        const target = event.target;
        if (target instanceof HTMLTextAreaElement) {
          this.markdownInsertionCursorPosition = target.selectionStart;
        }

        // For markdown mode, upload files and insert links at captured cursor position
        this.uploadFiles(imageFiles).finally(() => {
          this.markdownInsertionCursorPosition = null;
        });
      }

      return;
    }

    // Check for NIP-19 identifiers in text and auto-prefix with nostr:
    let text = event.clipboardData?.getData('text/plain');
    if (text) {
      // Check if tracking parameter removal is enabled and clean URLs
      // For performance, only process text up to 10KB (most pastes are much smaller)
      if (this.localSettingsService.removeTrackingParameters() && text.length < 10000) {
        const cleanedText = cleanTrackingParametersFromText(text);
        if (cleanedText !== text) {
          // Text was modified, prevent default paste and insert cleaned text
          event.preventDefault();
          event.stopPropagation();
          text = cleanedText;
          this.insertCleanedText(text);
          return;
        }
      }

      // Check for NIP-19 identifiers and auto-prefix with nostr:
      if (this.containsNip19Identifier(text)) {
        event.preventDefault();
        event.stopPropagation();
        this.insertTextWithNostrPrefix(text);
        return;
      }
    }

    // If no image files or NIP-19 identifiers, allow normal text pasting
    // The browser will handle text pasting automatically
  }

  private isImageFile(file: File): boolean {
    // Check if the file is an image by MIME type
    if (file.type.startsWith('image/')) {
      return true;
    }

    // Additional check by file extension as fallback
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|avif|heic|heif)$/i;
    return imageExtensions.test(file.name);
  }

  /**
   * Check if text contains NIP-19 identifiers that need nostr: prefix
   * Matches: note1, nevent1, npub1, nprofile1, naddr1, nsec1
   */
  private containsNip19Identifier(text: string): boolean {
    const nip19Pattern = /\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)[a-zA-Z0-9]+\b/;
    return nip19Pattern.test(text);
  }

  /**
   * Handle text selection to show/hide floating toolbar
   */
  onTextSelection() {
    if (!this.isRichTextMode()) {
      this.showFloatingToolbar.set(false);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.showFloatingToolbar.set(false);
      return;
    }

    const selectionRange = selection.getRangeAt(0);
    if (this.isRangeInsideEditor(selectionRange)) {
      this.richTextInsertionRange = selectionRange.cloneRange();
    }

    if (selection.isCollapsed) {
      this.showFloatingToolbar.set(false);
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      this.showFloatingToolbar.set(false);
      return;
    }

    // Get the position of the selection
    const range = selectionRange;
    const rect = range.getBoundingClientRect();

    // Position the toolbar above the selection
    const toolbarWidth = 280; // Approximate toolbar width
    const top = rect.top + window.scrollY - 50; // 50px above selection
    const left = rect.left + window.scrollX + rect.width / 2 - toolbarWidth / 2;

    this.floatingToolbarPosition.set({ top, left });
    this.showFloatingToolbar.set(true);
  }

  /**
   * Insert text with NIP-19 identifiers automatically prefixed with nostr:
   * According to NIP-27, all references should be in the format nostr:<identifier>
   */
  private insertTextWithNostrPrefix(text: string): void {
    // Replace NIP-19 identifiers with nostr: prefix if not already present
    // This regex matches NIP-19 identifiers that don't already have nostr: prefix
    const processedText = text.replace(
      /(?<!nostr:)\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)([a-zA-Z0-9]+)\b/g,
      'nostr:$1$2'
    );

    if (this.isRichTextMode()) {
      // For rich text mode, insert as text node
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(processedText);
        range.insertNode(textNode);

        // Move cursor to end of inserted text
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Update model from editor content
      const markdown = this.convertRichTextToMarkdown();
      this.isInternalChange = true;
      this.contentChange.emit(markdown);
    } else {
      // For markdown mode, insert at cursor position
      const textarea = this.markdownTextarea.nativeElement;
      const cursorPosition = textarea.selectionStart || 0;
      const currentContent = this.markdownContent() || '';

      const newContent =
        currentContent.substring(0, cursorPosition) +
        processedText +
        currentContent.substring(cursorPosition);

      this.isInternalChange = true;
      this.markdownContent.set(newContent);
      this.contentChange.emit(newContent);

      // Restore cursor position after the inserted text
      setTimeout(() => {
        const newCursorPosition = cursorPosition + processedText.length;
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
        textarea.focus();
      }, 0);
    }
  }

  /**
   * Insert cleaned text (with tracking parameters removed)
   */
  private insertCleanedText(text: string): void {
    if (this.isRichTextMode()) {
      // For rich text mode, insert as text node
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);

        // Move cursor to end of inserted text
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Update model from editor content
      const markdown = this.convertRichTextToMarkdown();
      this.isInternalChange = true;
      this.contentChange.emit(markdown);
    } else {
      // For markdown mode, insert at cursor position
      const textarea = this.markdownTextarea.nativeElement;
      const cursorPosition = textarea.selectionStart || 0;
      const currentContent = this.markdownContent() || '';

      const newContent =
        currentContent.substring(0, cursorPosition) + text + currentContent.substring(cursorPosition);

      this.isInternalChange = true;
      this.markdownContent.set(newContent);
      this.contentChange.emit(newContent);

      // Restore cursor position after the inserted text
      setTimeout(() => {
        const newCursorPosition = cursorPosition + text.length;
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
        textarea.focus();
      }, 0);
    }
  }
}
