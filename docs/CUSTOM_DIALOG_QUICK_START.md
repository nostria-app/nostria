# Custom Dialog - Quick Start Guide

## Basic Example

Here's a simple example of how to use the custom dialog component:

### 1. Create a signal to control visibility

```typescript
import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-my-page',
  standalone: true,
  imports: [CustomDialogComponent],
  template: `
    <button (click)="openDialog()">Open Dialog</button>
    
    @if (showDialog()) {
      <app-custom-dialog
        [title]="'Hello World'"
        (closed)="closeDialog()">
        
        <div dialog-content>
          <p>This is my dialog content!</p>
        </div>
        
        <div dialog-actions>
          <button mat-button (click)="closeDialog()">Cancel</button>
          <button mat-raised-button color="primary" (click)="save()">Save</button>
        </div>
      </app-custom-dialog>
    }
  `
})
export class MyPageComponent {
  showDialog = signal(false);
  
  openDialog() {
    this.showDialog.set(true);
  }
  
  closeDialog() {
    this.showDialog.set(false);
  }
  
  save() {
    console.log('Saving...');
    this.closeDialog();
  }
}
```

### 2. With Form Input

```typescript
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-edit-profile',
  standalone: true,
  imports: [CustomDialogComponent, MatFormFieldModule, MatInputModule, FormsModule],
  template: `
    @if (showDialog()) {
      <app-custom-dialog
        [title]="'Edit Profile'"
        [width]="'500px'"
        [disableClose]="true"
        (closed)="closeDialog()">
        
        <div dialog-content>
          <mat-form-field class="full-width">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="name" placeholder="Enter your name" />
          </mat-form-field>
          
          <mat-form-field class="full-width">
            <mat-label>Bio</mat-label>
            <textarea matInput [(ngModel)]="bio" rows="3"></textarea>
          </mat-form-field>
        </div>
        
        <div dialog-actions>
          <button mat-button (click)="closeDialog()">Cancel</button>
          <button mat-raised-button color="primary" (click)="save()">
            Save Changes
          </button>
        </div>
      </app-custom-dialog>
    }
  `
})
export class EditProfileComponent {
  showDialog = signal(false);
  name = '';
  bio = '';
  
  save() {
    console.log('Saving:', { name: this.name, bio: this.bio });
    this.closeDialog();
  }
  
  closeDialog() {
    this.showDialog.set(false);
  }
}
```

### 3. Multi-Step Dialog (like Login)

```typescript
import { Component, signal } from '@angular/core';

enum Step {
  WELCOME = 'welcome',
  DETAILS = 'details',
  CONFIRM = 'confirm'
}

@Component({
  selector: 'app-wizard',
  standalone: true,
  imports: [CustomDialogComponent],
  template: `
    @if (showDialog()) {
      <app-custom-dialog
        [title]="getTitle()"
        [showBackButton]="currentStep() !== Step.WELCOME"
        [showCloseButton]="currentStep() === Step.WELCOME"
        (closed)="closeDialog()"
        (backClicked)="goBack()">
        
        <div dialog-content>
          @if (currentStep() === Step.WELCOME) {
            <p>Welcome to the wizard!</p>
            <button mat-raised-button color="primary" (click)="nextStep()">
              Get Started
            </button>
          }
          
          @if (currentStep() === Step.DETAILS) {
            <p>Enter your details...</p>
            <button mat-raised-button color="primary" (click)="nextStep()">
              Continue
            </button>
          }
          
          @if (currentStep() === Step.CONFIRM) {
            <p>Confirm your choices...</p>
          </div>
          
          <div dialog-actions>
            @if (currentStep() === Step.CONFIRM) {
              <button mat-button (click)="closeDialog()">Cancel</button>
              <button mat-raised-button color="primary" (click)="finish()">
                Finish
              </button>
            }
          </div>
        </app-custom-dialog>
      }
    `
})
export class WizardComponent {
  showDialog = signal(false);
  currentStep = signal(Step.WELCOME);
  Step = Step;
  
  getTitle(): string {
    switch (this.currentStep()) {
      case Step.WELCOME: return 'Welcome';
      case Step.DETAILS: return 'Your Details';
      case Step.CONFIRM: return 'Confirm';
      default: return '';
    }
  }
  
  nextStep() {
    if (this.currentStep() === Step.WELCOME) {
      this.currentStep.set(Step.DETAILS);
    } else if (this.currentStep() === Step.DETAILS) {
      this.currentStep.set(Step.CONFIRM);
    }
  }
  
  goBack() {
    if (this.currentStep() === Step.DETAILS) {
      this.currentStep.set(Step.WELCOME);
    } else if (this.currentStep() === Step.CONFIRM) {
      this.currentStep.set(Step.DETAILS);
    }
  }
  
  finish() {
    console.log('Wizard complete!');
    this.closeDialog();
  }
  
  closeDialog() {
    this.showDialog.set(false);
    this.currentStep.set(Step.WELCOME); // Reset
  }
}
```

## Keyboard Shortcuts

The dialog automatically supports:

- **Enter**: Triggers the primary action button (button with `color="primary"` or class `primary-action`)
- **Escape**: Closes the dialog (unless `disableClose` is true)
- **Tab**: Navigate between focusable elements
- **Backdrop Click**: Closes the dialog (unless `disableClose` is true)

## Mobile Behavior

On mobile devices (screen width ≤ 600px or height ≤ 700px):

- Dialog appears as a bottom sheet (slides up from bottom)
- Takes full width of screen
- Rounded corners only at the top
- Automatically adjusts when keyboard appears
- Content remains scrollable above keyboard

## Styling Tips

### Full-width form fields

```scss
.full-width {
  width: 100%;
  margin-bottom: 16px;
}
```

### Centered content

```scss
:host ::ng-deep [dialog-content] {
  text-align: center;
}
```

### Custom dialog container

```scss
:host ::ng-deep .dialog-container {
  min-height: 300px;
}
```

## Common Patterns

### Confirmation Dialog

```html
<app-custom-dialog
  [title]="'Confirm Action'"
  [width]="'400px'"
  (closed)="cancel()">
  
  <div dialog-content>
    <p>Are you sure you want to proceed?</p>
  </div>
  
  <div dialog-actions>
    <button mat-button (click)="cancel()">Cancel</button>
    <button mat-raised-button color="warn" (click)="confirm()">Delete</button>
  </div>
</app-custom-dialog>
```

### Loading Dialog

```html
<app-custom-dialog
  [title]="'Processing'"
  [disableClose]="true"
  [showCloseButton]="false">
  
  <div dialog-content style="text-align: center; padding: 40px">
    <mat-spinner diameter="48"></mat-spinner>
    <p style="margin-top: 20px">Please wait...</p>
  </div>
</app-custom-dialog>
```

### Success Dialog

```html
<app-custom-dialog
  [title]="'Success!'"
  [width]="'400px'"
  (closed)="closeDialog()">
  
  <div dialog-content style="text-align: center">
    <mat-icon color="primary" style="font-size: 48px; height: 48px; width: 48px">
      check_circle
    </mat-icon>
    <p style="margin-top: 16px">Your changes have been saved successfully.</p>
  </div>
  
  <div dialog-actions style="justify-content: center">
    <button mat-raised-button color="primary" (click)="closeDialog()">OK</button>
  </div>
</app-custom-dialog>
```
