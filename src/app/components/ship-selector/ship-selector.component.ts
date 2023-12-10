import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';

@Component({
  selector: 'app-ship-selector',
  templateUrl: './ship-selector.component.html',
  styleUrls: ['./ship-selector.component.css']
})
export class ShipSelectorComponent implements OnChanges {
	allShipSymbols: string[] = [];
	_shipStates: { shipSymbol: string, value: boolean }[] | undefined;

	@Input()
	set shipStates(value: { shipSymbol: string, value: boolean }[] | undefined) {
		this._shipStates = value;
		this._shipStates?.sort((a, b) => {
			if (a.shipSymbol.length < b.shipSymbol.length) return -1;
			if (a.shipSymbol.length > b.shipSymbol.length) return 1;
			if (a.shipSymbol < b.shipSymbol) return -1;
			if (a.shipSymbol > b.shipSymbol) return 1;
			return 0;
		});
		this.shipStateRows = [];
		for (const state of this._shipStates || []) {
			if (!this.shipStateRows[this.shipStateRows.length-1] ||
				this.shipStateRows[this.shipStateRows.length-1].length == 16) {
				this.shipStateRows.push([]);
			}
			this.shipStateRows[this.shipStateRows.length-1].push(state);
		}
	}
	get shipStates(): { shipSymbol: string, value: boolean }[] | undefined {
		return this._shipStates;
	}

	shipStateRows: { shipSymbol: string, value: boolean }[][] = [];
	
	ngOnChanges(changes: SimpleChanges): void {
		if (changes['shipStates'] && changes['shipStates'].currentValue) {
			// Handle changes to shipStates here
			this.updateShipStates();
		}
	}
	private updateShipStates(): void {
		// Update logic when shipStates changes
		// Example: Re-sort and reorganize rows
		this._shipStates?.sort((a, b) => {
			if (a.shipSymbol.length < b.shipSymbol.length) return -1;
			if (a.shipSymbol.length > b.shipSymbol.length) return 1;
			if (a.shipSymbol < b.shipSymbol) return -1;
			if (a.shipSymbol > b.shipSymbol) return 1;
			return 0;
		});

		this.shipStateRows = [];
		for (const state of this._shipStates || []) {
			if (!this.shipStateRows[this.shipStateRows.length-1] ||
				this.shipStateRows[this.shipStateRows.length-1].length == 16) {
				this.shipStateRows.push([]);
			}
			this.shipStateRows[this.shipStateRows.length-1].push(state);
		}
	}
	onShipsChanged() {
	}
	onSelectAll(){
		this.shipStates?.forEach(s => s.value = true);
	}
	onSelectNone(){
		this.shipStates?.forEach(s => s.value = false);
	}
}
