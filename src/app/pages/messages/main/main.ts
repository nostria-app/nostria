import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-messages-main',
  imports: [],
  templateUrl: './main.html',
  styleUrl: './main.scss',
})
export class MessagesMain {}
