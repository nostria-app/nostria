import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MetaService } from '../../services/meta.service';

@Component({
  selector: 'app-beta',
  standalone: true,
  imports: [MatCardModule],
  templateUrl: './beta.component.html',
  styleUrl: './beta.component.scss',
})
export class BetaComponent {
  private readonly meta = inject(MetaService);

  constructor() {
    this.meta.setTitle('Beta');
    this.meta.setDescription('Information about Nostria beta status and development process');
  }
}
