import { Component } from '@angular/core';
import { DBService } from 'src/app/services/db.service';
import { FleetService } from 'src/app/services/fleet.service';
import { MarketTransaction } from 'src/models/MarketTransaction';
import { Ship } from 'src/models/Ship';

@Component({
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  styleUrls: ['./transactions.component.css']
})
export class TransactionsComponent {
	transactions: MarketTransaction[] = [];
	ships: Ship[] = [];
	selectedShipSymbol: string | null = null;
	transactionsPerShip: Trans[] = [];
	constructor(private dbService: DBService,
	            private fleetService: FleetService) {
		this.dbService.initDatabase().then(() => {
			this.dbService.getAllMarketTransactions()
			              .then(transactions => {
							  this.transactions = transactions;
							  this.transactions.sort((t1, t2)=> this.timestampSorter(t1, t2));
							  this.onSelectedShipChanged();
						});
			this.fleetService.allShips$.subscribe((ships) => this.ships = ships);
		});
	}
	timestampSorter(m1: MarketTransaction, m2: MarketTransaction) {
		const t1 = new Date(m1.timestamp);
		const t2 = new Date(m2.timestamp);
		if (t1.getTime() < t2.getTime()) {
			return -1;
		}
		if (t1.getTime() > t2.getTime()) {
			return 1;
		}
		return 0;
	}
	onSelectedShipChanged() {
		this.transactionsPerShip = [];
		let credits = 0;
		for (const trans of this.transactions) {
			if (this.selectedShipSymbol == 'All' || trans.shipSymbol == this.selectedShipSymbol) {
				if (trans.type == 'SELL') {
					credits += trans.totalPrice;
				} else if (trans.type == 'PURCHASE') {
					credits -= trans.totalPrice;
				}
				this.transactionsPerShip.push(new Trans(trans, credits));
			}
		}
	}
	formatDate(dateStr: string) {
		const date = new Date(dateStr);
		return new Intl.DateTimeFormat('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			day: 'numeric',
			month: 'short'
		}).format(date);
	}
}

export class Trans extends MarketTransaction{
	totalCredits!: number;
	constructor(src: MarketTransaction, totalCredits: number) {
		super();
		this.waypointSymbol = src.waypointSymbol;
		this.shipSymbol = src.shipSymbol;
		this.tradeSymbol = src.tradeSymbol;
		this.totalPrice = src.totalPrice;
		this.timestamp = src.timestamp;
		this.type = src.type;
		this.units = src.units;
		this.pricePerUnit = src.pricePerUnit;
		this.totalCredits = totalCredits;
	}
}