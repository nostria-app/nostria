/* tslint:disable */
/* eslint-disable */
/* Code generated by ng-openapi-gen DO NOT EDIT. */

import { HttpClient, HttpContext, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { StrictHttpResponse } from '../../strict-http-response';
import { RequestBuilder } from '../../request-builder';

import { NotificationRequest } from '../../models/notification-request';
import { NotificationResult } from '../../models/notification-result';

export interface NotificationSendPost$Params {
      body: NotificationRequest
}

export function notificationSendPost(http: HttpClient, rootUrl: string, params: NotificationSendPost$Params, context?: HttpContext): Observable<StrictHttpResponse<NotificationResult>> {
  const rb = new RequestBuilder(rootUrl, notificationSendPost.PATH, 'post');
  if (params) {
    rb.body(params.body, 'application/json');
  }

  return http.request(
    rb.build({ responseType: 'json', accept: 'application/json', context })
  ).pipe(
    filter((r: any): r is HttpResponse<any> => r instanceof HttpResponse),
    map((r: HttpResponse<any>) => {
      return r as StrictHttpResponse<NotificationResult>;
    })
  );
}

notificationSendPost.PATH = '/notification/send';
