import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { PollService } from '../../../services/poll.service';
import { PollDraft } from '../../../interfaces';

@Component({
  selector: 'app-poll-editor',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDatepickerModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  templateUrl: './poll-editor.component.html',
  styleUrl: './poll-editor.component.scss',
})
export class PollEditorComponent implements OnInit {
  private pollService = inject(PollService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);

  currentPoll = this.pollService.currentEditingPoll;
  isSaving = signal(false);

  pollForm: FormGroup;

  constructor() {
    this.pollForm = this.fb.group({
      content: ['', [Validators.required, Validators.minLength(3)]],
      pollType: ['singlechoice', Validators.required],
      endsAt: [null],
      options: this.fb.array([
        this.createOptionFormGroup(),
        this.createOptionFormGroup(),
      ]),
    });
  }

  ngOnInit(): void {
    const pollId = this.route.snapshot.paramMap.get('id');

    if (!pollId) {
      this.router.navigate(['/polls']);
      return;
    }

    // Check if we already have a poll being edited
    if (!this.currentPoll()) {
      // Try to load from existing polls or drafts
      const existingPoll = this.pollService.getPoll(pollId);
      if (existingPoll) {
        this.pollService.editPoll(existingPoll);
      } else {
        // Try loading as draft
        this.pollService.loadDraft(pollId);
      }
    }

    // Initialize form with current poll data
    const poll = this.currentPoll();
    if (poll) {
      this.initializeForm(poll);
    }
  }

  private initializeForm(poll: PollDraft): void {
    // Clear existing options
    const optionsArray = this.options;
    while (optionsArray.length) {
      optionsArray.removeAt(0);
    }

    // Add options from poll
    poll.options.forEach(option => {
      optionsArray.push(this.fb.group({
        id: [option.id],
        label: [option.label, Validators.required],
      }));
    });

    // Set form values
    this.pollForm.patchValue({
      content: poll.content,
      pollType: poll.pollType,
      endsAt: poll.endsAt ? new Date(poll.endsAt * 1000) : null,
    });
  }

  private createOptionFormGroup(): FormGroup {
    return this.fb.group({
      id: [this.generateOptionId()],
      label: ['', Validators.required],
    });
  }

  get options(): FormArray {
    return this.pollForm.get('options') as FormArray;
  }

  addOption(): void {
    this.options.push(this.createOptionFormGroup());
  }

  removeOption(index: number): void {
    if (this.options.length > 2) {
      this.options.removeAt(index);
    } else {
      this.snackBar.open('A poll must have at least 2 options', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    }
  }

  saveDraft(): void {
    if (!this.pollForm.valid) {
      this.snackBar.open('Please fill in all required fields', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
      return;
    }

    const formValue = this.pollForm.value;
    const endsAt = formValue.endsAt ? Math.floor(new Date(formValue.endsAt).getTime() / 1000) : undefined;

    this.pollService.updateCurrentPoll({
      content: formValue.content,
      options: formValue.options,
      pollType: formValue.pollType,
      endsAt,
    });

    this.pollService.saveDraft();

    this.snackBar.open('Draft saved successfully', 'Close', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom'
    });
  }

  async publishPoll(): Promise<void> {
    if (!this.pollForm.valid) {
      this.snackBar.open('Please fill in all required fields', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
      return;
    }

    const formValue = this.pollForm.value;
    const endsAt = formValue.endsAt ? Math.floor(new Date(formValue.endsAt).getTime() / 1000) : undefined;

    const draft: PollDraft = {
      id: this.currentPoll()?.id,
      content: formValue.content,
      options: formValue.options,
      pollType: formValue.pollType,
      relays: [], // Will be filled by service
      endsAt,
      isNewPoll: this.currentPoll()?.isNewPoll || true,
    };

    this.isSaving.set(true);

    try {
      await this.pollService.publishPoll(draft);
      this.snackBar.open('Poll published successfully!', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
      this.router.navigate(['/polls']);
    } catch (error) {
      console.error('Failed to publish poll:', error);
      this.snackBar.open('Failed to publish poll', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } finally {
      this.isSaving.set(false);
    }
  }

  cancel(): void {
    if (confirm('Are you sure you want to cancel? Any unsaved changes will be lost.')) {
      this.pollService.cancelEditing();
      this.router.navigate(['/polls']);
    }
  }

  private generateOptionId(): string {
    return Math.random().toString(36).substring(2, 11);
  }
}
