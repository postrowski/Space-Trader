import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
	name: 'timeFormat',
})
export class TimeFormatPipe implements PipeTransform {
	transform(seconds: number): string {
	    const days = Math.floor(seconds / (24 * 3600));
	    const remainingSeconds = seconds % (24 * 3600);
	    const hours = Math.floor(remainingSeconds / 3600);
	    const minutes = Math.floor((remainingSeconds % 3600) / 60);
	    const remainingSecs = remainingSeconds % 60;
	
		let result = "";
		if (days > 0) {
			result = `${days}d `;
		}
		if (hours > 0 || (days > 0)) {
			result += `${this.padNumber(hours)}:`;
		}
		if (minutes > 0 || (hours > 0) || (days > 0)) {
			result += `${this.padNumber(minutes)}:`;
		}
		return result + `${this.padNumber(remainingSecs)}`;
	}

	private padNumber(num: number): string {
		return num < 10 ? `0${num}` : num.toString();
	}
}
