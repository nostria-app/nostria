import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'time',
  standalone: true,
  pure: true,
})
export class TimePipe implements PipeTransform {
  constructor() {}

  transform(value?: number): string {
    if (!value) {
      return '00:00:00';
    }

    return TimePipe.time(value);
  }

  static time(value: number) {
    const hours = Math.floor(value / 60 / 60);
    const minutes = Math.floor(value / 60) - hours * 60;
    const seconds = value % 60;
    const formatted =
      hours.toString().padStart(2, '0') +
      ':' +
      minutes.toString().padStart(2, '0') +
      ':' +
      seconds.toString().padStart(2, '0');
    return formatted;
  }
}
