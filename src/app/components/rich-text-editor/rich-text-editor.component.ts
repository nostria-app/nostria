import { Component, Input, Output, EventEmitter, inject, signal, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { DomSanitizer } from '@angular/platform-browser';

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
    MatButtonToggleModule
  ],
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.scss'
})
export class RichTextEditorComponent implements AfterViewInit {
  @Input() content: string = '';
  @Output() contentChange = new EventEmitter<string>();
  
  @ViewChild('editorContent') editorContent!: ElementRef;
  
  isRichTextMode = signal(true);
  markdownContent = signal('');
  
  private sanitizer = inject(DomSanitizer);
  
  ngAfterViewInit() {
    this.setContent(this.content || '');
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
}
