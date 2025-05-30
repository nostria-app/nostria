import { Injectable } from '@angular/core';
import { Event } from 'nostr-tools';

@Injectable({
  providedIn: 'root'
})
export class UtilitiesService {

  constructor() { }

  // Get d-tag value from an event
  getDTagValueFromEvent(event: Event): string | undefined {
    return this.getDTagValueFromTags(event.tags);
  }

  // Get all p-tag values from an event
  getPTagsValuesFromEvent(event: Event): string[] {
    return this.getPTagsValuesFromTags(event.tags);
  }

  // Get d-tag value
  getDTagValueFromTags(tags: string[][]): string | undefined {
    for (const tag of tags) {
      if (tag.length >= 2 && tag[0] === 'd') {
        return tag[1];
      }
    }
    return undefined;
  }

  // Get all p-tag values
  getPTagsValuesFromTags(tags: string[][]): string[] {
    const pTagValues: string[] = [];

    for (const tag of tags) {
      if (tag.length >= 2 && tag[0] === 'p') {
        pTagValues.push(tag[1]);
      }
    }

    return pTagValues;
  }

  getTagValues(tagName: string, tags: string[][]): string[] {
    const pTagValues: string[] = [];

    for (const tag of tags) {
      if (tag.length >= 2 && tag[0] === tagName) {
        pTagValues.push(tag[1]);
      }
    }

    return pTagValues;
  }
}
