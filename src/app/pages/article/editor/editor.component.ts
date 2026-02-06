import { Component, inject, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { ArticleEditorDialogComponent } from '../../../components/article-editor-dialog/article-editor-dialog.component';

@Component({
  selector: 'app-editor',
  template: '',
  styles: [],
})
export class EditorComponent implements OnInit {
  private dialog = inject(CustomDialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');

    // Open the article editor dialog
    const dialogRef = this.dialog.open(ArticleEditorDialogComponent, {
      width: '100%',
      maxWidth: '100%',
      disableClose: true,
      disableEnterSubmit: true,
      showCloseButton: true,
      title: id ? 'Edit Article' : 'New Article',
      data: { articleId: id || undefined }
    });

    // Set the dialogRef and data on the component instance
    dialogRef.componentInstance.dialogRef = dialogRef;
    dialogRef.componentInstance.data = { articleId: id || undefined };

    // When dialog closes, navigate back if we're still on this route
    const checkClosed = () => {
      if (dialogRef.isClosed()) {
        // Check if we are still on the editor route (dialog might have navigated away on publish)
        if (this.router.url.includes('/article/create') || this.router.url.includes('/article/edit')) {
          this.location.back();
        }
      } else {
        setTimeout(checkClosed, 100);
      }
    };
    checkClosed();
  }
}
