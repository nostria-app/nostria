import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatStepperModule } from '@angular/material/stepper';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormControl } from '@angular/forms';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { MatChipInputEvent } from '@angular/material/chips';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { FeedService, ColumnConfig } from '../../../services/feed.service';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

interface DialogData {
  icons: string[];
  column?: ColumnConfig;
}

// Common Nostr event kinds
const NOSTR_KINDS = [
  { value: 0, label: 'Metadata (0)' },
  { value: 1, label: 'Text Note (1)' },
  { value: 2, label: 'Recommend Relay (2)' },
  { value: 3, label: 'Contacts (3)' },
  { value: 4, label: 'Encrypted Direct Messages (4)' },
  { value: 5, label: 'Event Deletion (5)' },
  { value: 6, label: 'Repost (6)' },
  { value: 7, label: 'Reaction (7)' },
  { value: 8, label: 'Badge Award (8)' },
  { value: 16, label: 'Generic Repost (16)' },
  { value: 20, label: 'Picture (20)' },
  { value: 21, label: 'Video Event (21)' },
  { value: 40, label: 'Channel Creation (40)' },
  { value: 41, label: 'Channel Metadata (41)' },
  { value: 42, label: 'Channel Message (42)' },
  { value: 43, label: 'Channel Hide Message (43)' },
  { value: 44, label: 'Channel Mute User (44)' },
  { value: 1063, label: 'File Metadata (1063)' },
  { value: 1311, label: 'Live Chat Message (1311)' },
  { value: 1984, label: 'Reporting (1984)' },
  { value: 9734, label: 'Zap Request (9734)' },
  { value: 9735, label: 'Zap (9735)' },
  { value: 10000, label: 'Mute List (10000)' },
  { value: 10001, label: 'Pin List (10001)' },
  { value: 10002, label: 'Relay List Metadata (10002)' },
  { value: 30000, label: 'Categorized People List (30000)' },
  { value: 30001, label: 'Categorized Bookmark List (30001)' },
  { value: 30023, label: 'Long-form Content (30023)' },
  { value: 30024, label: 'Draft Long-form Content (30024)' },
  { value: 30078, label: 'Application-specific Data (30078)' }
];

