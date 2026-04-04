import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-empty',
  template: '',
  styles: [':host { display: none; }']
})
export class EmptyComponent { }
