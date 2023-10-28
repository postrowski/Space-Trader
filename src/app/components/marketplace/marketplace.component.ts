import { Component, Input, OnInit } from '@angular/core';
import { AccountService } from 'src/app/services/account.service';
import { FleetService } from 'src/app/services/fleet.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { MarketService } from 'src/app/services/market.service';
import { ModalService } from 'src/app/services/modal.service';
import { Agent } from 'src/models/Agent';
import { Market, MarketItem } from 'src/models/Market';
import { Ship } from 'src/models/Ship';
import { ShipCargoItem } from 'src/models/ShipCargoItem';
import { WaypointBase, WaypointTrait } from 'src/models/WaypointBase';

@Component({
  selector: 'app-marketplace',
  templateUrl: './marketplace.component.html',
  styleUrls: ['./marketplace.component.css']
})
export class MarketplaceComponent implements OnInit{
	waypoint: WaypointBase | null = null;
	account: Agent | null = null;

	marketplace?: Market;
	goods: TypedMarketItem[] = [];
	shipsAtWaypoint: Ship[] = [];
	selectedShip: Ship | null = null;
	selectedExportItem: MarketItem | null = null;
	selectedImportItem: MarketItem | null = null;
	selectedTradeItem: TypedMarketItem | null = null;
	selectedCargoItem: ShipCargoItem | null = null;
	sellImportQty: number = 0;
	buyExportQty: number = 0;
	buyTradeQty: number = 0;
	sellTradeQty: number = 0;
	showTransactions = false;
	
	constructor(public galaxyService: GalaxyService,
	            public fleetService: FleetService,
	            public accountService: AccountService,
   		        public marketService: MarketService,
	            public modalService: ModalService) {
		modalService.waypoint$.subscribe((response) => {
			this.waypoint = response;
			this.ngOnInit();
		})
		accountService.agent$.subscribe((response) => {
			this.account = response;
		})
	}
	
	ngOnInit(): void {
		this.loadShips();
		this.loadMarket();
	}
	
	hasTrait(traitSymbol: string) {
		if (this.waypoint?.traits) {
			for (let trait of this.waypoint.traits) {
				if (trait.symbol == traitSymbol) {
					return true;
				}
			}
		}
		return false;
	}
	
	hasMarketplace() {
		return this.hasTrait(WaypointTrait[WaypointTrait.MARKETPLACE]);
	}

