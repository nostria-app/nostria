import { HttpContextToken, HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { from, Observable, switchMap } from 'rxjs';
import { inject } from '@angular/core';
import { NostrService } from '../nostr.service';

export const USE_NIP98 = new HttpContextToken<boolean>(() => false);

export function nip98AuthInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> {
  const nostr = inject(NostrService);
  if (req.context.get(USE_NIP98)) {
    const method = req.method;
    const url = req.urlWithParams;

    return from(nostr.getNIP98AuthToken({ url, method })).pipe(
      switchMap(authHeader => {
        const cloned = req.clone({
          headers: req.headers.set('Authorization', `Nostr ${authHeader}`),
        });
        return next(cloned);
      })
    );
  } else {
    return next(req);
  }
}
