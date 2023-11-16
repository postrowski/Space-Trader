import { Bot, Role } from "./bot";
import { Ship } from "src/models/Ship";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";
import { UiMarketItem } from "../services/market.service";
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
				this.constructionBots = this.constructionBots.splice(index, 1);
			}
			index = this.haulerBots.findIndex(b => b.ship.symbol === bot.ship.symbol);
			if (index >= 0) {
				this.haulerBots = this.haulerBots.splice(index, 1);
			}
			if (bot == this.contractBot) {
				this.contractBot = null;
			}
			return true;
		}
		return false;
	}
	
	doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void {
		const isDebrisField  = WaypointBase.isDebrisField(waypoint);
		const hasMarketplace = WaypointBase.hasMarketplace(waypoint);
		const isAsteroid     = WaypointBase.isAsteroid(waypoint);
		const isGasGiant     = WaypointBase.isGasGiant(waypoint);

		const otherShipsAtWaypoint = this.shipBots.filter((otherBot) => {
			return (bot.ship.symbol != otherBot.ship.symbol) && 
					(otherBot.ship.nav.status !== 'IN_TRANSIT') && 
					(bot.ship.nav.waypointSymbol == otherBot.ship.nav.waypointSymbol);
		});
		if (this.contract || this.constructionSite) {
			// If this is a drone or a probe, it doesn't make sense to have it making contract/construction runs.
			if (bot.ship.cargo.capacity > 20 && (bot == this.contractBot || this.constructionBots.includes(bot))) {
				bot.deliverAll(this.contract, this.constructionSite);
			}
		}
		let contractAllowed = (bot == this.contractBot) && (credits > 500_000);
		let constructionAllowed = this.constructionBots.includes(bot) && (credits > 1_000_000);
		if ((bot == this.contractBot || this.constructionBots.includes(bot))) {
			bot.sellAtBestLocation(waypoint, this.contract, this.constructionSite, otherShipsAtWaypoint);
			let waypointDest = this.buyContractAndConstructionGoods(bot, waypoint, contractAllowed, constructionAllowed, credits);
			if (waypointDest) {
				const dest = this.galaxyService.getWaypointByWaypointSymbol(waypointDest);
				if (dest) {
					bot.navigateTo(dest, null, `going to market ${waypointDest} to buy contract/construction goods`);
				}
			}
		}

		let res;
		let tries = 0;
		let travelSpeed = 'CRUISE';
		do 	{
			res = this.trade(bot, waypoint, credits, travelSpeed, this.shipBots, otherShipsAtWaypoint);
			if (res == 'fail' && travelSpeed == 'CRUISE') {
				res = 'retry';
				travelSpeed = 'DRIFT';
			}
		} while (res == 'retry' && (tries++ < 10));
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
				}
			} else if (Ship.containsMount(bot.ship, 'MOUNT_GAS_SIPHON')) {
				if (!isGasGiant) {
					const gasGiants = system.waypoints?.filter((way) => WaypointBase.isGasGiant(way) && way != waypoint) || [];
					if (gasGiants.length > 0) {
						const nearbyWaypoints = ExplorationService.sortWaypointsByDistanceFrom(gasGiants, waypoint);
						bot.navigateTo(nearbyWaypoints[0], null, 'going to gas giant to siphon.');
					}
				}
			} else {
				// we aren't doing anything else, check if we should contribute to the contract or construction site
				const waypointDest = this.buyContractAndConstructionGoods(bot, waypoint, contractAllowed, constructionAllowed, credits);
				if (waypointDest) {
					const destWaypoint = this.galaxyService.getWaypointByWaypointSymbol(waypointDest);
					if (destWaypoint) {
						bot.navigateTo(destWaypoint, null, `going to market ${waypointDest} to buy contract/construction goods`);
					}
				}
			}
		} else if (bot.ship.cargo.units > 0) {
			// roomToMine == false
			this.sellAll(bot, waypoint);
		}
	}
	
	buyContractAndConstructionGoods(bot: Bot, waypoint: WaypointBase, contractAllowed: boolean, constructionAllowed: boolean, credits: number): string | null {
		if (bot.ship.cargo.capacity < 25) {
			// If we don't have much space for cargo, don't be a part of the contract/construction crew
			return null;
		}
		let itemFor = '';
		let itemsToBuy: {symbol: string, units: number, itemFor: string, deliverTo: string}[] = [];
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
			if (currentPrices == null || currentPrices.size == 0) {
				continue;
			}
			let minPrice = Infinity;
			for (let item of currentPrices.values()) {
				// never buy items that are SCARCE or LIMITED, the prices will be too high
				if (item.supply == 'ABUNDANT' || item.supply == 'HIGH' || item.supply == 'MODERATE') {
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
	      travelSpeed: string, allShips: Bot[], otherShipsAtWaypoint: Bot[]): string {
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
				let bestRoute = this.marketService.getBestTradeRoutesFrom(waypoint, bot.ship.cargo.capacity, creditsAvailable, excludedTradeItems, travelSpeed);
				const localWaypoints = system.waypoints.filter((wp) => wp.x == waypoint.x && wp.y == waypoint.y);
				for (const way of localWaypoints || []) {
					if (way.symbol != waypoint.symbol) {
						const bestRouteWay = this.marketService.getBestTradeRoutesFrom(way, bot.ship.cargo.capacity, creditsAvailable, excludedTradeItems, travelSpeed);
						if ((bestRouteWay?.profit || 0) > (bestRoute?.profit || 0)) {
							bestRoute = bestRouteWay;
						}
					}
				}
				const nonLocalWaypoints = system.waypoints.filter((wp) => wp.x != waypoint.x || wp.y != waypoint.y);
				const fuelPricesByWaypointSymbol = bot.marketService.getPricesForItemInSystemByWaypointSymbol(system.symbol, 'FUEL');
				if (nonLocalWaypoints) {
					const localFuelCost = fuelPricesByWaypointSymbol.get(waypoint.symbol);
					for (const way of nonLocalWaypoints) {
						const destFuelCost = fuelPricesByWaypointSymbol.get(way.symbol);
						let dist = LocXY.getDistance(way, waypoint);
						if (travelSpeed == 'DRIFT') {
							dist = 1;
						}
						let fuelCost = dist * Math.min(localFuelCost?.purchasePrice || Infinity, destFuelCost?.purchasePrice || Infinity, bot.marketService.getAverageFuelCost(system.symbol));
						if (way.symbol != waypoint.symbol) {
							const bestRouteWay = this.marketService.getBestTradeRoutesFrom(way, bot.ship.cargo.capacity, creditsAvailable, excludedTradeItems, travelSpeed);
							if (bestRouteWay) {
								bestRouteWay.profit -= fuelCost;
								if ((bestRouteWay.profit>0) && (bestRoute == null || bestRouteWay.profit > bestRoute.profit)) {
									bestRoute = bestRouteWay;
								}
							}
						}
					}
				}
				const botSupport = bot.getBestMinerToSupport(waypoint, travelSpeed, system, fuelPricesByWaypointSymbol, allShips);
				if (botSupport && (bestRoute == null || bestRoute.profit < botSupport.proceeds)) {
					bestRoute = {
						waypointSymbol: botSupport.waypointSymbol,
						buyItem: null,
						sellItem: botSupport.sellItem,
						profit: botSupport.proceeds,
						travelSpeed: botSupport.travelSpeed
					};
				}
				if (bestRoute) {
					this.addMessage(bot, `Creating trade route (speed ${bestRoute.travelSpeed}), trading ${bestRoute.sellItem.symbol} from ${bestRoute.buyItem?.marketSymbol || bestRoute.waypointSymbol} at $${bestRoute.buyItem?.purchasePrice || 0} to ${bestRoute.sellItem.marketSymbol} at $${bestRoute.sellItem.sellPrice}, for a profit of ${bestRoute.profit}`);
				} else {
					this.addMessage(bot, `no trade route found (speed ${travelSpeed})`);
				}
				bot.currentTradeRoute = bestRoute;
				bot.tradeRouteState = 'goBuy';
			} else {
				// We don't have a trade route, but we have no space to buy anything new.
				// Figure out where to sell what we have.
				let inventory = [...bot.ship.cargo.inventory];
				inventory = inventory.filter((inv) => inv.units > 0 && bot.canSellOrJettisonCargo(inv.symbol, this.contract, this.constructionSite));
				if (inventory.length > 0) {
					inventory.sort((i1, i2) => {
						if (i1.units < i2.units) return -1;
						if (i1.units > i2.units) return 1;
						return 0;
					});
					const mostPopulousItem = inventory[inventory.length-1];
					const destMarket: {market: WaypointBase, sellItem: UiMarketItem, proceeds: number} | null = 
										 this.marketService.findBestMarketToSell(waypoint,
																				 mostPopulousItem.symbol,
																				 mostPopulousItem.units,
																				 'CRUISE');
					if (destMarket) {
						bot.navigateTo(destMarket.market, 'CRUISE',
						                `Going to ${destMarket.market.symbol} to sell item ${mostPopulousItem.symbol} for $${destMarket.proceeds}`);
					}
				}
			}
		}
		if (!bot.currentTradeRoute) {
			return 'fail';
		}

		const invItems = bot.ship.cargo.inventory
		                   .filter((inv) => inv.symbol == bot.currentTradeRoute?.sellItem.symbol);
		const itemCount = (invItems && invItems.length == 1) ? invItems[0].units : 0;
		
		if (bot.tradeRouteState == 'goBuy') {
			if (waypoint.symbol == bot.currentTradeRoute.buyItem?.marketSymbol) {
				bot.tradeRouteState = 'buy';
			} else if (waypoint.symbol == bot.currentTradeRoute.waypointSymbol) {
				bot.tradeRouteState = 'collect';
			} else {
				const curRouteBuyWaypointSymbol = bot.currentTradeRoute.buyItem?.marketSymbol || bot.currentTradeRoute.waypointSymbol;
				// go to the 'buy' location
				const market = system.waypoints.find((wp) => wp.symbol == curRouteBuyWaypointSymbol);
				if (market && market.symbol !== waypoint.symbol) {
					bot.navigateTo(market, bot.currentTradeRoute.travelSpeed,
									`Going to ${market.symbol} to buy trade item ${bot.currentTradeRoute.sellItem.symbol} for $${bot.currentTradeRoute.profit}`);
				}
			}
		}
		if (bot.tradeRouteState == 'buy' && bot.currentTradeRoute.buyItem?.marketSymbol == bot.ship.nav.waypointSymbol) {
			// We are at the 'buy' location, buy until we have no room or money, and then go to the 'sell' location
			if (space == 0 || (this.automationService.agent?.credits || 0) < bot.currentTradeRoute.buyItem.purchasePrice) {
				bot.tradeRouteState = 'goSell';
			} else if (bot.ship.nav.status != 'IN_TRANSIT') {
				const currentItem = this.marketService.getItemAtMarket(bot.currentTradeRoute.buyItem.marketSymbol, bot.currentTradeRoute.buyItem.symbol);
				// make sure the item purchase price is still cheaper than the sell price
				if (currentItem && (currentItem.purchasePrice < bot.currentTradeRoute.sellItem.sellPrice) && bot.ship.cargo.units < bot.ship.cargo.capacity) {
					if (currentItem.purchasePrice < 1) {
						// Wait here until we get filled by the minning bot
					} else {
						this.addMessage(bot, `at market ${waypoint.symbol} to start of trade route. Buying ${space} ${bot.currentTradeRoute.buyItem.symbol}.`);
						bot.purchaseCargo(bot.currentTradeRoute.buyItem.symbol, space);
					}
				} else {
					this.addMessage(bot, `Costs of trade item ${bot.currentTradeRoute.buyItem.symbol} at ${bot.currentTradeRoute.buyItem.marketSymbol} have changed from ${bot.currentTradeRoute.buyItem.purchasePrice} to ${currentItem?.purchasePrice}, which exceeds the current sell price of $${bot.currentTradeRoute.sellItem.sellPrice}, aborting trade route!`);
					if (itemCount == 0) {
						bot.currentTradeRoute = null;
						bot.tradeRouteState = '';
						return 'retry';
					}
					bot.tradeRouteState = 'goSell';
				}
			}
		}
		if (bot.tradeRouteState == 'collect' && bot.currentTradeRoute.waypointSymbol == bot.ship.nav.waypointSymbol) {
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
			if (bot.currentTradeRoute.sellItem.marketSymbol == waypoint.symbol) {
				bot.tradeRouteState = 'sell';
			} else {
				if ((space > 0) && (itemCount == 0)) {
					// We don't we the item to sell. Maybe we didn't have enough money to buy the item when we got here?
					// Wait until we have at least something!
					bot.tradeRouteState = 'goBuy';
					return 'wait';
				}
				// go to the 'sell' location
				const market = system.waypoints.find((wp) => wp.symbol == bot.currentTradeRoute!.sellItem.marketSymbol);
				if (market && market.symbol !== waypoint.symbol) {
					bot.navigateTo(market, bot.currentTradeRoute.travelSpeed,
									`Going to ${bot.currentTradeRoute.sellItem.marketSymbol} to sell trade item ${bot.currentTradeRoute.sellItem.symbol} for $${bot.currentTradeRoute.profit}`);
				}
			}
		}
		if (bot.tradeRouteState == 'sell' && bot.currentTradeRoute.sellItem.marketSymbol == bot.ship.nav.waypointSymbol) {
			// We are at the 'sell' location.
			if (itemCount == 0) {
				bot.currentTradeRoute = null;
				bot.tradeRouteState = '';
				return 'retry';
			}
			this.addMessage(bot, `market ${waypoint.symbol} end of trade route to sell ${bot.currentTradeRoute.sellItem.symbol}.`);
			bot.sellCargo(bot.currentTradeRoute.sellItem.symbol, invItems[0].units);
		}
		return 'fail';
	}
	
}