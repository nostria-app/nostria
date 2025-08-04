import { Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';

@Pipe({
  name: 'tags',
  standalone: true,
  pure: true,
})
export class TagsPipe implements PipeTransform {
  private datePipe = new DatePipe('en-US');

  transform(value: string[][], tag: string = 'published_at'): string {
    if (!value) {
      return '';
    }

    if (tag !== 'published_at') {
      // If the tag is not 'published_at', return the value as is
      return this.getTagValueFromTags(value, tag) || '';
    }

    const val = this.getTagValueFromTags(value, tag);

    if (!val) {
      return '';
    }

    const timestamp = Number.parseInt(val);

    // Convert Unix timestamp (seconds) to JavaScript timestamp (milliseconds)
    const date = new Date(timestamp * 1000);

    // Use Angular's built-in DatePipe for formatting
    // Formats include: 'short', 'medium', 'long', 'full', 'shortDate', 'mediumDate', etc.
    return this.datePipe.transform(date, 'medium') || '';
  }

  getTagValueFromTags(tags: string[][], key: string): string | undefined {
    for (const tag of tags) {
      if (tag.length >= 2 && tag[0] === key) {
        return tag[1];
      }
    }
    return undefined;
  }
}
