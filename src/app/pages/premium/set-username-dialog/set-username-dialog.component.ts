import { Component, inject, signal, OnDestroy, computed } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { debounceTime, firstValueFrom, of, Subject, switchMap, takeUntil } from 'rxjs';
import { AccountService } from '../../../api/services';
import { AccountStateService } from '../../../services/account-state.service';
import { UsernameService } from '../../../services/username';
import { HttpContext } from '@angular/common/http';
import { USE_NIP98 } from '../../../services/interceptors/nip98Auth';
import { Profile } from '../../../services/profile';
import { LoggerService } from '../../../services/logger.service';

export interface SetUsernameDialogData {
  currentUsername?: string | null;
}

@Component({
  selector: 'app-set-username-dialog',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatCheckboxModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ dialogTitle() }}</h2>
    <mat-dialog-content>
      <p class="dialog-description">
        {{ dialogDescription() }}
      </p>

      <form [formGroup]="usernameFormGroup">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Username</mat-label>
          <input
            matInput
            formControlName="username"
            placeholder="Choose a username"
            autocomplete="off"
          />
          <mat-icon matPrefix>alternate_email</mat-icon>
          @if (isCheckingUsername()) {
            <mat-spinner matSuffix diameter="20"></mat-spinner>
          } @else if (usernameFormGroup.valid) {
            <mat-icon matSuffix color="primary" matTooltip="Username is available">
              check_circle
            </mat-icon>
          } @else if (usernameFormGroup.get('username')?.value && usernameFormGroup.get('username')?.dirty) {
            <mat-icon matSuffix color="warn" matTooltip="Username is not available">error</mat-icon>
          }

          @if (usernameFormGroup.get('username')?.hasError('required')) {
            <mat-error>Username is required</mat-error>
          }
          @if (usernameFormGroup.get('username')?.hasError('minlength')) {
            <mat-error>Username must be at least 3 characters</mat-error>
          }
          @if (usernameFormGroup.get('username')?.hasError('pattern')) {
            <mat-error>Username must contain only letters, numbers, and underscores</mat-error>
          }
          @if (usernameFormGroup.get('username')?.errors?.['username']) {
            <mat-error>
              {{ usernameFormGroup.get('username')?.errors?.['username'] }}
            </mat-error>
          }
        </mat-form-field>

        @if (usernameFormGroup.valid && usernameFormGroup.get('username')?.value) {
          <div class="username-preview">
            <p class="preview-title"><strong>Your username will be:</strong></p>
            <p class="preview-text">
              <span class="username-part">{{ usernameFormGroup.get('username')?.value }}</span>
              <span class="domain-part">@nostria.app</span>
            </p>
            <p class="preview-text">
              <span class="domain-part">https://nostria.app/u/</span>
              <span class="username-part">{{ usernameFormGroup.get('username')?.value }}</span>
            </p>
          </div>

          <div class="nip05-section">
            @if (hasExistingNip05()) {
              <div class="existing-nip05">
                <mat-icon>info</mat-icon>
                <div>
                  <p class="nip05-label">Current NIP-05:</p>
                  <p class="nip05-value">{{ displayNip05() }}</p>
                </div>
              </div>
            }
            <mat-checkbox
              [(ngModel)]="shouldUpdateNip05"
              [ngModelOptions]="{standalone: true}"
              color="primary"
            >
              @if (hasExistingNip05()) {
                Update NIP-05 to <strong>{{ usernameFormGroup.get('username')?.value }}@nostria.app</strong>
              } @else {
                Set NIP-05 to <strong>{{ usernameFormGroup.get('username')?.value }}@nostria.app</strong>
              }
            </mat-checkbox>
          </div>
        }
      </form>

      <div class="info-box">
        <mat-icon>info</mat-icon>
        <p>
          Username must be at least 3 characters and can only contain letters, numbers, and underscores.
          Once set, your username cannot be changed.
        </p>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-flat-button
        color="primary"
        [disabled]="!usernameFormGroup.valid || isCheckingUsername() || isSaving()"
        (click)="onSave()"
      >
        @if (isSaving()) {
          <mat-spinner diameter="20" style="display: inline-block; margin-right: 8px;"></mat-spinner>
          Saving...
        } @else {
          Set Username
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-description {
      margin-bottom: 24px;
      color: var(--mat-sys-on-surface-variant);
    }

    .full-width {
      width: 100%;
    }

    .username-preview {
      margin: 16px 0;
      padding: 16px;
      background-color: var(--mat-sys-surface-container-high);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
    }

    .username-preview p {
      margin: 8px 0;
    }

    .username-preview .preview-title {
      color: var(--mat-sys-on-surface);
    }

    .preview-text {
      font-family: monospace;
      font-size: 14px;
      color: var(--mat-sys-on-surface-variant);
    }

    .username-part {
      font-weight: 500;
      color: var(--mat-sys-primary);
    }

    .domain-part {
      color: var(--mat-sys-on-surface-variant);
    }

    .info-box {
      display: flex;
      gap: 12px;
      padding: 12px;
      margin-top: 16px;
      background-color: var(--mat-sys-primary-container);
      border-radius: 8px;
      align-items: flex-start;
    }

    .info-box mat-icon {
      color: var(--mat-sys-on-primary-container);
      flex-shrink: 0;
    }

    .info-box p {
      margin: 0;
      font-size: 14px;
      color: var(--mat-sys-on-primary-container);
    }

    .nip05-section {
      margin: 16px 0;
      padding: 16px;
      background-color: var(--mat-sys-surface-container);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
    }

    .existing-nip05 {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 16px;
    }

    .existing-nip05 mat-icon {
      color: var(--mat-sys-on-surface-variant);
      flex-shrink: 0;
    }

    .nip05-label {
      margin: 0 0 4px 0;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .nip05-value {
      margin: 0;
      font-family: monospace;
      font-size: 14px;
      color: var(--mat-sys-on-surface);
      font-weight: 500;
    }

    .nip05-auto-set {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .nip05-auto-set mat-icon {
      flex-shrink: 0;
    }

    .nip05-auto-set p {
      margin: 0;
      font-size: 14px;
      color: var(--mat-sys-on-surface);
    }

    mat-dialog-content {
      min-width: 400px;
      max-width: 500px;
    }

    @media (max-width: 600px) {
      mat-dialog-content {
        min-width: 300px;
      }
    }
  `],
})
export class SetUsernameDialogComponent implements OnDestroy {
  private destroy$ = new Subject<void>();
  private formBuilder = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private usernameService = inject(UsernameService);
  private accountService = inject(AccountService);
  private accountState = inject(AccountStateService);
  private profileService = inject(Profile);
  private logger = inject(LoggerService);
  private dialogRef = inject(MatDialogRef<SetUsernameDialogComponent>);
  private dialogData = inject<SetUsernameDialogData>(MAT_DIALOG_DATA, { optional: true });

  isCheckingUsername = signal<boolean>(false);
  isSaving = signal<boolean>(false);
  isEditMode = signal<boolean>(false);
  existingNip05 = signal<string | string[] | null>(null);
  shouldUpdateNip05 = false;

  hasExistingNip05 = computed(() => {
    const nip05 = this.existingNip05();
    if (nip05 === null) return false;
    if (typeof nip05 === 'string') return nip05.trim() !== '';
    if (Array.isArray(nip05) && nip05.length > 0) return typeof nip05[0] === 'string' && nip05[0].trim() !== '';
    return false;
  });

  displayNip05 = computed(() => {
    const nip05 = this.existingNip05();
    if (nip05 === null) return null;
    if (typeof nip05 === 'string') return nip05;
    if (Array.isArray(nip05) && nip05.length > 0 && typeof nip05[0] === 'string') return nip05[0];
    return null;
  });

  dialogTitle = computed(() =>
    this.isEditMode() ? 'Change Your Premium Username' : 'Set Your Premium Username'
  );

  dialogDescription = computed(() =>
    this.isEditMode()
      ? 'Change your unique username for Nostria Premium. Your new username will be your identity across the platform.'
      : 'Choose your unique username for Nostria Premium. This will be your identity across the platform.'
  );

  usernameFormGroup = this.formBuilder.group({
    username: [
      '',
      [Validators.required, Validators.minLength(2), Validators.pattern('^[a-zA-Z0-9_]+$')],
    ],
  });

  constructor() {
    // Check if we're editing an existing username
    const currentUsername = this.dialogData?.currentUsername;
    if (currentUsername) {
      this.isEditMode.set(true);
      this.usernameFormGroup.patchValue({ username: currentUsername });
    }

    // Get existing NIP-05 from profile
    const currentProfile = this.accountState.profile();
    if (currentProfile?.data?.nip05) {
      this.existingNip05.set(currentProfile.data.nip05);
      // Default to updating NIP-05 only if user already has one
      this.shouldUpdateNip05 = true;
    } else {
      // For users without NIP-05, default to NOT setting it
      this.shouldUpdateNip05 = false;
    }

    // Setup username validation
    this.usernameFormGroup
      .get('username')
      ?.valueChanges.pipe(
        takeUntil(this.destroy$),
        debounceTime(500),
        switchMap(username => {
          if (!username || username.length < 2) {
            this.isCheckingUsername.set(false);
            return of(null);
          }

          // Skip validation if username hasn't changed from the current one
          if (currentUsername && username === currentUsername) {
            this.isCheckingUsername.set(false);
            return of(null);
          }

          this.isCheckingUsername.set(true);

          return this.usernameService.isUsernameAvailable(username);
        })
      )
      .subscribe(result => {
        this.isCheckingUsername.set(false);
        if (!result?.success) {
          this.usernameFormGroup.get('username')?.setErrors({
            username: result?.message || 'Username is not available',
          });
        }
      });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  async onSave(): Promise<void> {
    if (!this.usernameFormGroup.valid) {
      return;
    }

    this.isSaving.set(true);

    try {
      const username = this.usernameFormGroup.get('username')?.value;
      const pubkey = this.accountState.pubkey();

      if (!username || !pubkey) {
        throw new Error('Username or pubkey is missing');
      }

      // Update account with the new username
      await firstValueFrom(
        this.accountService.updateAccount(
          {
            body: {
              username,
            },
          },
          new HttpContext().set(USE_NIP98, true)
        )
      );

      // Refresh the subscription to get updated account data
      await this.accountState.refreshSubscription();

      // Update NIP-05 in profile only if user explicitly requested it
      // For users without existing NIP-05, they must check the checkbox
      // For users with existing NIP-05, they can choose whether to update
      if (this.shouldUpdateNip05) {
        const currentProfile = this.accountState.profile();
        const newNip05 = `${username}@nostria.app`;

        // Get existing profile data or create new one
        const profileData = currentProfile?.data ? { ...currentProfile.data } : {};
        profileData.nip05 = newNip05;

        // Update the profile with new NIP-05
        const profileResult = await this.profileService.updateProfile({
          profileData,
          skipMediaServerCheck: true,
        });

        if (!profileResult.success) {
          // Profile update failed, but username was set successfully
          // Show a warning but don't fail the whole operation
          this.snackBar.open(
            `Username set successfully, but failed to update NIP-05: ${profileResult.error}`,
            'OK',
            { duration: 5000 }
          );
          this.dialogRef.close(true);
          return;
        }
      }

      this.snackBar.open('Username set successfully!', 'OK', {
        duration: 3000,
      });

      this.dialogRef.close(true);
    } catch (error) {
      this.logger.error('Failed to set username:', error);

      let errorMessage = 'Failed to set username. Please try again.';

      if (error && typeof error === 'object' && 'error' in error) {
        const apiError = error.error as { error?: string };
        if (apiError?.error) {
          errorMessage = apiError.error;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      this.snackBar.open(errorMessage, 'OK', {
        duration: 5000,
      });
    } finally {
      this.isSaving.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
