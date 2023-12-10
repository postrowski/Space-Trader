import { Bot } from "./bot";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";
import { TradeRoute, UiMarketItem } from "../services/market.service";
import { LocXY } from "src/models/LocXY";
import { MarketItemType } from "src/models/Market";

export class ConstructionManager extends Manager {
	
	mode: 'contract' | 'construction' | 'both' = 'both';
	doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void {
		const otherShipsAtWaypoint = this.otherShipsAtWaypoint(bot);
		if ((this.mode == 'both' && !this.contract && !this.constructionSite) ||
		    (this.mode == 'contract' && !this.contract) ||
		    (this.mode == 'construction' && !this.constructionSite)) {
			return;
		}
		if (bot.currentTradeRoute == null) {
			bot.currentTradeRoute = this.getContractAndConstructionGoodsRoute(bot, waypoint, credits);
		}
		let results;
		let count = 0;
		do {
			results = this.executeTradeRoute(bot, waypoint, system, otherShipsAtWaypoint);
		} while (results == 'retry' && count++ < 5);
	}
	
	getContractAndConstructionGoodsRoute(bot: Bot, waypoint: WaypointBase, credits: number): TradeRoute | null {
		let itemFor = '';
		let itemsToBuy: {symbol: string, units: number, itemFor: string, deliverTo: WaypointBase}[] = [];
		let availableCredits = credits - 100_000;
		let constructionSiteWaypoint = null;
		if (this.constructionSite) {
			constructionSiteWaypoint = this.galaxyService.getWaypointByWaypointSymbol(this.constructionSite.symbol);
			if (constructionSiteWaypoint) {
				for (const material of this.constructionSite.materials) {
					const units = material.required - material.fulfilled;
					if (units > 0) {
						itemsToBuy.push({
							symbol: material.tradeSymbol,
							units, itemFor: 'construction Site',
							deliverTo: constructionSiteWaypoint
						});
					}
				}
			}
		}
		/*if (this.contract && enoughCredits) {
			for (const goods of this.contract.terms.deliver) {
				const units = goods.unitsRequired - goods.unitsFulfilled;
				if (units > 0) {
					itemsToBuy.push({
						symbol: goods.tradeSymbol,
						units, itemFor: 'contract',
						deliverTo: goods.destinationSymbol
					});
				}
			}
		}*/
		if (!constructionSiteWaypoint) {
			return null;
		}
		const sinceTime = Date.now() - 6 * 60 * 60 * 1000; // last 6 hours
		const itemsNeedToBeGrown = [];
		let closestItem = null;
		let closestDist = Infinity;
		let closestMarket = null;
		let closestMarketItem = null;
		for (const itemToBuy of itemsToBuy) {
			const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(waypoint, itemToBuy.symbol, itemToBuy.units, false);
			if (!marketItem) {
				continue;
			}
			const lowPrice = this.marketService.getItemHistoricalLowPriceAtMarket(marketItem.marketSymbol, itemToBuy.symbol, sinceTime);
			// If the current purchase price is within 200% of the lowest price seen lately, we can buy it
			if (marketItem.purchasePrice > (lowPrice * 2)) {
				// we didn't find a good (non SCAECE/LIMITED) source
				itemsNeedToBeGrown.push(itemToBuy);
				continue;
			}
		
			const currentQty = bot.ship.cargo.inventory.find(inv => itemToBuy.symbol === inv.symbol)?.units || 0;
			itemToBuy.units -= currentQty;
			
			// Don't buy any items that drop our credit below half its current value.
			const maxWeCouldbuy = Math.floor((availableCredits / 2) / marketItem.purchasePrice);
			if (itemToBuy.units > maxWeCouldbuy) {
				console.log(`Contract/construction item ${itemToBuy.symbol} too expensive at ${marketItem.purchasePrice}`);
				itemToBuy.units = maxWeCouldbuy;
			}
			if ((itemToBuy.units == 0) && (currentQty > 0)) {
				// We have all the items we need (and can afford), go deliver them now
				this.addMessage(bot, `going to ${itemToBuy.deliverTo} to deliver ${itemToBuy.itemFor} ${itemToBuy.symbol}`);
				return {
					state: 'goSell',
					startingWaypoint: waypoint,
					endingWaypoint: itemToBuy.deliverTo,
					sellItems: [],
					deliverItems: [marketItem],
					profit: 0,
					route: {steps: [{loc: constructionSiteWaypoint, speed: 'CRUISE'}], time: 0, fuel: 0},
					travelTime: 0,
					profitPerSecond: 0,
					buyItem: null
				};
			}
			if (marketItem && itemToBuy.units > 0) { 
				const supplierMarket = this.galaxyService.getWaypointByWaypointSymbol(marketItem.marketSymbol);
				if (supplierMarket) {
					const distForItem = LocXY.getDistance(waypoint, supplierMarket);
					if (closestDist > distForItem) {
						closestDist = distForItem;
						closestItem = itemToBuy;
						closestMarket = supplierMarket;
						closestMarketItem = marketItem;
					}
				}
			}
		}
		if (closestMarket && closestItem && closestMarketItem) {
			if (waypoint.symbol != closestMarket.symbol) {
				this.addMessage(bot, `going to market ${closestMarket.symbol} to buy ${itemFor} item ${closestItem?.symbol}.`);
				return {
					state: 'goBuy',
					startingWaypoint: closestMarket,
					endingWaypoint: closestItem.deliverTo,
					sellItems: [],
					deliverItems: [closestMarketItem],
					profit: 0,
					route: {steps: [{loc: constructionSiteWaypoint, speed: 'CRUISE'}], time: 0, fuel: 0},
					travelTime: 0,
					profitPerSecond: 0,
					buyItem: null
				};
			}
			this.addMessage(bot, `buying ${itemFor} item: ${closestItem.units} ${closestItem.symbol}, supply: ${closestMarketItem.supply}, activity: ${closestMarketItem.activity}, sellPrice: $${closestMarketItem.sellPrice}.`);
			bot.purchaseCargo(closestItem.symbol, closestItem.units);
		}
		
		
		
		
		// We couldn't buy a part, probably because its too expensive.
		// try to seed the market:
		const space = bot.ship.cargo.capacity - bot.ship.cargo.units;
		for (const itemToBuy of itemsNeedToBeGrown) {
			const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(waypoint, itemToBuy.symbol, itemToBuy.units, false);
			if (marketItem && marketItem.type == MarketItemType.EXPORT) {
				const marketWaypoint = this.galaxyService.getWaypointByWaypointSymbol(marketItem.marketSymbol);
				const latestMarketItemByTradeSymbol = this.marketService.latestMarketItemByTradeSymbolByWaypointSymbol.get(marketItem.marketSymbol);
				if (marketWaypoint) {
					for (const activity of ['RESTRICTED','WEAK','STATIC','GROWING','STRONG']) {
						let closestFeedMarket = null;
						let closestFeedDist = Infinity;
						let closestFeedMarketItem = null;
						for (const item of latestMarketItemByTradeSymbol?.values() || []) {
							if (item.type == MarketItemType.IMPORT && item.activity == activity) {
								const sourceMarketItem = this.marketService.findCheapestMarketItemForSaleInSystem(marketWaypoint, item.symbol, space, true);
								if (sourceMarketItem && sourceMarketItem.marketSymbol != constructionSiteWaypoint.symbol &&
								    sourceMarketItem.purchasePrice * space < availableCredits) {
									const sourceMarketWaypoint = this.galaxyService.getWaypointByWaypointSymbol(sourceMarketItem.marketSymbol);
									if (sourceMarketWaypoint) {
										const distForItem = LocXY.getDistance(marketWaypoint, sourceMarketWaypoint);
										if (closestFeedDist > distForItem) {
											closestFeedDist = distForItem;
											closestFeedMarket = sourceMarketWaypoint;
											closestFeedMarketItem = sourceMarketItem;
										}
									}
								}
							}
						}
						if (closestFeedMarket && closestFeedMarketItem) {
							// Fake the sellPrice so we don't abort the trade route due to
							// the profit loss we are gonna take, but don't take too much of a loss.
							closestFeedMarketItem.sellPrice = 2 * closestFeedMarketItem.sellPrice;
							return {
								state: 'goBuy',
								startingWaypoint: closestFeedMarket,
								endingWaypoint: marketWaypoint,
								sellItems: [closestFeedMarketItem],
								deliverItems: [],
								profit: 0,
								route: {steps: [{loc: closestFeedMarket, speed: 'CRUISE'}], time: 0, fuel: 0},
								travelTime: 0,
								profitPerSecond: 0,
								buyItem: closestFeedMarketItem
							};
						}
					}
				}
			}
		}
		return null;
	}
}