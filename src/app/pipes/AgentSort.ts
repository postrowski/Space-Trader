import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'sort',
  pure: false, // Set pure to false to enable dynamic sorting
})
export class SortPipe implements PipeTransform {
  transform(array: any[], field: string, direction: number): any[] {
    if (!Array.isArray(array) || !field) {
      return array;
    }

    // Perform sorting based on field and direction
    array.sort((a: any, b: any) => {
      const valueA = a[field];
      const valueB = b[field];
      if (valueA < valueB) {
        return -direction;
      } else if (valueA > valueB) {
        return direction;
      } else {
        return 0;
      }
    });

    return array;
  }
}
