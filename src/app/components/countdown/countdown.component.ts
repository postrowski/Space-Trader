import { Component, Input, OnChanges, OnInit, SimpleChange, SimpleChanges } from '@angular/core';
import { Cooldown } from 'src/models/Cooldown';

@Component({
	selector: 'app-countdown',
	templateUrl: './countdown.component.html',
	styleUrls: ['./countdown.component.css']
})
export class CountdownComponent implements OnInit, OnChanges {
	private _cooldown?: Cooldown;
	private _startTimeStr?: string;
	private _endTimeStr?: string;

	@Input() title?: string;
	@Input()
	set cooldown(value: Cooldown | undefined) {
		this._cooldown = value;
		if (value) {
			this.remainingSeconds = value.remainingSeconds;
			this.totalSeconds = value.totalSeconds;
		} else {
			this.remainingSeconds = 0;
			this.totalSeconds = 0;
		}
		this.startCountdown();
	}

	get cooldown(): Cooldown | undefined {
		return this._cooldown;
	}

	@Input()
	set startTimeStr(value: string | undefined) {
		this._startTimeStr = value;
		this.setTimes();
	}
	get startTimeStr(): string | undefined { return this._startTimeStr; }
	@Input()
	set endTimeStr(value: string | undefined) {
		this._endTimeStr = value;
		this.setTimes();
	}
	get endTimeStr(): string | undefined { return this._endTimeStr; }

	setTimes() {
		if (this._endTimeStr) {
			let startTime;
			if (this._startTimeStr) {
				startTime = new Date(this._startTimeStr!).getTime();
			} else {
				startTime = Date.now();
			}
			let endTime = new Date(this._endTimeStr!).getTime();
			let now = Date.now();
			this.totalSeconds = Math.floor((endTime - startTime + 999) / 1000);
			this.remainingSeconds = Math.floor((endTime - now + 999) / 1000);
			this.startCountdown();
		}
	}
	totalSeconds: number = 0;
	remainingSeconds: number = 0;

	private countdownInterval: any;

	ngOnInit() {
		this.startCountdown();
	}
	
	ngOnChanges(changes: SimpleChanges): void {
    if ('cooldown' in changes) {
      const change: SimpleChange = changes['cooldown'];
      if (change.currentValue && change.currentValue.remainingSeconds !== change.previousValue?.remainingSeconds) {
        // Handle the change in remainingSeconds here
        const newRemainingSeconds = change.currentValue.remainingSeconds;
        console.log(`Remaining Seconds changed to: ${newRemainingSeconds}`);
      }
    }
  }

	private startCountdown() {
		if (this.countdownInterval) {
			clearInterval(this.countdownInterval);
		}
		this.countdownInterval = setInterval(() => {
			if (this.remainingSeconds > 0) {
				this.remainingSeconds--;
			} else {
				clearInterval(this.countdownInterval);
			}
			if (this._cooldown && this._cooldown.remainingSeconds > 0) {
				// recompute the remaining seconds, because if we just decrement it
				// and there are more than 1 cooldown object doing that, the timer
				// will drop faster than it should.
				let remainingSeconds = new Date(this._cooldown.expiration).getTime() - Date.now();
				this._cooldown.remainingSeconds = Math.max(0, remainingSeconds);
			}
		}, 1000);
	}

	getClass() {
		let bg = this.remainingSeconds > 0 ? 'red-background' : 'green-background';
		let width = 'narrow';
		if (this.remainingSeconds > 60) {
			width = 'normal';
			if (this.remainingSeconds > 60*60) {
				width = 'wide';
				if (this.remainingSeconds > 60*60 * 24) {
					width = 'x-wide';
				}
			}
		}
		return bg + ' ' + width;
	}
}
