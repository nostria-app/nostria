import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-messages-list',
  imports: [],
  templateUrl: './list.html',
  styleUrl: './list.scss',
})
export class MessagesList {}
