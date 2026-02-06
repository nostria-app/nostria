import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'name',
  pure: true,
})
export class NamePipe implements PipeTransform {
  transform(value?: any): string {
    if (!value) {
      return 'Unknown';
    }

    if (value.display_name) {
      return value.display_name;
    }

    if (value.name) {
      return value.name;
    }

    return 'Unknown';
  }
}
