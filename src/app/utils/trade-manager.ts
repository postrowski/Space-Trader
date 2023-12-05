import { Bot, Role } from "./bot";
import { Ship } from "src/models/Ship";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";
import { UiMarketItem } from "../services/market.service";
import { ExplorationService } from "../services/exploration.service";
import { LocXY } from "src/models/LocXY";

export class TradeManager extends Manager {
	
	contractBot: Bot | null = null;
	constructionBots: Bot[] = [];
	haulerBots: Bot[] = [];
	
	override addBot(bot: Bot): boolean {
		if (super.addBot(bot)) {
			if (bot.role == Role.Hauler) {
				this.haulerBots.push(bot);
				// Second bot goes to construction
				if (this.haulerBots.length == 3) {
					this.constructionBots.push(bot);
				}
				// third bot goes to contracts
				if (this.haulerBots.length == 4) {
					this.contractBot = bot;
				}
				// all other bots go to construction
				if (this.haulerBots.length > 6) {
					this.constructionBots.push(bot);
				}
			}
			return true;
		}
		return false;
	}
	override removeBot(bot: Bot): boolean {
		if (super.removeBot(bot)) {
			let index = this.constructionBots.findIndex(b => b.ship.symbol === bot.ship.symbol);
			if (index >= 0) {
				this.constructionBots.splice(index, 1);
			}
			index = this.haulerBots.findIndex(b => b.ship.symbol === bot.ship.symbol);
			if (index >= 0) {
				this.haulerBots.splice(index, 1);
			}
			if (bot == this.contractBot) {
				this.contractBot = null;
			}
			return true;
		}
		return false;
	}
	
	doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void {
		const isDebrisField        = WaypointBase.isDebrisField(waypoint);
		const hasMarketplace       = WaypointBase.hasMarketplace(waypoint);
		const isAsteroid           = WaypointBase.isAsteroid(waypoint);
		const isGasGiant           = WaypointBase.isGasGiant(waypoint);
     	const otherShipsAtWaypoint = this.otherShipsAtWaypoint(bot);

		if (this.contract || this.constructionSite) {
			// If this is a drone or a probe, it doesn't make sense to have it making contract/construction runs.
			if (bot.ship.cargo.capacity > 20 && (bot == this.contractBot || this.constructionBots.includes(bot))) {
				bot.deliverAll(this.contract, this.constructionSite, true, true);
			}
		}
		
		let checkedContracts = false;
		if ((bot == this.contractBot || this.constructionBots.includes(bot)) &&
		    (bot.currentTradeRoute == null)) {
			bot.sellAtBestLocation(waypoint, this.contract, this.constructionSite, otherShipsAtWaypoint);
			let waypointDest = this.buyContractAndConstructionGoods(bot, waypoint, credits);
			checkedContracts = true;
			if (waypointDest) {
				const dest = this.galaxyService.getWaypointByWaypointSymbol(waypointDest);
				if (dest) {
					bot.navigateTo(dest, null, `going to market ${waypointDest} to buy contract/construction goods`);
				}
			}
		}

		const res = this.trade(bot, waypoint, credits, this.shipBots, otherShipsAtWaypoint);
        if (res == 'wait') {
			return;
		}

		if (isAsteroid || isDebrisField) {
			let surveys = this.surveyService.getSurveysForWaypoint(waypoint);
			if (surveys.length < 5) {
				bot.survey();
			}
		}

		if (hasMarketplace) {
			bot.sellAll(waypoint, this.contract, this.constructionSite, otherShipsAtWaypoint);
		}
		if (bot.ship.cargo.capacity - bot.ship.cargo.units < 10) {
			// If we have less than 10 spaces for stuff, get rid of stuff we can't sell for a profit.
			bot.consolidateCargo(otherShipsAtWaypoint);
		}
		
		let roomToMine = bot.ship.cargo.units < bot.ship.cargo.capacity;
		if (roomToMine) {
			if (!isAsteroid && !isDebrisField && Ship.containsMount(bot.ship, 'MOUNT_MINING_LASER')) {
				const asteroids = system.waypoints?.filter((way) => WaypointBase.isAsteroid(way) && way != waypoint) || [];
				if (asteroids.length > 0) {
					const nearbyWaypoints = ExplorationService.sortWaypointsByDistanceFrom(asteroids, waypoint);
					bot.navigateTo(nearbyWaypoints[0], null, `going to asteroid ${nearbyWaypoints[0].symbol} to mine.`);
					bot.mine();
				}
			} else if (Ship.containsMount(bot.ship, 'MOUNT_GAS_SIPHON')) {
				if (!isGasGiant) {
					const gasGiants = system.waypoints?.filter((way) => WaypointBase.isGasGiant(way) && way != waypoint) || [];
					if (gasGiants.length > 0) {
						const nearbyWaypoints = ExplorationService.sortWaypointsByDistanceFrom(gasGiants, waypoint);
						bot.navigateTo(nearbyWaypoints[0], null, 'going to gas giant to siphon.');
						bot.siphon();
					}
				}
			} else {
				// we aren't doing anything else, check if we should contribute to the contract or construction site
				// unless we've already checked them before
				if (!checkedContracts) {
					const waypointDest = this.buyContractAndConstructionGoods(bot, waypoint, credits);
					if (waypointDest) {
						const destWaypoint = this.galaxyService.getWaypointByWaypointSymbol(waypointDest);
						if (destWaypoint) {
							bot.navigateTo(destWaypoint, null, `going to market ${waypointDest} to buy contract/construction goods`);
						}
					}
				}
			}
		} else if (bot.ship.cargo.units > 0) {
			// roomToMine == false
			this.sellAll(bot, waypoint);
			if (this.contract || this.constructionSite) {
				// If this is a drone or a probe, it doesn't make sense to have it making contract/construction runs.
				if (bot.ship.cargo.capacity > 20 && (bot == this.contractBot || this.constructionBots.includes(bot))) {
					bot.deliverAll(this.contract, this.constructionSite, false, true);
				}
			}
		}
	}
	
