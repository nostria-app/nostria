import { Pipe, PipeTransform } from '@angular/core';
import { formatRelativeTimeAgo, type RelativeTimeFormat } from '../utils/relative-time';

@Pipe({ name: 'ago' })
export class AgoPipe implements PipeTransform {
  transform(value: number | null | undefined, format?: RelativeTimeFormat): string {
    return formatRelativeTimeAgo(value, format ?? 'long');
  }
}
