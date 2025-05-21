import { Component, inject } from '@angular/core';
import { LoggerService } from '../../services/logger.service';

@Component({
  selector: 'app-debug-overlay',
  imports: [],
  templateUrl: './debug-overlay.component.html',
  styleUrl: './debug-overlay.component.scss'
})
export class DebugOverlayComponent {
  logger = inject(LoggerService);
}
