import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { CustomDialogService } from './custom-dialog.service';
import { LoggerService } from './logger.service';
import { Nip29InviteLinkService } from './nip29-invite-link.service';

describe('Nip29InviteLinkService', () => {
  let service: Nip29InviteLinkService;
  let routerSpy: Pick<Router, 'navigate'>;

  beforeEach(() => {
    routerSpy = {
      navigate: vi.fn().mockName('Router.navigate'),
    };
    vi.mocked(routerSpy.navigate).mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        Nip29InviteLinkService,
        { provide: Router, useValue: routerSpy },
        {
          provide: CustomDialogService,
          useValue: {
            open: vi.fn().mockName('CustomDialogService.open').mockReturnValue({
              afterClosed$: of({ result: 'nostria' as const }),
            }),
          },
        },
        {
          provide: LoggerService,
          useValue: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(Nip29InviteLinkService);
  });

  it('ignores unrelated URLs', () => {
    expect(service.tryHandle('https://example.com/about')).toBe(false);
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('ignores modifier-key clicks so the browser can open a new tab', () => {
    const event = { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false } as MouseEvent;
    expect(
      service.tryHandle('https://web.nostrord.com/#/g/chat.wisp.talk/pligeiproul', event)
    ).toBe(false);
  });

  it('opens the chooser and navigates internally when the user picks Nostria', async () => {
    const event = {
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as MouseEvent;

    expect(
      service.tryHandle('https://web.nostrord.com/#/g/chat.wisp.talk/pligeiproul?invite=abc', event)
    ).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(routerSpy.navigate).toHaveBeenCalledWith(
        ['/g', 'chat.wisp.talk', 'pligeiproul'],
        { queryParams: { invite: 'abc' } }
      );
    });
  });
});