@Component({
  selector: 'app-new-column-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatChipsModule,
    MatAutocompleteModule,
    MatStepperModule,
    MatCardModule,
    MatDividerModule,
    ReactiveFormsModule,
    MatButtonToggleModule
  ],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 mat-dialog-title>
          <mat-icon>{{ isEditMode() ? 'edit' : 'add_column_right' }}</mat-icon>
          {{ isEditMode() ? 'Edit Column' : 'Create New Column' }}
        </h2>
        <!-- <p class="dialog-subtitle">Configure your custom Nostr column</p> -->
      </div>

      <div class="dialog-content">
        <form [formGroup]="columnForm" (ngSubmit)="onSubmit()">
          <mat-stepper #stepper linear="false" class="column-stepper">
            <!-- Step 1: Basic Information -->
            <mat-step [stepControl]="basicInfoGroup">
              <ng-template matStepLabel>Basic Information</ng-template>
              <div class="step-content">
                <!-- Column Type Selection -->
                <div class="column-type-section">
                  <h3>Column Type</h3>
                  <div class="column-type-cards">
                    @for (type of columnTypes(); track type.key) {
                      <mat-card 
                        class="column-type-card" 
                        [class.selected]="selectedColumnType() === type.key"
                        (click)="selectColumnType(type.key)">
                        <mat-card-content>
                          <div class="type-header">
                            <mat-icon>{{ type.icon }}</mat-icon>
                            <h4>{{ type.label }}</h4>
                          </div>
                          <p class="type-description">{{ type.description }}</p>
                        </mat-card-content>
                      </mat-card>
                    }
                  </div>
                </div>

                <mat-divider></mat-divider>

                <!-- Basic Form Fields -->
                <div class="basic-fields">
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>Column Name</mat-label>
                    <input matInput formControlName="label" placeholder="My Custom Column">
                    <mat-icon matSuffix>label</mat-icon>
                    @if (columnForm.get('label')?.hasError('required')) {
                      <mat-error>Column name is required</mat-error>
                    }
                  </mat-form-field>
                  
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>Icon</mat-label>
                    <mat-select formControlName="icon">
                      @for (icon of data.icons; track icon) {
                        <mat-option [value]="icon">
                          <div class="icon-option">
                            <mat-icon>{{ icon }}</mat-icon>
                            <span>{{ icon }}</span>
                          </div>
                        </mat-option>
                      }
                    </mat-select>
                    <mat-icon matSuffix>{{ columnForm.get('icon')?.value || 'widgets' }}</mat-icon>
                  </mat-form-field>
                  
                
                </div>
              </div>
            </mat-step>

            <!-- Step 2: Content Configuration -->
            <mat-step [stepControl]="contentConfigGroup">
              <ng-template matStepLabel>Content Configuration</ng-template>
              <div class="step-content">
                <!-- Event Kinds Selection -->
                <div class="kinds-section">
                  <h3>Event Kinds</h3>
                  <p class="section-description">Select which types of Nostr events to include in this column</p>
                  
                  <mat-form-field class="full-width" appearance="outline">
                    <mat-label>Event Kinds</mat-label>
                    <mat-chip-grid #chipGrid aria-label="Event kinds selection">
                      @for (kind of selectedKinds(); track kind) {
                        <mat-chip-row (removed)="removeKind(kind)">
                          {{ getKindLabel(kind) }}
                          <button matChipRemove>
                            <mat-icon>cancel</mat-icon>
                          </button>
                        </mat-chip-row>
                      }
                    </mat-chip-grid>
                    <input
                      placeholder="Add event kind..."
                      #kindInput
                      [formControl]="kindInputControl"
                      [matChipInputFor]="chipGrid"
                      [matAutocomplete]="kindAutocomplete"
                      [matChipInputSeparatorKeyCodes]="separatorKeysCodes"
                      (matChipInputTokenEnd)="addKind($event)"
                    />
                    <mat-autocomplete #kindAutocomplete="matAutocomplete" (optionSelected)="kindSelected($event)">
                      @for (kind of filteredKinds(); track kind.value) {
                        <mat-option [value]="kind.value">
                          <strong>{{ kind.value }}</strong> - {{ kind.label }}
                        </mat-option>
                      }
                    </mat-autocomplete>
                    <mat-icon matSuffix>category</mat-icon>
                  </mat-form-field>
                </div>

                 <div class="kinds-section">
                  <h3>Following or Public</h3>
                  <p class="section-description">Select which events to include in this column</p>
                  
                  <mat-button-toggle-group name="source" formControlName="source">
                    <mat-button-toggle [disabled]="true" value="following">Following</mat-button-toggle>
                    <mat-button-toggle value="public">Public</mat-button-toggle>
                  </mat-button-toggle-group>

                </div>
              </div>
            </mat-step>

            <!-- Step 3: Relay Configuration -->
            <mat-step [stepControl]="relayConfigGroup">
              <ng-template matStepLabel>Relay Configuration</ng-template>
              <div class="step-content">
                <div class="relay-section">
                  <h3>Relay Source</h3>
                  <p class="section-description">Choose which relays to use for this column</p>
                  
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>Relay Configuration</mat-label>
                    <mat-select formControlName="relayConfig" (selectionChange)="onRelayConfigChange($event.value)">
                      <mat-option value="user">
                        <div class="relay-option">
                          <mat-icon>person</mat-icon>
                          <div>
                            <div class="option-title">User Relays</div>
                            <div class="option-description">Use your configured relays</div>
                          </div>
                        </div>
                      </mat-option>
                      <mat-option value="discovery">
                        <div class="relay-option">
                          <mat-icon>explore</mat-icon>
                          <div>
                            <div class="option-title">Discovery Relays</div>
                            <div class="option-description">Use discovery and search relays</div>
                          </div>
                        </div>
                      </mat-option>
                      <mat-option value="custom">
                        <div class="relay-option">
                          <mat-icon>settings</mat-icon>
                          <div>
                            <div class="option-title">Custom Relays</div>
                            <div class="option-description">Specify custom relay URLs</div>
                          </div>
                        </div>
                      </mat-option>
                    </mat-select>
                    <mat-icon matSuffix>dns</mat-icon>
                  </mat-form-field>

                  @if (showCustomRelays()) {
                    <div class="custom-relays-section">
                      <h4>Custom Relay URLs</h4>
                      <mat-form-field class="full-width" appearance="outline">
                        <mat-label>Custom Relays</mat-label>
                        <mat-chip-grid #relayChipGrid aria-label="Custom relays">
                          @for (relay of customRelays(); track relay) {
                            <mat-chip-row (removed)="removeCustomRelay(relay)">
                              {{ relay }}
                              <button matChipRemove>
                                <mat-icon>cancel</mat-icon>
                              </button>
                            </mat-chip-row>
                          }
                        </mat-chip-grid>
                        <input
                          placeholder="wss://relay.example.com"
                          #relayInput
                          [formControl]="relayInputControl"
                          [matChipInputFor]="relayChipGrid"
                          [matChipInputSeparatorKeyCodes]="separatorKeysCodes"
                          (matChipInputTokenEnd)="addCustomRelay($event)"
                        />
                        <mat-icon matSuffix>add_link</mat-icon>
                        <mat-hint>Enter WebSocket URLs (wss:// or ws://)</mat-hint>
                      </mat-form-field>
                    </div>
                  }

                  <!-- Relay Preview -->
                  <div class="relay-preview">
                    <h4>Active Relays Preview</h4>
                    <div class="relay-list">
                      @for (relay of getActiveRelays(); track relay) {
                        <div class="relay-item">
                          <mat-icon class="relay-status">wifi</mat-icon>
                          <span class="relay-url">{{ relay }}</span>
                        </div>
                      }
                      @if (getActiveRelays().length === 0) {
                        <div class="no-relays">
                          <mat-icon>warning</mat-icon>
                          <span>No relays configured</span>
                        </div>
                      }
                    </div>
                  </div>
                </div>
              </div>
            </mat-step>
          </mat-stepper>
        </form>
      </div>
      
      <div class="dialog-actions" mat-dialog-actions>
        <button mat-button mat-dialog-close type="button">Cancel</button>
        <button mat-flat-button color="primary" (click)="onSubmit()" [disabled]="!columnForm.valid">
          <mat-icon>{{ isEditMode() ? 'save' : 'add' }}</mat-icon>
          {{ isEditMode() ? 'Save Changes' : 'Create Column' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .dialog-container {
      // width: 800px;
      width: 100%;

      // max-width: 95vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .dialog-header {
      padding: 24px 24px 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.12);
      flex-shrink: 0;

      h2 {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0 0 8px 0;
        font-size: 1.5rem;
        font-weight: 500;
      }

      .dialog-subtitle {
        margin: 0;
        opacity: 0.7;
        font-size: 0.875rem;
      }
    }

    .dialog-content {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;

      form {
        height: 100%;
        display: flex;
        flex-direction: column;
      }
    }

    .column-stepper {
      flex: 1;
      overflow: hidden;

      ::ng-deep .mat-stepper-header-position-bottom {
        order: 2;
      }

      ::ng-deep .mat-step-text-label {
        font-weight: 500;
      }

      ::ng-deep .mat-horizontal-stepper-content {
        overflow: hidden;
      }
    }

    .step-content {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      overflow-y: auto;
      max-height: 50vh;
    }

    .dialog-actions {
      padding: 16px 24px;
      border-top: 1px solid rgba(0, 0, 0, 0.12);
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      flex-shrink: 0;
      background-color: var(--mat-app-background-color);

      button {
        display: flex;
        align-items: center;
        gap: 8px;
      }
    }

    .full-width {
      width: 100%;
    }

    .column-type-section {
      h3 {
        margin: 0 0 16px 0;
        font-size: 1.1rem;
        font-weight: 500;
      }
    }

    .column-type-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      align-items: stretch;
    }

    .column-type-card {
      cursor: pointer;
      transition: all 0.2s ease;
      border: 2px solid transparent;
      height: 110px;
      width: 100%;
      display: flex;
      flex-direction: column;

      &:hover {
        transform: translateY(-2px);
        box-shadow: var(--mat-sys-level2);
      }

      &.selected {
        border-color: var(--mat-sys-primary);
        background-color: rgba(var(--mat-sys-primary-rgb), 0.04);
      }

      mat-card-content {
        padding: 12px;
        text-align: center;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        flex: 1;
        height: 100%;
        box-sizing: border-box;
      }

      .type-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;

        mat-icon {
          font-size: 1.5rem;
          width: 1.5rem;
          height: 1.5rem;
        }

        h4 {
          margin: 0;
          font-size: 0.9rem;
          font-weight: 500;
          height: 1.2em;
          line-height: 1.2;
          display: flex;
          align-items: center;
          justify-content: center;
        }
      }

      .type-description {
        margin: 0;
        font-size: 0.75rem;
        opacity: 0.7;
        line-height: 1.2;
        height: 2.4em;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        overflow: hidden;
        flex: 1;
      }
    }

    .basic-fields {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .icon-option {
      display: flex;
      align-items: center;
      gap: 12px;

      mat-icon {
        color: var(--mat-sys-primary);
      }

      span {
        font-weight: 500;
      }
    }

    .kinds-section,
    .relay-section {
      h3, h4 {
        margin: 0 0 8px 0;
        font-size: 1.1rem;
        font-weight: 500;
      }

      .section-description {
        margin: 0 0 16px 0;
        opacity: 0.7;
        font-size: 0.875rem;
      }
    }

    .custom-relays-section {
      margin-top: 16px;
      padding: 16px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 8px;
      background-color: rgba(0, 0, 0, 0.02);
    }

    .relay-option {
      display: flex;
      align-items: center;
      gap: 12px;

      mat-icon {
        color: var(--mat-sys-primary);
      }

      .option-title {
        font-weight: 500;
        font-size: 0.95rem;
      }

      .option-description {
        font-size: 0.8rem;
        opacity: 0.7;
      }
    }

    .relay-preview {
      margin-top: 16px;

      h4 {
        margin: 0 0 12px 0;
        font-size: 0.95rem;
        font-weight: 500;
      }
    }

    .relay-list {
      max-height: 120px;
      overflow-y: auto;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 4px;
      background-color: rgba(0, 0, 0, 0.02);
    }

    .relay-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);

      &:last-child {
        border-bottom: none;
      }

      .relay-status {
        font-size: 1rem;
        width: 1rem;
        height: 1rem;
        color: #4caf50;
      }

      .relay-url {
        font-family: monospace;
        font-size: 0.85rem;
      }
    }

    .no-relays {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px;
      justify-content: center;
      opacity: 0.5;

      mat-icon {
        color: #ff9800;
      }
    }

    .dialog-actions {
      padding: 16px 24px;
      border-top: 1px solid rgba(0, 0, 0, 0.12);
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      flex-shrink: 0;
      background-color: var(--mat-app-background-color);

      button {
        display: flex;
        align-items: center;
        gap: 8px;
      }
    }

    mat-divider {
      margin: 16px 0;
    }

    // Improve chip appearance
    mat-chip-row {
      font-size: 0.875rem;
    }

    // Stepper improvements
    ::ng-deep .mat-stepper-horizontal {
      .mat-step-header {
        padding: 8px 24px;
      }
    }
  `]
})
export class NewColumnDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<NewColumnDialogComponent>);
  private feedService = inject(FeedService);
  readonly data: DialogData = inject(MAT_DIALOG_DATA);

  // Form controls
  basicInfoGroup = this.fb.group({
    label: [this.data.column?.label || '', Validators.required],
    icon: [this.data.column?.icon || 'chat'],
  });

  contentConfigGroup = this.fb.group({
    kinds: [this.data.column?.kinds || []],
    source: [this.data.column?.source || 'public'] 
  });

  relayConfigGroup = this.fb.group({
    relayConfig: [this.data.column?.relayConfig || 'user'],
    customRelays: [this.data.column?.customRelays || []]
  });

  columnForm = this.fb.group({
    ...this.basicInfoGroup.controls,
    ...this.contentConfigGroup.controls,
    ...this.relayConfigGroup.controls,
    type: [this.data.column?.type || 'custom']
  });

  // Signals and state
  isEditMode = signal(!!this.data.column);
  selectedColumnType = signal<string>(this.data.column?.type || 'custom');
  selectedKinds = signal<number[]>(this.data.column?.kinds || []);
  customRelays = signal<string[]>(this.data.column?.customRelays || []);
  showCustomRelays = computed(() => this.columnForm.get('relayConfig')?.value === 'custom');

  // Form controls for chips
  kindInputControl = new FormControl('');
  relayInputControl = new FormControl('');

  // Chip separator keys
  readonly separatorKeysCodes = [ENTER, COMMA] as const;

  // Available options
  columnTypes = signal(this.feedService.getFeedTypes());
  nostrKinds = signal(NOSTR_KINDS);

  // Filtered options for autocomplete
  filteredKinds = computed(() => {
    const input = this.kindInputControl.value?.toString().toLowerCase() || '';
    const selected = this.selectedKinds();

    return this.nostrKinds().filter(kind => {
      const matchesInput = kind.label.toLowerCase().includes(input) ||
        kind.value.toString().includes(input);
      const notSelected = !selected.includes(kind.value);
      return matchesInput && notSelected;
    });
  });

  selectColumnType(typeKey: string): void {
    this.selectedColumnType.set(typeKey);
    this.columnForm.patchValue({ type: typeKey as 'photos' | 'videos' | 'notes' | 'articles' | 'custom' });

    // Auto-fill based on column type
    const columnType = this.feedService.getFeedType(typeKey as any);
    if (columnType && columnType.kinds.length > 0) {
      this.selectedKinds.set(columnType.kinds);
      this.columnForm.patchValue({ kinds: columnType.kinds });
    }

    // Update icon and label if not in edit mode
    if (!this.isEditMode()) {
      this.columnForm.patchValue({
        icon: columnType.icon,
        label: columnType.label
      });
    }
  }

  getKindLabel(kind: number): string {
    const kindInfo = this.nostrKinds().find(k => k.value === kind);
    return kindInfo ? kindInfo.label : `Kind ${kind}`;
  }

  addKind(event: MatChipInputEvent): void {
    const value = event.value.trim();
    if (value) {
      const kindNumber = parseInt(value, 10);
      if (!isNaN(kindNumber) && !this.selectedKinds().includes(kindNumber)) {
        this.selectedKinds.update(kinds => [...kinds, kindNumber]);
        this.updateKindsForm();
      }
    }
    event.chipInput!.clear();
    this.kindInputControl.setValue('');
  }

  removeKind(kind: number): void {
    this.selectedKinds.update(kinds => kinds.filter(k => k !== kind));
    this.updateKindsForm();
  }

  kindSelected(event: MatAutocompleteSelectedEvent): void {
    const kindValue = event.option.value;
    if (!this.selectedKinds().includes(kindValue)) {
      this.selectedKinds.update(kinds => [...kinds, kindValue]);
      this.updateKindsForm();
    }
    this.kindInputControl.setValue('');
  }

  private updateKindsForm(): void {
    this.columnForm.patchValue({ kinds: this.selectedKinds() });
  }

  onRelayConfigChange(value: string): void {
    if (value !== 'custom') {
      this.customRelays.set([]);
      this.columnForm.patchValue({ customRelays: [] });
    }
  }

  addCustomRelay(event: MatChipInputEvent): void {
    const value = event.value.trim();
    if (value && this.feedService.validateRelayUrl(value)) {
      if (!this.customRelays().includes(value)) {
        this.customRelays.update(relays => [...relays, value]);
        this.updateCustomRelaysForm();
      }
    }
    event.chipInput!.clear();
    this.relayInputControl.setValue('');
  }

  removeCustomRelay(relay: string): void {
    this.customRelays.update(relays => relays.filter(r => r !== relay));
    this.updateCustomRelaysForm();
  }

  private updateCustomRelaysForm(): void {
    this.columnForm.patchValue({ customRelays: this.customRelays() });
  }

  getActiveRelays(): string[] {
    const relayConfig = this.columnForm.get('relayConfig')?.value;

    switch (relayConfig) {
      case 'user':
        return this.feedService.userRelays().map(r => r.url);
      case 'discovery':
        return this.feedService.discoveryRelays().map(r => r.url);
      case 'custom':
        return this.customRelays();
      default:
        return [];
    }
  }

  onSubmit(): void {
    if (this.columnForm.valid) {
      const formValue = this.columnForm.value;
      // Create column config
      const columnConfig: ColumnConfig = {
        id: this.data.column?.id || crypto.randomUUID(),
        label: formValue.label!,
        icon: formValue.icon!,
        type: formValue.type as any,
        source: formValue.source || 'public',
        kinds: this.selectedKinds(),
        relayConfig: formValue.relayConfig as any,
        customRelays: formValue.relayConfig === 'custom' ? this.customRelays() : undefined,
        filters: {},
        createdAt: this.data.column?.createdAt || Date.now(),
        updatedAt: Date.now()
      };

      this.dialogRef.close(columnConfig);
    }
  }
}
