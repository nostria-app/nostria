import { Component, Input, Output, EventEmitter, inject, signal, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer } from '@angular/platform-browser';
import { MediaService } from '../../services/media.service';

@Component({
  selector: 'app-rich-text-editor',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    FormsModule,
    MatButtonToggleModule,
    MatProgressBarModule,
    MatSnackBarModule
  ],
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.scss'
})
export class RichTextEditorComponent implements AfterViewInit {
  @Input() content: string = '';
  @Output() contentChange = new EventEmitter<string>();
  
  @ViewChild('editorContent') editorContent!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef;
  @ViewChild('markdownTextarea') markdownTextarea!: ElementRef;
  
  isRichTextMode = signal(true);
  markdownContent = signal('');
  isUploading = signal(false);
  isDragOver = signal(false);
  private dragCounter = 0;
  
  private sanitizer = inject(DomSanitizer);
  private mediaService = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  
  ngAfterViewInit() {
    this.setContent(this.content || '');
    
    // Reset drag counter when component initializes
    this.dragCounter = 0;
    this.isDragOver.set(false);
    
    // Add paste event listener for clipboard image handling
    this.setupPasteHandler();
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
    
    if (currentMode) {
      // Switching to markdown mode, convert rich text to markdown
      const markdown = this.convertRichTextToMarkdown();
      this.markdownContent.set(markdown);
    } else {
      // Switching to rich text mode, convert markdown to rich text
      this.renderMarkdownToEditor(this.markdownContent());
    }
    
    this.isRichTextMode.update(mode => !mode);
    
    // Set up paste handlers for the newly active editor
    setTimeout(() => {
      if (!this.isRichTextMode() && this.markdownTextarea) {
        this.markdownTextarea.nativeElement.addEventListener('paste', this.handlePaste.bind(this));
      }
    }, 100);
  }
  
  onMarkdownContentChange(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;
    // Update the stored markdown content
    this.markdownContent.set(value);
    // Emit the change event with the raw markdown
    this.contentChange.emit(value);
  }
  
  onRichTextContentChange() {
    const markdown = this.convertRichTextToMarkdown();
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

    // More comprehensive markdown to HTML conversion
    let html = markdown
      // Handle paragraphs (two newlines)
      .replace(/\n\n/g, '</p><p>')
      
      // Handle text formatting - non-greedy to prevent overlapping tags
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/~~(.*?)~~/g, '<del>$1</del>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      
      // Handle headings
      .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
      
      // Handle blockquotes
      .replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>')
      
      // Handle links
      .replace(/\[([^\[]+)\]\(([^\)]+)\)/g, '<a href="$2">$1</a>')
      
      // Handle unordered lists - collect consecutive list items
      .replace(/(?:^|\n)- (.*?)(?=\n(?!- )|$)/gs, function(match: string, item: string) {
        return '<ul><li>' + item.trim() + '</li></ul>';
      })
      
      // Handle ordered lists - collect consecutive list items
      .replace(/(?:^|\n)(\d+)\. (.*?)(?=\n(?!\d+\. )|$)/gs, function(match: string, num: string, item: string) {
        return '<ol><li>' + item.trim() + '</li></ol>';
      })
      
      // Handle remaining single newlines
      .replace(/\n/g, '<br>');
    
    // Wrap in paragraph if not already
    if (!html.startsWith('<h1>') && 
        !html.startsWith('<h2>') && 
        !html.startsWith('<h3>') && 
        !html.startsWith('<blockquote>') && 
        !html.startsWith('<ul>') && 
        !html.startsWith('<ol>') && 
        !html.startsWith('<p>')) {
      html = '<p>' + html + '</p>';
    }
    
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
    
    // Clean up extra divs and spans that might be inserted by the contenteditable
    html = html.replace(/<div><br><\/div>/g, '\n')
               .replace(/<div>(.*?)<\/div>/g, '\n$1')
               .replace(/<span>(.*?)<\/span>/g, '$1');
    
    // Convert HTML to Markdown
    let markdown = html
      // Handle newlines and paragraphs
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p>(.*?)<\/p>/gi, '$1\n\n')
      
