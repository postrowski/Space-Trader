import { Component, Input, OnInit } from '@angular/core';

@Component({
	selector: 'app-vertical-progress-bar',
	templateUrl: './vertical-progress-bar.component.html',
	styleUrls: ['./vertical-progress-bar.component.css']
})
export class VerticalProgressBarComponent implements OnInit {
	@Input() title: string = '';
	@Input() value: number = 0;
	@Input() maxValue: number = 100;
	@Input() threshold: number | null = null;

	bgColor: string = "#DDD";
	barColor: string = "green";
	textColor: string = "white";
	percentage: number = 0;

	constructor() { }

	ngOnInit() {
		this.updatePercentage();
	}

	ngOnChanges() {
		this.updatePercentage();
	}

	private updatePercentage() {
		if (this.maxValue == 0) {
			this.percentage = 0;
		} else {
			this.percentage = 100 * this.value / this.maxValue;
		}
		if (this.percentage > 100) {
			this.percentage = 100;
		}
		if (this.threshold == null) {
			if (this.maxValue == 0) {
				this.bgColor = "#DDD";
				this.textColor = "black";
			} else {
				let red = 0;
				let green = 255;
				let blue = 0;
				if (this.percentage >50) {
					red = (100-this.percentage) * 255/50;
					green = 255;
				} else {
					red = 255;
					green = (this.percentage) * 255/50;
				}
			
				this.bgColor = this.rgbToHex(red, green, blue);
			}
		} else {
			if (this.threshold > this.value) {
				this.bgColor = "#FF0000";
			} else {
				this.bgColor = "#EEEEEE";
			}
			this.textColor = "black";
		}
	}
	rgbToHex(r: number, g: number, b: number): string {
		return `#${(1 << 24 | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
	}
}

