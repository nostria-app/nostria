import { ChangeDetectionStrategy, Component, TemplateRef, ViewEncapsulation, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

const DEFAULT_DIALOG_ICON = 'responsive_layout';
const DEFAULT_PRIMARY_ACTION_TEXT = 'Looks good';
const DEFAULT_SECONDARY_ACTION_TEXT = 'Close';

export interface MaterialCustomDialogDetail {
  icon: string;
  title: string;
  description: string;
}

export interface MaterialCustomDialogData {
  title: string;
  message?: string;
  icon?: string;
  primaryActionText?: string;
  secondaryActionText?: string;
  details?: MaterialCustomDialogDetail[];
}

@Component({
  selector: 'app-material-custom-dialog',
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './material-custom-dialog.component.html',
  styleUrl: './material-custom-dialog.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaterialCustomDialogComponent {
  private dialogRef = inject(MatDialogRef<unknown, boolean>, { optional: true });
  private data = inject<MaterialCustomDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  title = input<string>();
  message = input<string>();
  icon = input<string>();
  primaryActionText = input<string>();
  secondaryActionText = input<string>();
  details = input<MaterialCustomDialogDetail[]>();
  contentTemplate = input<TemplateRef<unknown> | null>(null);
  actionsTemplate = input<TemplateRef<unknown> | null>(null);
  showHeader = input(true);
  showDefaultActions = input(true);
  showCloseButton = input(true);
  closeResult = input<boolean>(false);

  closed = output<boolean>();

  defaultIcon = DEFAULT_DIALOG_ICON;
  defaultPrimaryActionText = DEFAULT_PRIMARY_ACTION_TEXT;
  defaultSecondaryActionText = DEFAULT_SECONDARY_ACTION_TEXT;

  resolvedTitle = computed(() => this.title() ?? this.data?.title ?? '');
  resolvedMessage = computed(() => this.message() ?? this.data?.message ?? '');
  resolvedIcon = computed(() => this.icon() ?? this.data?.icon ?? this.defaultIcon);
  resolvedPrimaryActionText = computed(
    () => this.primaryActionText() ?? this.data?.primaryActionText ?? this.defaultPrimaryActionText,
  );
  resolvedSecondaryActionText = computed(
    () => this.secondaryActionText() ?? this.data?.secondaryActionText ?? this.defaultSecondaryActionText,
  );
  resolvedDetails = computed(() => this.details() ?? this.data?.details ?? []);
  resolvedIconMode = computed<'image' | 'material' | 'emoji'>(() => {
    const icon = this.resolvedIcon();

    if (!icon) {
      return 'material';
    }

    if (icon.includes('/') || icon.startsWith('data:')) {
      return 'image';
    }

    if (/^[a-zA-Z0-9_]+$/.test(icon)) {
      return 'material';
    }

    return 'emoji';
  });

  close(result = false): void {
    this.closed.emit(result);
    this.dialogRef?.close(result);
  }
}