      // Handle headings
      .replace(/<h1>(.*?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2>(.*?)<\/h2>/gi, '## $1\n\n')
      .replace(/<h3>(.*?)<\/h3>/gi, '### $1\n\n')
      .replace(/<h4>(.*?)<\/h4>/gi, '#### $1\n\n')
      .replace(/<h5>(.*?)<\/h5>/gi, '##### $1\n\n')
      .replace(/<h6>(.*?)<\/h6>/gi, '###### $1\n\n')
      
      // Handle text formatting
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i>(.*?)<\/i>/gi, '*$1*')
      .replace(/<del>(.*?)<\/del>/gi, '~~$1~~')
      .replace(/<code>(.*?)<\/code>/gi, '`$1`')
      
      // Handle blockquotes
      .replace(/<blockquote>(.*?)<\/blockquote>/gi, '> $1\n\n')
      
      // Handle links
      .replace(/<a href="(.*?)">(.*?)<\/a>/gi, '[$2]($1)')
      
      // Handle lists - more complex handling needed for nested lists
      .replace(/<ul>(.*?)<\/ul>/gi, function(match: string, content: string) {
        const items = content.split(/<li>(.*?)<\/li>/gi).filter((item: string, i: number) => i % 2 === 1);
        return items.map((item: string) => `- ${item}`).join('\n') + '\n\n';
      })
      .replace(/<ol>(.*?)<\/ol>/gi, function(match: string, content: string) {
        const items = content.split(/<li>(.*?)<\/li>/gi).filter((item: string, i: number) => i % 2 === 1);
        return items.map((item: string, i: number) => `${i+1}. ${item}`).join('\n') + '\n\n';
      })
      
      // Clean up any remaining HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
      
    // Remove any extra blank lines
    markdown = markdown.replace(/\n\n\n+/g, '\n\n').trim();
    
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
  
  private execCommand(command: string, value: string = '') {
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
      
      const uploadPromises = files.map(async (file) => {
        try {
          const result = await this.mediaService.uploadFile(file, false, this.mediaService.mediaServers());
          
          if (result.status === 'success' && result.item) {
            this.insertFileLink(result.item.url, file.name, file.type);
            return { success: true, fileName: file.name };
          } else {
            return { success: false, fileName: file.name, error: result.message };
          }
        } catch (error) {
          return { 
            success: false, 
            fileName: file.name, 
            error: error instanceof Error ? error.message : 'Upload failed' 
          };
        }
      });
      
      const results = await Promise.all(uploadPromises);
      
      // Show success/error messages
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      
      if (successful.length > 0) {
        this.snackBar.open(
          `${successful.length} file(s) uploaded successfully`, 
          'Close', 
          { duration: 3000 }
        );
      }
      
      if (failed.length > 0) {
        this.snackBar.open(
          `${failed.length} file(s) failed to upload`, 
          'Close', 
          { duration: 5000 }
        );
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
  
  private insertMarkdownIntoRichText(markdown: string): void {
    if (!this.editorContent) return;
    
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // Create a text node with the markdown
      const textNode = document.createTextNode(markdown + '\n\n');
      range.deleteContents();
      range.insertNode(textNode);
      
      // Move cursor after the inserted text
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
      
      this.onRichTextContentChange();
    } else {
      // No selection, append to end
      const content = this.editorContent.nativeElement;
      content.innerHTML += markdown + '<br><br>';
      this.onRichTextContentChange();
    }
  }
  
  private insertMarkdownIntoTextarea(markdown: string): void {
    const currentContent = this.markdownContent();
    const cursorPosition = this.getCursorPositionInTextarea();
    
    const beforeCursor = currentContent.substring(0, cursorPosition);
    const afterCursor = currentContent.substring(cursorPosition);
    
    const newContent = beforeCursor + markdown + '\n\n' + afterCursor;
    this.markdownContent.set(newContent);
    this.contentChange.emit(newContent);
  }
  
  private getCursorPositionInTextarea(): number {
    // For now, append to end. In a real implementation, you'd track cursor position
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
    let imageFiles: File[] = [];
    
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
        // For markdown mode, just upload without cursor management
        this.uploadFiles(imageFiles);
      }
      
      return;
    }
    
    // If no image files, allow normal text pasting
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
}