	loadMarket() {
		this.marketplace = undefined;
		this.selectedCargoItem = null;
		this.goods = [];
		if (this.waypoint && this.hasMarketplace()) {
			this.marketService.getMarketplace(this.waypoint.symbol, this.shipsAtWaypoint.length> 0)
			                  .subscribe((response) => {
				this.marketplace = response;
				let goods: TypedMarketItem[] = [];
				if (this.marketplace.tradeGoods) {
					for (const trade of this.marketplace.tradeGoods) {
						let item: TypedMarketItem = {
							symbol: trade.symbol,
							name: trade.symbol,
							tradeVolume: trade.tradeVolume,
							supply: trade.supply,
							purchasePrice: trade.purchasePrice,
							sellPrice: trade.sellPrice,
							description: '',
							type: '' 
						}
						goods.push(item);
					}
				}
				this.fillInType(this.marketplace.exports, goods, 'Export');
				this.fillInType(this.marketplace.imports, goods, 'Import');
				this.fillInType(this.marketplace.exchange, goods, 'Exchange');
				this.goods = goods.sort((g1, g2) => {
					//if (g1.type != g2.type) {
					//	return this.compare(g1.type, g2.type);
					//}
					return this.compare(g1.symbol, g2.symbol);
				});
				return;
			});
		}
	}
	compare(s1: string, s2:string) {
		if (s1 < s2) return -1;
		if (s1 > s2) return 1;
		return 0;
	}
	fillInType(items: MarketItem[], goods: TypedMarketItem[], type: string) {
		for (const importItem of items) {
			let found = false;
			for (const good of goods) {
				if (good.symbol == importItem.symbol) {
					good.type = type;
					good.name = importItem.name;
					good.description = importItem.description;
					found = true;
					break;
				}
			}
			if (!found) {
				let good: TypedMarketItem = {
					symbol: importItem.symbol,
					name: importItem.name,
					tradeVolume: 0,
					supply: '???',
					purchasePrice: 0,
					sellPrice: 0,
					description: importItem.description,
					type: type 
				}
				goods.push(good);
			}
		}
		
	}
	loadShips() {
		this.fleetService.allShips$.subscribe((allShips) => {
			this.shipsAtWaypoint.length = 0;
			for (let ship of allShips) {
				if (ship.nav?.waypointSymbol == this.waypoint?.symbol) {
					this.shipsAtWaypoint.push(ship);
					if (this.selectedShip == null) {
						this.selectedShip = ship;
					}
				}
			}
			let fleetActiveShip = this.fleetService.getActiveShip();
			if (fleetActiveShip && this.shipsAtWaypoint.includes(fleetActiveShip)) {
				this.selectedShip = fleetActiveShip;
			}
		})
	}
	selectImportItem(item: MarketItem) {
		this.selectedImportItem = item;
	}
	selectExportItem(item: MarketItem) {
		this.selectedExportItem = item;
	}
	selectTradeItem(item: TypedMarketItem) {
		this.selectedTradeItem = item;
	}
	selectCargoItem(item: ShipCargoItem) {
		this.selectedCargoItem = item;
	}
	onSelectShip(ship: Ship) {
		this.selectedShip = ship;
	}
	onDockShip(ship: Ship) {
		if (ship) {
			this.fleetService.dockShip(ship.symbol).subscribe((response) => {
			});
		}
	}

	onBuyExport() {
		if (this.selectedShip && this.selectedExportItem && this.buyExportQty > 0) {
			this.fleetService.purchaseCargo(this.selectedShip.symbol, 
			                                this.selectedExportItem.symbol,
			                                this.buyExportQty).subscribe((response) => {
			});
		}
	}
	onSellImport() {
		if (this.selectedShip && this.selectedImportItem && this.sellImportQty > 0) {
			this.fleetService.sellCargo(this.selectedShip.symbol, 
			                            this.selectedImportItem.symbol,
			                            this.sellImportQty).subscribe((response) => {
			});
		}
		
	}
	onBuyTrade() {
		if (this.selectedShip && this.selectedTradeItem && this.buyTradeQty > 0) {
			this.fleetService.purchaseCargo(this.selectedShip.symbol, 
			                                this.selectedTradeItem.symbol,
			                                this.buyTradeQty).subscribe((response) => {
			});
		}
	}
	onSellCargoItem() {
		if (this.selectedShip && this.selectedCargoItem && this.sellTradeQty > 0) {
			this.fleetService.sellCargo(this.selectedShip.symbol, 
			                            this.selectedCargoItem.symbol,
			                            this.sellTradeQty).subscribe((response) => {
			});
		}
	}
	onSellAll(cargoItem: ShipCargoItem) {
		if (this.selectedShip && cargoItem && cargoItem.units > 0) {
			this.fleetService.sellCargo(this.selectedShip.symbol, 
			                            cargoItem.symbol,
			                            cargoItem.units).subscribe((response) => {
				if (this.selectedCargoItem?.symbol == cargoItem.symbol) {
					this.selectedCargoItem = null;
				}
			});
		}
	}
	onJettisonCargoItem(cargoItem: ShipCargoItem) {
		if (this.selectedShip && cargoItem) {
			this.fleetService.jettisonCargo(this.selectedShip.symbol, 
			                                cargoItem.symbol, cargoItem.units).subscribe((response) => {
			});
		}
	}
}
export class TypedMarketItem {
	symbol!: string;
	name!: string;
	tradeVolume!: number;
	supply!: string;
	purchasePrice!: number;
	sellPrice!: number;
	description!: string;
	type!: string
}