	buyContractAndConstructionGoods(bot: Bot, waypoint: WaypointBase, credits: number): string | null {
		if (bot.ship.cargo.capacity < 25) {
			// If we don't have much space for cargo, don't be a part of the contract/construction crew
			return null;
		}
		let itemFor = '';
		let itemsToBuy: {symbol: string, units: number, itemFor: string, deliverTo: string}[] = [];
		let contractAllowed = (bot == this.contractBot) && (credits > 200_000);
		let constructionAllowed = this.constructionBots.includes(bot) && (credits > 300_000);
		if (this.constructionSite && constructionAllowed) {
			for (const material of this.constructionSite.materials) {
				const units = material.required - material.fulfilled;
				if (units > 0) {
					itemsToBuy.push({
						symbol: material.tradeSymbol,
						units, itemFor: 'construction Site',
						deliverTo: this.constructionSite.symbol
					});
				}
			}
		}
		if (this.contract && contractAllowed) {
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
		}
		const sinceTime = Date.now() - 6 * 60 * 60 * 1000; // last 6 hours
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
				continue;
			}

			const currentQty = bot.ship.cargo.inventory.find(inv => itemToBuy.symbol === inv.symbol)?.units || 0;
			itemToBuy.units -= currentQty;
			
			// Don't buy any items that drop our credit below half its current value.
			const maxWeCouldbuy = Math.floor((credits / 2) / marketItem.purchasePrice);
			if (itemToBuy.units > maxWeCouldbuy) {
				console.log(`Contract/construction item ${itemToBuy.symbol} too expensive at ${marketItem.purchasePrice}`);
				itemToBuy.units = maxWeCouldbuy;
			}
			if ((itemToBuy.units == 0) && (currentQty > 0)) {
				// We have all the items we need (and can afford), go deliver them now
				this.addMessage(bot, `going to ${itemToBuy.deliverTo} to deliver ${itemToBuy.itemFor} ${itemToBuy.symbol}`);
				return itemToBuy.deliverTo;
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
				return closestMarket.symbol;
			}
			this.addMessage(bot, `buying ${itemFor} item: ${closestItem.units} ${closestItem.symbol}, supply: ${closestMarketItem.supply}, activity: ${closestMarketItem.activity}, sellPrice: $${closestMarketItem.sellPrice}.`);
			bot.purchaseCargo(closestItem.symbol, closestItem.units);
		}
		return null;
	}

	trade(bot: Bot, waypoint: WaypointBase, creditsAvailable: number,
	      allShips: Bot[], otherShipsAtWaypoint: Bot[]): string {
		const system = this.galaxyService.getSystemBySymbol(waypoint.symbol);
		if (!system || !system.waypoints) {
			return 'fail';
		}
		const space = bot.ship.cargo.capacity - bot.ship.cargo.units;
		if (bot.currentTradeRoute == null) {
			// we want to start with an empty cargo space before we establish a new trade route.
			bot.sellAtBestLocation(waypoint, this.contract, this.constructionSite, otherShipsAtWaypoint);
			if (space > 0) {
				const excludedTradeItems = new Set<string>();
				// avoid creating trade route for items we need to do construction on contract jobs:
				for (let deliverable of this.contract?.terms.deliver || []) {
					if (deliverable.unitsFulfilled < deliverable.unitsRequired){
						excludedTradeItems.add(deliverable.tradeSymbol);
					}
				}
				for (let material of this.constructionSite?.materials || []) {
					if (material.fulfilled < material.required){
						excludedTradeItems.add(material.tradeSymbol);
					}
				}
				// always start at our current waypoints, and then skip it when we iterate over the waypoints later.
				let bestRoute = this.marketService.getBestTradeRoutesFrom(bot.ship, waypoint, bot.ship.cargo.capacity, creditsAvailable, excludedTradeItems);
				const localWaypoints = system.waypoints.filter((wp) => wp.x == waypoint.x && wp.y == waypoint.y);
				for (const way of localWaypoints || []) {
					if (way.symbol != waypoint.symbol) {
						const bestRouteWay = this.marketService.getBestTradeRoutesFrom(bot.ship, way, bot.ship.cargo.capacity, creditsAvailable, excludedTradeItems);
						if ((bestRouteWay?.profit || 0) > (bestRoute?.profit || 0)) {
							bestRoute = bestRouteWay;
						}
					}
				}
				const bestLocalRoute = bestRoute;
				const nonLocalWaypoints = system.waypoints.filter((wp) => (wp.x != waypoint.x || wp.y != waypoint.y) && WaypointBase.hasMarketplace(wp));
				const fuelPricesByWaypointSymbol = bot.marketService.getPricesForItemInSystemByWaypointSymbol(system.symbol, 'FUEL');
				if (nonLocalWaypoints) {
					const localFuelCost = fuelPricesByWaypointSymbol.get(waypoint.symbol);
					for (const way of nonLocalWaypoints) {
						if (way.symbol != waypoint.symbol) {
							const destFuelCost = fuelPricesByWaypointSymbol.get(way.symbol);
							let dist = LocXY.getDistance(waypoint, way);
							for (const travelSpeed of ['BURN', 'CRUISE', 'DRIFT']) {
								const fuelUsed = Ship.getFuelUsed(bot.ship, travelSpeed, dist);
								const travelTime = Ship.getTravelTime(bot.ship, travelSpeed, dist);
								const route = this.marketService.getBestTradeRoutesFrom(bot.ship, way, bot.ship.cargo.capacity,
								                                                               creditsAvailable, excludedTradeItems);
								if (route) {
									const fuelCost = Math.min(localFuelCost?.purchasePrice || Infinity,
									                          destFuelCost?.purchasePrice || Infinity,
									                          bot.marketService.getAverageFuelCost(system.symbol));
									route.profit -= fuelCost * (route.route.fuel + fuelUsed);
									route.travelTime += route.route.time + travelTime;
									route.profitPerSecond = route.profit / route.travelTime;
									if ((route.profitPerSecond>0) &&
									    (bestRoute == null || route.profitPerSecond > bestRoute.profitPerSecond)) {
										bestRoute = route;
									}
								}
							}
						}
					}
				}
				if (bestLocalRoute && bestRoute && bestLocalRoute != bestRoute) {
					// If the local route takes us at least 75% closer to the start of the best route, do it first:
					const localRouteEnd = bestLocalRoute.endingWaypoint;
					const bestRouteStart = bestRoute.startingWaypoint;
					const currentDistToBestStart = LocXY.getDistance(waypoint, bestRouteStart);
					const localRouteEndDistToBestStart = LocXY.getDistance(localRouteEnd, bestRouteStart);
					if (localRouteEndDistToBestStart < (currentDistToBestStart * .75)) {
						this.addMessage(bot, `Picking local route to get to ${localRouteEnd.symbol} before taking best route which starts at ${bestRouteStart.symbol}`);
						bestRoute = bestLocalRoute;
					}
				}
				const botSupport = bot.getBestMinerToSupport(waypoint, system, fuelPricesByWaypointSymbol, allShips);
				if (botSupport && (bestRoute == null || bestRoute.profitPerSecond < botSupport.sellPlan.profitPerSecond)) {
					bestRoute = {
						state: 'collect',
						startingWaypoint: botSupport.waypoint,
						endingWaypoint: botSupport.sellPlan.endingWaypoint,
						buyItem: null,
						sellItems: botSupport.sellPlan.sellItems,
						deliverItems: [],
						profit: botSupport.sellPlan.profit,
						route: botSupport.sellPlan.route,
						profitPerSecond: botSupport.sellPlan.profitPerSecond,
						travelTime: botSupport.sellPlan.travelTime
					};
				}
				if (bestRoute) {
					let via = '';
					if (bestRoute.route.steps.length > 1) { 
						via = ('(via ' + bestRoute.route.steps.map(s=>s.loc.symbol)+')');
					}
					this.addMessage(bot, `Creating trade route, trading ${bestRoute.sellItems.map(i =>i.symbol)}`+
					                     ` from ${bestRoute.buyItem?.marketSymbol || bestRoute.startingWaypoint}`+
					                     ` at $${bestRoute.buyItem?.purchasePrice || 0}`+
					                     ` to ${bestRoute.endingWaypoint.symbol} at`+
					                     ` $${bestRoute.sellItems.map(i => i.sellPrice)},`+
					                     ` for a profit of ${bestRoute.profit} ${via}` 
					                     );
					bot.currentTradeRoute = bestRoute;
					bot.currentTradeRoute.state = 'goBuy';
				}
			} else {
				// We don't have a trade route, but we have no space to buy anything new.
				// Figure out where to sell what we have.
				this.sellAll(bot, waypoint);
			}
		}
		if (!bot.currentTradeRoute) {
			return 'fail';
		}

		return this.executeTradeRoute(bot, waypoint, system, otherShipsAtWaypoint);
	}	
}