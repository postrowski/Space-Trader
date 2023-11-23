import { Bot, Role } from "./bot";
import { Ship } from "src/models/Ship";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";
import { SellPlan, UiMarketItem } from "../services/market.service";
import { ExplorationService } from "../services/exploration.service";
import { LocXY } from "src/models/LocXY";
import { Survey } from "src/models/Survey";

export class TradeManager extends Manager {
	
	contractBot: Bot | null = null;
	constructionBots: Bot[] = [];
	haulerBots: Bot[] = [];
	
	override addBot(bot: Bot): boolean {
		if (super.addBot(bot)) {
			if (bot.role == Role.Hauler) {
				this.haulerBots.push(bot);
				// First bot goes to construction
				if (this.haulerBots.length == 1) {
					this.constructionBots.push(bot);
				}
				// Second bot goes to contracts
				if (this.haulerBots.length == 2) {
					this.contractBot = bot;
				}
				// all other bots go to construction
				if (this.haulerBots.length >= 3) {
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
		
		const stepStart = Date.now();
		const isDebrisField  = WaypointBase.isDebrisField(waypoint);
		const hasMarketplace = WaypointBase.hasMarketplace(waypoint);
		const isAsteroid     = WaypointBase.isAsteroid(waypoint);
		const isGasGiant     = WaypointBase.isGasGiant(waypoint);

		const otherShipsAtWaypoint = this.otherShipsAtWaypoint(bot);

		if (this.contract || this.constructionSite) {
			// If this is a drone or a probe, it doesn't make sense to have it making contract/construction runs.
			if (bot.ship.cargo.capacity > 20 && (bot == this.contractBot || this.constructionBots.includes(bot))) {
				bot.deliverAll(this.contract, this.constructionSite, true);
			}
		}
		const step1 = Date.now();
		let step2 = Date.now();
		let step3 = Date.now();
		let checkedContracts = false;
		if ((bot == this.contractBot || this.constructionBots.includes(bot))) {
			bot.sellAtBestLocation(waypoint, this.contract, this.constructionSite, otherShipsAtWaypoint);
			step2 = Date.now();
			let waypointDest = this.buyContractAndConstructionGoods(bot, waypoint, credits);
			step3 = Date.now();
			checkedContracts = true;
			if (waypointDest) {
				const dest = this.galaxyService.getWaypointByWaypointSymbol(waypointDest);
				if (dest) {
					bot.navigateTo(dest, null, `going to market ${waypointDest} to buy contract/construction goods`);
				}
			}
		}

		const step4 = Date.now();
		let res;
		let tries = 0;
		do 	{
			res = this.trade(bot, waypoint, credits, this.shipBots, otherShipsAtWaypoint);
		} while (res == 'retry' && (tries++ < 5));
        if (res == 'wait') {
			return;
		}

		const step5 = Date.now();

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

		const step6 = Date.now();
		
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
					bot.deliverAll(this.contract, this.constructionSite, false);
				}
			}
		}
		const end = Date.now();
		console.log(`trade manager, ship ${bot.ship.symbol}:`+
		            ` step1 took ${step1 - stepStart},`+
		            ` step2 took ${step2 - step1},`+
		            ` step3 took ${step3 - step2},`+
		            ` step4 took ${step4 - step3},`+
		            ` step5 took ${step5 - step4},`+
		            ` step6 took ${end - step5}`);
	}
	
