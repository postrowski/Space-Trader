import { Component, Input, OnInit } from '@angular/core';
import { AccountService } from 'src/app/services/account.service';
import { FleetService } from 'src/app/services/fleet.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { MarketItemType, MarketService, UiMarketItem } from 'src/app/services/market.service';
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

	marketItems: UiMarketItem[] = [];
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
		this.marketItems = [];
		this.selectedCargoItem = null;
		this.goods = [];
		if (this.waypoint && this.hasMarketplace()) {
			this.marketService.getMarketplace(this.waypoint.symbol, this.shipsAtWaypoint.length> 0)
			                  .subscribe((response) => {
				this.marketItems = response;
				let goods: TypedMarketItem[] = [];
				if (this.marketItems) {
					for (const marketItem of this.marketItems) {
						let item: TypedMarketItem = {
							symbol: marketItem.symbol,
							name: marketItem.symbol,
							tradeVolume: marketItem.tradeVolume,
							supply: marketItem.supply,
							purchasePrice: marketItem.purchasePrice,
							sellPrice: marketItem.sellPrice,
							description: '',
							type: MarketItemType[marketItem.type]
						}
						goods.push(item);
					}
				}
				this.goods = goods.sort((g1, g2) => {
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
