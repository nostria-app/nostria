import { Component, input } from '@angular/core';
import { NostrEvent } from '../../interfaces';

@Component({
  selector: 'app-content',
  imports: [],
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss'
})
export class ContentComponent {
  event = input<NostrEvent | null>();
  content = input<string | null>();

  
}
