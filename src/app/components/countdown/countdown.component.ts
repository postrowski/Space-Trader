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
	private endTime = 0;
	totalSeconds: number = 0;
	remainingSeconds: number = 0;

	private countdownInterval: any;

	@Input() title?: string;
	@Input()
	set cooldown(value: Cooldown | undefined) {
		this._cooldown = value;
		if (value) {
			this.remainingSeconds = value.remainingSeconds;
			this.totalSeconds = value.totalSeconds;
			this.endTime = new Date(value.expiration).getTime();
		} else {
			this.remainingSeconds = 0;
			this.totalSeconds = 0;
			this.endTime = 0;
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
			let startTime = (this._startTimeStr) ? new Date(this._startTimeStr).getTime() : Date.now();
			this.endTime = new Date(this._endTimeStr).getTime();
			this.totalSeconds = Math.max(0, Math.floor((this.endTime - startTime + 999) / 1000));
			this.remainingSeconds = Math.max(0, Math.floor((this.endTime - Date.now() + 999) / 1000));
			this.startCountdown();
		}
	}

	ngOnInit() {
		this.startCountdown();
	}
	
	ngOnChanges(changes: SimpleChanges): void {
		if ('cooldown' in changes) {
			const change: SimpleChange = changes['cooldown'];
			if (change.currentValue?.remainingSeconds !== change.previousValue?.remainingSeconds) {
				// Handle the change in remainingSeconds here
				const newRemainingSeconds = change.currentValue.remainingSeconds;
			}
		}
	}

	private startCountdown() {
		if (this.countdownInterval) {
			clearInterval(this.countdownInterval);
		}
		this.countdownInterval = setInterval(() => {
			// recompute the remaining seconds, because if we just decrement it
			// and there are more than 1 cooldown object doing that, the timer
			// will drop faster than it should.
			this.remainingSeconds = Math.max(0, Math.floor((this.endTime - Date.now() + 999) / 1000));
			if (this._cooldown) {
				this._cooldown.remainingSeconds = this.remainingSeconds;
			}
			if (this.remainingSeconds === 0) {
				clearInterval(this.countdownInterval);
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