	buyContractAndConstructionGoods(bot: Bot, waypoint: WaypointBase, credits: number): string | null {
		if (bot.ship.cargo.capacity < 25) {
			// If we don't have much space for cargo, don't be a part of the contract/construction crew
			return null;
		}
		let itemFor = '';
		let itemsToBuy: {symbol: string, units: number, itemFor: string, deliverTo: string}[] = [];
		let contractAllowed = (bot == this.contractBot) && (credits > 100_000);
		let constructionAllowed = this.constructionBots.includes(bot) && (credits > 100_000);
		if (this.constructionSite && constructionAllowed) {
			for (const material of this.constructionSite.materials) {
				if (material.required > material.fulfilled) {
					itemsToBuy.push({
						symbol: material.tradeSymbol,
						units: material.required - material.fulfilled,
						itemFor: 'construction Site',
						deliverTo: this.constructionSite.symbol
					});
				}
			}
		}
		if (this.contract && contractAllowed) {
			for (const goods of this.contract.terms.deliver) {
				if (goods.unitsRequired > goods.unitsFulfilled) {
					itemsToBuy.push({
						symbol: goods.tradeSymbol,
						units: goods.unitsRequired - goods.unitsFulfilled,
					 	itemFor: 'contract',
						deliverTo: goods.destinationSymbol
					});
				}
			}
		}
		const sinceTime = Date.now() - 6 * 60 * 60 * 1000; // last 6 hours
		for (const itemToBuy of itemsToBuy) {
			const currentPrices: Map<string, UiMarketItem> = this.marketService.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, itemToBuy.symbol);
			const lowPrice = this.marketService.getItemHistoricalLowPriceAtMarket(waypoint.symbol, itemToBuy.symbol, sinceTime);
			if (currentPrices == null || currentPrices.size == 0) {
				continue;
			}
			let minPrice = Infinity;
			for (let item of currentPrices.values()) {
				// If the current purchase price is within 200% of the lowest price seen lately, we can buy it
				let tooExpensive = (item.purchasePrice > (lowPrice * 2));
				
				// never buy items that are SCARCE or LIMITED, the prices will be too high
				if (item.supply == 'ABUNDANT' || item.supply == 'HIGH' || item.supply == 'MODERATE' || !tooExpensive) {
					if (item.purchasePrice < minPrice) {
						minPrice = item.purchasePrice;
					}
				}
			}
			if (minPrice == Infinity) {
				// we didn't find a good (non SCAECE/LIMITED) source
				continue;
			}

			//const lowPrice = this.marketService.getItemHistoricalLowPriceAtMarket(waypoint.symbol, itemToBuy.symbol, sinceTime);
			let tooExpensive = false;//(minPrice > (lowPrice * 3));
			if (tooExpensive || (credits < minPrice)) {
				console.log(`Contract/construction item ${itemToBuy.symbol} too expensive at ${minPrice}`);
				continue;
			}
			
			if (itemToBuy.units > 0) {
				for (let inv of bot.ship.cargo.inventory) {
					if (itemToBuy.symbol == inv.symbol) {
						itemToBuy.units -= inv.units;
						break;
					}
				}
				// Don't buy any items that drop our credit below half its current value.
				if ((itemToBuy.units * minPrice) > (credits / 2)) {
					itemToBuy.units = Math.floor(credits / (2 * minPrice));
				}
				if (itemToBuy.units <= 0) {
					// We have all the items we need, go deliver them now
					this.addMessage(bot, `going to ${itemToBuy.deliverTo} to deliver ${itemToBuy.itemFor} ${itemToBuy.symbol}`);
					return itemToBuy.deliverTo;
				}
			}
		}
		let closestItem = null;
		let closestDist = Infinity;
		let closestMarket = null;
		let closestMarketItem = null;
		for (const itemToBuy of itemsToBuy) {
			const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(waypoint, itemToBuy.symbol, itemToBuy.units);
			if (marketItem?.supply == 'ABUNDANT' || marketItem?.supply == 'HIGH' || marketItem?.supply == 'MODERATE') { 
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


	getBestSurveyToUse(waypoint: WaypointBase, surveys: Survey[]): Survey | undefined {
		const surveyAverages: { [symbol: string]: number } = {};

		const aveFuelCost = this.marketService.getAverageFuelCost(waypoint.symbol)
		// Calculate average price per unit for each survey
		surveys.forEach((survey) => {
			const sum = survey.deposits.reduce((total, deposit) => {
				const nearestMarket = this.marketService.getNearestMarketInSystemThatTradesItem(waypoint, deposit.symbol);
				if (!nearestMarket) return total;

				const distance = LocXY.getDistance(nearestMarket, waypoint);
				const fuelCost = distance * 2 * aveFuelCost / 20;
				const marketItem = this.marketService.getItemAtMarket(nearestMarket.symbol, deposit.symbol);
				if (!marketItem) return total;

				let value = marketItem.sellPrice;
/*				if (this.contract && ContractService.getContractDeliverable(deposit.symbol, this.contract)) {
					// Favor surveys that lead to resources needed for a contract
					return total + value * 2 - fuelCost;
				}
*/
				return total + value - fuelCost;
			}, 0);

			const averagePrice = sum / survey.deposits.length;
			surveyAverages[survey.symbol] = isNaN(averagePrice) ? 0 : averagePrice;
		});

		// Find the survey with the highest average price per unit
		let highestAverageSurvey: Survey | undefined;
		let highestAveragePrice = -Infinity;

		for (const survey of surveys) {
			const averagePrice = surveyAverages[survey.symbol];

			if (averagePrice > highestAveragePrice) {
				highestAverageSurvey = survey;
				highestAveragePrice = averagePrice;
			}
		}

		return highestAverageSurvey;
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
					const localRouteEnd = bestLocalRoute.sellWaypoint;
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
						startingWaypoint: botSupport.waypoint,
						sellWaypoint: botSupport.sellPlan.sellWaypoint,
						buyItem: null,
						sellItems: botSupport.sellPlan.sellItems,
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
					                     ` to ${bestRoute.sellWaypoint.symbol} at`+
					                     ` $${bestRoute.sellItems.map(i => i.sellPrice)},`+
					                     ` for a profit of ${bestRoute.profit} ${via}` 
					                     );
					bot.currentTradeRoute = bestRoute;
					bot.tradeRouteState = 'goBuy';
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

		const invItems = bot.ship.cargo.inventory
		                    .filter((inv) => bot.currentTradeRoute?.sellItems.some(i => i.symbol === inv.symbol));
		const itemCount = (invItems && invItems.length == 1) ? invItems[0].units : 0;
		
		if (bot.tradeRouteState == 'goBuy') {
			if (waypoint.symbol == bot.currentTradeRoute.buyItem?.marketSymbol) {
				bot.tradeRouteState = 'buy';
			} else if (waypoint.symbol == bot.currentTradeRoute.startingWaypoint.symbol) {
				bot.tradeRouteState = 'collect';
			} else {
				const curRouteBuyWaypointSymbol = bot.currentTradeRoute.buyItem?.marketSymbol || bot.currentTradeRoute.startingWaypoint.symbol;
				// go to the 'buy' location
				const market = system.waypoints.find((wp) => wp.symbol == curRouteBuyWaypointSymbol);
				if (market && market.symbol !== waypoint.symbol) {
					let via = '';
					if (bot.currentTradeRoute.route.steps.length > 1) { 
						via = (' (via ' + bot.currentTradeRoute.route.steps.map(s=>s.loc.symbol)+')');
					}
					bot.navigateTo(market, bot.currentTradeRoute.route.steps[0].speed,
									`Going to ${market.symbol} to buy trade item`+
									`${via} ${bot.currentTradeRoute.sellItems.map(i => i.symbol)} for $${bot.currentTradeRoute.profit}`);
				}
			}
		}
		if (bot.tradeRouteState == 'buy' && bot.currentTradeRoute.buyItem?.marketSymbol == bot.ship.nav.waypointSymbol) {
			// We are at the 'buy' location, buy until we have no room or money, and then go to the 'sell' location
			if (space == 0 || (this.automationService.agent?.credits || 0) < bot.currentTradeRoute.buyItem.purchasePrice) {
				bot.tradeRouteState = 'goSell';
			} else if (bot.ship.nav.status != 'IN_TRANSIT') {
				const currentItem = this.marketService.getItemAtMarket(bot.currentTradeRoute.buyItem.marketSymbol, bot.currentTradeRoute.buyItem.symbol);
				const sellItems = bot.currentTradeRoute.sellItems.filter(i => i.symbol == currentItem?.symbol);
				// make sure the item purchase price is still cheaper than the sell price
				if (currentItem && sellItems && sellItems.length > 0 &&
				   (currentItem.purchasePrice < sellItems[0].sellPrice) &&
				    bot.ship.cargo.units < bot.ship.cargo.capacity) {
					if (currentItem.purchasePrice < 1) {
						// Wait here until we get filled by the minning bot
					} else {
						this.addMessage(bot, `at market ${waypoint.symbol} to start of trade route.`+
						                     ` Buying ${space} ${bot.currentTradeRoute.buyItem.symbol}.`);
						bot.purchaseCargo(bot.currentTradeRoute.buyItem.symbol, space);
					}
				} else {
					this.addMessage(bot, `Costs of trade item ${bot.currentTradeRoute.buyItem.symbol}`+
					                     ` at ${bot.currentTradeRoute.buyItem.marketSymbol}`+
					                     ` have changed from ${bot.currentTradeRoute.buyItem.purchasePrice}`+
					                     ` to ${currentItem?.purchasePrice},`+
					                     ` which exceeds the current sell price of $${sellItems[0].sellPrice},`+
					                     ` aborting trade route!`);
					if (itemCount == 0) {
						bot.currentTradeRoute = null;
						bot.tradeRouteState = '';
						return 'retry';
					}
					bot.tradeRouteState = 'goSell';
				}
			}
		}
		if (bot.tradeRouteState == 'collect' && bot.currentTradeRoute.startingWaypoint.symbol == bot.ship.nav.waypointSymbol) {
			// We are at the 'collect' location, buy until we have no room, and then go to the 'sell' location
			if (space == 0) {
				bot.tradeRouteState = 'goSell';
			} else if (bot.ship.nav.status != 'IN_TRANSIT') {
				// wait here until our cargo gets filled up by a miner.
				if (otherShipsAtWaypoint.length == 0) {
					// If there are no longer any mining ships here, we should go sell what we've got.
					bot.tradeRouteState = 'goSell';
				}
			}
		}
		if (bot.tradeRouteState == 'goSell') {
			if (bot.currentTradeRoute.sellWaypoint.symbol == waypoint.symbol) {
				bot.tradeRouteState = 'sell';
			} else {
				if ((space > 0) && (itemCount == 0)) {
					// We don't we the item to sell. Maybe we didn't have enough money to buy the item when we got here?
					// Wait until we have at least something!
					bot.tradeRouteState = 'goBuy';
					return 'wait';
				}
				// go to the 'sell' location
				const market = system.waypoints.find((wp) => wp.symbol == bot.currentTradeRoute!.sellWaypoint.symbol);
				if (market && market.symbol !== waypoint.symbol) {
					let via = '';
					if (bot.currentTradeRoute.route.steps.length > 1) { 
						via = (' (via ' + bot.currentTradeRoute.route.steps.map(s=>s.loc.symbol)+')');
					}
					bot.navigateTo(market, bot.currentTradeRoute.route.steps[0].speed,
									`Going to ${bot.currentTradeRoute.sellWaypoint.symbol}`+
									`${via} to sell trade item ${bot.currentTradeRoute.sellItems.map(i => i.symbol)}`+
									` for $${bot.currentTradeRoute.profit}`);
				}
			}
		}
		if (bot.tradeRouteState == 'sell' && bot.currentTradeRoute.sellWaypoint.symbol == bot.ship.nav.waypointSymbol) {
			// We are at the 'sell' location.
			if (itemCount == 0) {
				bot.currentTradeRoute = null;
				bot.tradeRouteState = '';
				return 'retry';
			}
			this.addMessage(bot, `market ${waypoint.symbol} end of trade route to sell ${bot.currentTradeRoute.sellItems.map(i => i.symbol)}.`);
			bot.sellCargo(invItems[0].symbol, invItems[0].units);
		}
		return 'fail';
	}
	
}