import { Component } from '@angular/core';

@Component({
  selector: 'app-empty',
  standalone: true,
  template: '',
  styles: [':host { display: none; }']
})
export class EmptyComponent { }
