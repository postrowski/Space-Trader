import { Component, Input, OnInit } from '@angular/core';
import { AccountService } from 'src/app/services/account.service';
import { FleetService } from 'src/app/services/fleet.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { MarketItemType, MarketService, UiMarketItem } from 'src/app/services/market.service';
import { ModalService } from 'src/app/services/modal.service';
import { Agent } from 'src/models/Agent';
import { LocXY } from 'src/models/LocXY';
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
	itemHistory: UiMarketItem[] = [];
	itemAtOtherMarkets: UiMarketItemWithDist[] =[];
	goods: TypedMarketItem[] = [];
	shipsAtWaypoint: Ship[] = [];
	selectedShip: Ship | null = null;
	selectedTradeItem: TypedMarketItem | null = null;
	selectedCargoItem: ShipCargoItem | null = null;
	selectedItemSymbol: string | null = null;
	tradeItems: string[] = [];
	sellImportQty: number = 0;
	buyExportQty: number = 0;
	buyTradeQty: number = 0;
	sellTradeQty: number = 0;
	showTransactions = false;
	sortKey: string = ''; // Initial sorting key
	sortDirection: number = 1; // 1 for ascending, -1 for descending
	maxPrice: number = 1;
	xScale: ((value: number) => number) | null = null;
	yScale: ((value: number) => number) | null = null;
  

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
	
	formatDate(date: Date) {
		return new Intl.DateTimeFormat('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			day: 'numeric',
			month: 'short'
		}).format(date);
	}
	
	sortBy(key: string) {
		if (key === this.sortKey) {
			this.sortDirection = -this.sortDirection; // Toggle sorting direction if sorting by the same key
		} else {
			this.sortKey = key;
			this.sortDirection = 1; // Default to ascending order
		}
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

	updateMarket(marketItems: UiMarketItem[]) {
		this.marketItems = marketItems;
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
					type: MarketItemType[marketItem.type],
					timestamp: marketItem.timestamp
				}
				goods.push(item);
			}
		}
		this.goods = goods.sort((g1, g2) => {
			return this.compare(g1.symbol, g2.symbol);
		});
	}
	
	loadMarket() {
		this.marketItems = [];
		this.selectedCargoItem = null;
		this.goods = [];
		this.itemHistory = [];
		if (this.waypoint && this.hasMarketplace()) {
			this.marketService.getMarketplace(this.waypoint.symbol, this.shipsAtWaypoint.length> 0)
			                  .subscribe((response) => {
								  this.updateMarket(response);
			});
		}
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(this.waypoint?.symbol || '');
		const tradeItemsSet = this.marketService.getAllItemsForTradeInSystem(systemSymbol);
		this.tradeItems = [...tradeItemsSet].sort();
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
	selectTradeItem(item: TypedMarketItem) {
		this.selectedTradeItem = item;
		this.selectedItemSymbol = item.symbol;
		this.updateOtherMarkets();
		if (this.waypoint) {
			this.itemHistory = this.marketService.getItemHistoryAtMarket(this.waypoint.symbol, item.symbol)
												 .filter((item) => item.purchasePrice > 0);
			this.itemHistory.sort((h1, h2)=> { 
				if (h1.timestamp < h2.timestamp) return -1;
				if (h1.timestamp > h2.timestamp) return 1;
				return 0;
			});
			const oldest = Math.min(...this.itemHistory.map((item) => item.timestamp.getTime()));
			const newest = Math.max(...this.itemHistory.map((item) => item.timestamp.getTime()));
			const highestPurchasePrice = Math.max(...this.itemHistory.map((item) => item.purchasePrice));
			const highestSellPrice = Math.max(...this.itemHistory.map((item) => item.sellPrice));

			this.maxPrice = this.getNextBiggestNumber(Math.max(highestPurchasePrice, highestSellPrice));
			this.xScale = this.createScale(oldest, newest, 0, 400);
			this.yScale = this.createScale(this.maxPrice, 0, 0, 200);
		}
	}
	private getNextBiggestNumber(num: number) : number {
	   	const orderOfMagnitude = Math.floor(Math.log10(num));
		const nextTen =  10 ** (orderOfMagnitude + 1);
		if (num*2 > nextTen)
			return nextTen;
		return nextTen / 2;
	}
	formatPrice(num: number): string {
		return '$' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	}
	
	private createScale(domainStart: number, domainEnd: number, rangeStart: number, rangeEnd: number): (value: number) => number {
		const domainRange = domainEnd - domainStart;
		const rangeRange = rangeEnd - rangeStart;
		return (value: number) => ((value - domainStart) / domainRange) * rangeRange + rangeStart;
	}
	
	getXCoordinate(timestamp: Date): number {
		if (this.xScale)
			return this.xScale(timestamp.getTime());
		return 0;
	}

	getYCoordinate(price: number): number {
		if (this.yScale)
			return this.yScale(price);
		return 0;
	}

	updateOtherMarkets() {
		this.itemAtOtherMarkets = [];
		if (this.selectedItemSymbol && this.waypoint) {
			const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(this.waypoint.symbol);
			const itemsByWaypoint = this.marketService.getPricesForItemInSystemByWaypointSymbol(systemSymbol, this.selectedItemSymbol);
			for (const item of itemsByWaypoint.values()) {
				const uiItem: UiMarketItemWithDist = {
					marketSymbol: item.marketSymbol,
					type: item.type,
					timestamp: item.timestamp,
					symbol: item.symbol,
					purchasePrice: item.purchasePrice,
					sellPrice: item.sellPrice,
					supply: item.supply,
					tradeVolume: item.tradeVolume,
					distance: this.getDistanceToMarket(item.marketSymbol) || 0,
					toMarket: this.waypoint.symbol
				};
				this.itemAtOtherMarkets.push(uiItem);
			}
		}
	}
	getDistanceToMarket(marketSymbol: string): number | null {
		const otherMarket = this.galaxyService.getWaypointByWaypointSymbol(marketSymbol);
		if (otherMarket && this.waypoint) {
			return LocXY.getDistance(otherMarket, this.waypoint);
		}
		return null;
	}
	
	selectCargoItem(item: ShipCargoItem) {
		this.selectedCargoItem = item;
		this.selectedItemSymbol = item.symbol;
		this.updateOtherMarkets();
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

	onBuyTradeItem() {
		if (this.selectedShip && this.selectedTradeItem && this.buyTradeQty > 0) {
			this.marketService.purchaseCargo(this.selectedShip.symbol, 
			                                this.selectedTradeItem.symbol,
			                                this.buyTradeQty).subscribe((response) => {
			});
		}
	}
	onSellCargoItem() {
		if (this.selectedShip && this.selectedCargoItem && this.sellTradeQty > 0) {
			this.marketService.sellCargo(this.selectedShip.symbol, 
			                            this.selectedCargoItem.symbol,
			                            this.sellTradeQty).subscribe((response) => {
			});
		}
	}
	onSellAll(cargoItem: ShipCargoItem) {
		if (this.selectedShip && cargoItem && cargoItem.units > 0) {
			this.marketService.sellCargo(this.selectedShip.symbol, 
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
	onForceRefresh() {
		if (this.waypoint) {
			this.marketService.getMarketplaceForced(this.waypoint.symbol)
			                  .subscribe((response) => {
								  this.updateMarket(response);
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
	type!: string;
	timestamp!: Date;
}

export class UiMarketItemWithDist extends UiMarketItem {
	distance: number | undefined;
	toMarket: string | undefined;
}
