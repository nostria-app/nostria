import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-music-terms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="terms-container">
      <button mat-icon-button class="back-button" (click)="goBack()" aria-label="Go back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      
      <article class="terms-content">
        <h1>Music Terms of Service</h1>
        <p class="last-updated">Last updated: December 23, 2025</p>

        <section>
          <h2>Welcome to Nostria Music</h2>
          <p>
            By using the music features on Nostria, you agree to these terms. Please read them carefully. 
            Nostria Music is a decentralized music sharing platform built on the Nostr protocol.
          </p>
        </section>

        <section>
          <h2>Third-Party Hosting</h2>
          <p>
            Nostria does not host music files. All audio files are stored on third-party Blossom servers, 
            not on Nostria's infrastructure. Currently, Nostria uses the primal.net Blossom server, 
            but may utilize other Blossom servers in the future.
          </p>
          <p>
            Blossom servers are decentralized file storage providers that operate independently from Nostria.
          </p>
        </section>

        <section>
          <h2>Copyright & Ownership</h2>
          <p>
            <strong>You must own the rights to content you upload.</strong> Do not submit copyrighted material 
            unless you hold the copyright or have explicit permission from the copyright holder.
          </p>
          <p>
            Nostria reserves the right to filter out copyrighted content and content that violates these terms. 
            Violations may result in blacklisting from the platform.
          </p>
          <p>
            <strong>For Copyright Holders:</strong> If you believe your copyrighted work has been uploaded 
            without authorization, please contact the Blossom server provider directly. For content hosted 
            on primal.net, reach out to their support team. Nostria facilitates metadata only and does not 
            store the actual files.
          </p>
        </section>

        <section>
          <h2>Anti-Spam Policy</h2>
          <p>
            Spamming is strictly prohibited. Users who engage in spam activities will be blacklisted from the platform.
          </p>
          <p>
            Consistent abuse of the platform, including repeated spam violations, will result in IP-based 
            blacklisting to protect the community and maintain platform integrity.
          </p>
        </section>

        <section>
          <h2>Content Policy</h2>
          <p>
            <strong>Illegal content is strictly prohibited.</strong> Do not upload, share, or distribute 
            any content that violates local, national, or international laws.
          </p>
          <p>
            Nostria Music is a music platform. All published events must be music-related. Non-music content 
            will be filtered out, and users who repeatedly publish non-music events will be blacklisted.
          </p>
          <p>
            <strong>Zero Tolerance:</strong> Illegal content, including but not limited to illegal pornography, 
            content promoting violence, hate speech, or content violating intellectual property rights, 
            will result in immediate and permanent blacklisting.
          </p>
        </section>

        <section>
          <h2>AI-Generated Content</h2>
          <p>
            If your track was assisted in part or generated in full by AI, you must indicate this by 
            enabling the "AI-Generated" toggle when uploading. Misrepresenting AI-generated content 
            as human-created may result in content removal or account restrictions.
          </p>
        </section>

        <section>
          <h2>Zap Splits & Revenue</h2>
          <p>
            When you add collaborators and set zap splits, you are responsible for ensuring accurate 
            distribution percentages. Nostria is not responsible for disputes between collaborators 
            regarding zap distribution.
          </p>
          <p>
            All zap transactions occur directly on the Lightning Network and are irreversible.
          </p>
        </section>

        <section>
          <h2>Enforcement & Moderation</h2>
          <p>
            Nostria employs automated and manual moderation to enforce these terms. We reserve the right to:
          </p>
          <ul>
            <li>Filter or remove content that violates these terms</li>
            <li>Blacklist users who repeatedly violate these terms</li>
            <li>Implement IP-based restrictions for consistent abusers</li>
            <li>Update these terms at any time to protect the community</li>
          </ul>
        </section>

        <section>
          <h2>Questions?</h2>
          <p>
            If you have questions about these terms, please reach out via Nostr or through our community channels.
          </p>
          <p>
            By continuing to use Nostria Music, you acknowledge that you have read, understood, and agree 
            to these Terms of Service.
          </p>
        </section>
      </article>
    </div>
  `,
  styles: [`
    .terms-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 1rem;
      padding-bottom: 120px;
    }

    .back-button {
      margin-bottom: 1rem;
    }

    .terms-content {
      background: var(--mat-sys-surface-container);
      border-radius: var(--mat-sys-corner-large);
      padding: 2rem;

      @media (max-width: 600px) {
        padding: 1.5rem;
      }
    }

    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 2rem;
      color: var(--mat-sys-on-surface);

      @media (max-width: 600px) {
        font-size: 1.5rem;
      }
    }

    .last-updated {
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 2rem;
      font-size: 0.875rem;
    }

    section {
      margin-bottom: 2rem;

      &:last-child {
        margin-bottom: 0;
      }
    }

    h2 {
      margin: 0 0 1rem 0;
      font-size: 1.25rem;
      color: var(--mat-sys-on-surface);
    }

    p {
      margin: 0 0 1rem 0;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.7;

      &:last-child {
        margin-bottom: 0;
      }

      strong {
        color: var(--mat-sys-on-surface);
      }
    }

    ul {
      margin: 0;
      padding-left: 1.5rem;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.7;

      li {
        margin-bottom: 0.5rem;

        &:last-child {
          margin-bottom: 0;
        }
      }
    }
  `],
})
export class MusicTermsComponent {
  private router = inject(Router);

  goBack(): void {
    this.router.navigate(['/music']);
  }
}
