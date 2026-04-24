import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';

import { FeaturedFeedCardComponent } from './featured-feed-card.component';
import { AccountStateService } from '../../../services/account-state.service';
import { AiService } from '../../../services/ai.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { FeaturedFeedCard, FeaturedFeedCardsService } from '../../../services/featured-feed-cards.service';
import { LayoutService } from '../../../services/layout.service';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { MediaPlayerService } from '../../../services/media-player.service';

describe('FeaturedFeedCardComponent', () => {
  let component: FeaturedFeedCardComponent;
  let fixture: ComponentFixture<FeaturedFeedCardComponent>;
  let featuredFeedCards: {
    markImpression: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    markClick: ReturnType<typeof vi.fn>;
  };
  let customDialog: {
    open: ReturnType<typeof vi.fn>;
  };
  let localSettings: {
    setFeaturedFeedCardsEnabled: ReturnType<typeof vi.fn>;
  };

  const card: FeaturedFeedCard = {
    id: 'nostria-subscription',
    icon: 'diamond',
    eyebrow: 'Premium access',
    title: 'Sign up for Nostria subscription',
    description: 'Unlock the extra layer of Nostria and keep the project sustainable while you are at it.',
    ctaLabel: 'See plans',
    primaryRoute: ['/premium/upgrade'],
    tone: 'tertiary',
  };

  beforeEach(async () => {
    featuredFeedCards = {
      markImpression: vi.fn(),
      dismiss: vi.fn(),
      markClick: vi.fn(),
    };

    customDialog = {
      open: vi.fn(),
    };

    localSettings = {
      setFeaturedFeedCardsEnabled: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [FeaturedFeedCardComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CustomDialogService,
          useValue: customDialog,
        },
        {
          provide: LocalSettingsService,
          useValue: localSettings,
        },
        {
          provide: FeaturedFeedCardsService,
          useValue: featuredFeedCards,
        },
        {
          provide: AccountStateService,
          useValue: {
            pubkey: () => 'viewer',
            followingList: () => [],
            follow: vi.fn(),
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn() },
        },
        {
          provide: MatSnackBar,
          useValue: { open: vi.fn() },
        },
        {
          provide: MediaPlayerService,
          useValue: { replaceQueue: vi.fn() },
        },
        {
          provide: AiService,
          useValue: { queueStandardPrompt: vi.fn() },
        },
        {
          provide: LayoutService,
          useValue: { openProfile: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeaturedFeedCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('instanceId', 'feed:nostria-subscription:event-1');
    fixture.detectChanges();
  });

  it('should hide only the current card when requested', async () => {
    customDialog.open.mockReturnValue({
      afterClosed$: of({ result: 'hide-one', closedViaBackButton: false }),
    });

    await component.dismiss();

    expect(featuredFeedCards.dismiss).toHaveBeenCalledWith('feed:nostria-subscription:event-1', 'nostria-subscription');
    expect(localSettings.setFeaturedFeedCardsEnabled).not.toHaveBeenCalled();
  });

  it('should disable all featured cards when requested', async () => {
    customDialog.open.mockReturnValue({
      afterClosed$: of({ result: 'disable-all', closedViaBackButton: false }),
    });

    await component.dismiss();

    expect(localSettings.setFeaturedFeedCardsEnabled).toHaveBeenCalledWith(false);
    expect(featuredFeedCards.dismiss).not.toHaveBeenCalled();
  });
});