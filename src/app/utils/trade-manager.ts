import { Bot, Role } from "./bot";
import { Ship } from "src/models/Ship";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";
import { UiMarketItem } from "../services/market.service";
import { GalaxyService } from "../services/galaxy.service";
import { ExplorationService } from "../services/exploration.service";
import { LocXY } from "src/models/LocXY";
import { Contract } from "src/models/Contract";
import { ConstructionSite } from "src/models/ConstructionSite";
import { Survey } from "src/models/Survey";
import { ContractService } from "../services/contract.service";

export class TradeManager extends Manager {

	contractLoadStartTime = 0;

	contract: Contract | null = null;
	constructionSite: ConstructionSite | null = null;
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
	
	doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void {
		this.contract = this.automationService.contract;
		this.constructionSite = this.automationService.constructionSite;
		// Lets negatiate contracts first:
		// but don't try to get contracts more frequently than once a minute,
		// in case we are waiting for the load to complete
		if (!this.contract && this.contractLoadStartTime < Date.now()) {
			this.contractLoadStartTime = Date.now() + 1000 * 60;
			bot.negotiateContract();
		}

		const hasShipyard    = WaypointBase.hasShipyard(waypoint);
		const isDebrisField  = WaypointBase.isDebrisField(waypoint);
		const hasMarketplace = WaypointBase.hasMarketplace(waypoint);
		const isAsteroid     = WaypointBase.isAsteroid(waypoint);
		const isGasGiant     = WaypointBase.isGasGiant(waypoint);

		// Make sure we have at least some price data from evey single market and shipyard in this system.
		// If we are a ship at one of these locations, visit that market/shipyard.
		let marketsToVisit: WaypointBase[] = [];
		for (let sysWaypoint of system?.waypoints || []) {
			if (sysWaypoint.symbol == bot.ship.nav.waypointSymbol) {
				// We've already checked the market and shipyard prices for our current location
				continue;
			}
			const sysWaypointHasMarket = WaypointBase.hasMarketplace(sysWaypoint);
			const sysWaypointHasShipyard = WaypointBase.hasShipyard(sysWaypoint);
			if (sysWaypointHasMarket || sysWaypointHasShipyard) {
				let sysMarket = sysWaypointHasMarket ? this.marketService.hasPriceData(sysWaypoint.symbol) : false;
				let sysShipyard = sysWaypointHasShipyard ? this.shipyardService.getCachedShipyard(sysWaypoint.symbol, false) : null;
				const missingMarket = sysWaypointHasMarket && !sysMarket;
				const missingShipyard = sysWaypointHasShipyard && (sysShipyard == null);
				if (missingMarket || missingShipyard) {
					marketsToVisit.push(sysWaypoint);
				}
			}
		}
		// avoid sending two ships to the same location:
		const visitingDestinations = new Set(this.shipBots.map((otherBot) => otherBot.ship.nav.route.destination.symbol));
		marketsToVisit = marketsToVisit.filter((way) => !visitingDestinations.has(way.symbol));
		if (marketsToVisit.length > 0) {
			bot.traverseWaypoints(marketsToVisit, waypoint, "exploring markets");
		}

		const neededUpgrade = bot.getNeededUpgrade();
		let waypointDest: string | null = null;
		let waypointDestPurpose: string | null = null;
		if (neededUpgrade) {
			const hasItem = bot.ship.cargo.inventory.some(inv => inv.symbol === neededUpgrade);
			if (!hasItem) {
				const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(waypoint, neededUpgrade, 1);
				if (marketItem) {
					if (credits > marketItem.purchasePrice) {
						waypointDestPurpose = `going to market ${waypointDest} to buy upgrade ${neededUpgrade}`;
						waypointDest = marketItem.marketSymbol;
					}
				}
			} else {
				const shipyard = this.shipyardService.findNearestShipyard(waypoint);
				if (shipyard) {
					waypointDestPurpose = `going to shipyard ${shipyard.symbol} to install upgrade ${neededUpgrade}`;
					waypointDest = shipyard.symbol;
				}
			}
		}
		/*if (isFirstFastestBot && !waypointDest && credits > 170_000) {
			const shipyard = this.shipyardService.findNearestShipyard(waypoint);
			if (shipyard) {
				const houndShips = shipyard.ships.filter(ship => ship.name.toLowerCase().includes('hound'));
				if (houndShips && (houndShips.length > 0) && 
					credits > houndShips[0].purchasePrice) {
					let botsAtYard = botsByWaypointSymbol.get(shipyard.symbol);
					if (!botsAtYard) {
						this.addMessage(bot.ship, 'going to shipyard to buy ship');
						waypointDest = shipyard.symbol;
					}
				}
			} else {
				if (system.waypoints && System.hasShipyard(system)) {
					const shipyardWaypoints: WaypointBase[] = system.waypoints.filter((waypoint) => {
						return WaypointBase.hasShipyard(waypoint);
					});
					if (shipyardWaypoints?.length) {
						let botsAtYard = botsByWaypointSymbol.get(shipyardWaypoints[0].symbol);
						if (!botsAtYard) {
							this.addMessage(bot.ship, 'going to shipyard to look at ship');
							waypointDest = shipyardWaypoints[0].symbol;
						}
					}
				}
			}
		}*/
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
		if (!waypointDest && (bot == this.contractBot || this.constructionBots.includes(bot))) {
			bot.sellAtBestLocation(waypoint, contractAllowed ? this.contract : null,
			                       constructionAllowed ? this.constructionSite : null, otherShipsAtWaypoint);
			waypointDestPurpose = `going to market ${waypointDest} to buy contract/construction goods`;
			waypointDest = this.buyContractAndConstructionGoods(bot, waypoint, contractAllowed, constructionAllowed, credits);
		}
		if (waypointDest && waypointDestPurpose) {
			const dest = this.galaxyService.getWaypointByWaypointSymbol(waypointDest);
			if (dest) {
				bot.navigateTo(dest, null, waypointDestPurpose);
			}
		}

		if (bot.role == Role.Refinery) {
			bot.gatherOre(this.shipBots);
			bot.refineAll();
		} else if (bot.role != Role.Miner &&
				   bot.role != Role.Siphon) {
				   //(bot !== contractBot || !contractAllowed) &&
				   //(bot !== constructionBot || !constructionAllowed)
			let res;
			let tries = 0;
			let travelSpeed = 'CRUISE';
			do 	{
				res = bot.trade(waypoint, this.contract, this.constructionSite, credits,
				                travelSpeed, this.shipBots, otherShipsAtWaypoint);
				if (res == 'fail' && travelSpeed == 'CRUISE') {
					res = 'retry';
					travelSpeed = 'DRIFT';
				}
			} while (res == 'retry' && (tries++ < 10));
            if (res == 'wait') {
				return;
			}
		}

		if (bot.ship.nav.status === 'DOCKED' && hasMarketplace) {
			// If we are already docked at a marketplace, sell everything we've got:
			bot.sellAll(waypoint, this.contract, this.constructionSite, otherShipsAtWaypoint);
		}

		let roomToMine = bot.ship.cargo.units < bot.ship.cargo.capacity;
		/*if (roomToMine) {
			let botsAtWaypoint = botsByWaypointSymbol.get(waypoint.symbol);
			roomToMine = bot.ship.cargo.units < bot.ship.cargo.capacity/2;
		}*/
		if (isAsteroid || isDebrisField) {
			let surveys = this.surveyService.getSurveysForWaypoint(waypoint);
			let bestSurvey = this.getBestSurveyToUse(waypoint, surveys);
			if (surveys.length < 5) {
				bot.survey();
			}
			// If our cargo hold is below half capacity, we should be able
			// to get another load:
			if (roomToMine) {
				bot.mine(bestSurvey);
			}
		}
		if (isGasGiant && roomToMine) {
			bot.siphon();
		}
		if (hasMarketplace) {
			bot.sellAll(waypoint, this.contract, this.constructionSite, otherShipsAtWaypoint);
			if (neededUpgrade) {
				this.addMessage(bot, `buying upgrade item ${neededUpgrade}`);
				bot.buyItems(neededUpgrade, 1);
			}
		}
		if (hasShipyard) {
			bot.upgradeShip(waypoint);
			this.automationService.buyShips(waypoint);
		}
		if (bot.ship.cargo.capacity - bot.ship.cargo.units < 10) {
			// If we have less than 10 spaces for stuff, get rid of stuff we can't sell for a profit.
			bot.consolidateCargo(otherShipsAtWaypoint);
			bot.jettisonUnsellableCargo(waypoint, this.contract, this.constructionSite);
		}
		
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
				waypointDest = this.buyContractAndConstructionGoods(bot, waypoint, contractAllowed, constructionAllowed, credits);
				if (waypointDest) {
					const destWaypoint = this.galaxyService.getWaypointByWaypointSymbol(waypointDest);
					if (destWaypoint) {
						bot.navigateTo(destWaypoint, null, `going to market ${waypointDest} to buy contract/construction goods`);
					}
				}
			}
		} else if (bot.ship.cargo.units > 0) {
		
			let inventory = [...bot.ship.cargo.inventory];
			inventory = inventory.filter((inv) => !inv.symbol.startsWith("MODULE") &&
												  !inv.symbol.startsWith("MOUNT") &&
												  !inv.symbol.includes("ANTIMATTER"));
			inventory.sort((i1, i2) => {
				if (i1.units < i2.units) return -1;
				if (i1.units > i2.units) return 1;
				return 0;
			});
			for (const inv of inventory) {
				const sellItem = this.marketService.findHighestPricedMarketItemForSaleInSystem(waypoint, inv.symbol, inv.units);
				if (sellItem) {
					if (sellItem.marketSymbol == waypoint.symbol) {
						bot.sellCargo(sellItem.symbol, inv.units);
					} else {
						const market = this.galaxyService.getWaypointByWaypointSymbol(sellItem.marketSymbol);
						if (market) {
							const dist = LocXY.getDistance(waypoint, market);
							const aveFuelCost = this.marketService.getAverageFuelCost(waypoint.symbol)
							const fuelCost = dist * 2 * aveFuelCost;
							if (inv.units * sellItem.sellPrice < fuelCost) {
								bot.navigateTo(market, null, `Navigating to ${sellItem.marketSymbol} to sell ${sellItem.symbol}`);
							}
						}
					}
				}
			}
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
				itemsToBuy.push({
					symbol: material.tradeSymbol,
					units: material.required - material.fulfilled,
					itemFor: 'construction Site',
					deliverTo: this.constructionSite.symbol
				});
			}
		}
		if (this.contract && contractAllowed) {
			for (const goods of this.contract.terms.deliver) {
				itemsToBuy.push({
					symbol: goods.tradeSymbol,
					units: goods.unitsRequired - goods.unitsFulfilled,
				 	itemFor: 'contract',
					deliverTo: goods.destinationSymbol
				});
			}
		}
		for (const itemToBuy of itemsToBuy) {
			const lowPrice = this.marketService.getItemHistoricalLowPriceAtMarket(waypoint.symbol, itemToBuy.symbol);
			const currentPrices: Map<string, UiMarketItem> = this.marketService.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, itemToBuy.symbol);
			if (currentPrices == null || currentPrices.size == 0) {
				continue;
			}
			let minPrice = Infinity;
			for (let item of currentPrices.values()) {
				if (item.purchasePrice < minPrice) {
					minPrice = item.purchasePrice;
				}
			}

			let tooExpensive = (minPrice > lowPrice* 2);
			if (tooExpensive || (credits < minPrice)) {
				console.log(`Contract/construction item ${itemToBuy.symbol} too expensive at ${minPrice}, seen as low as ${lowPrice}`);
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
		for (const itemToBuy of itemsToBuy) {
			const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(waypoint, itemToBuy.symbol, itemToBuy.units);
			if (marketItem) {
				const supplierMarket = this.galaxyService.getWaypointByWaypointSymbol(marketItem.marketSymbol);
				if (supplierMarket) {
					const distForItem = LocXY.getDistance(waypoint, supplierMarket);
					if (closestDist > distForItem) {
						closestDist = distForItem;
						closestItem = itemToBuy;
						closestMarket = supplierMarket;
					}
				}
			}
		}
		if (closestMarket && closestItem) {
			if (waypoint.symbol != closestMarket.symbol) {
				this.addMessage(bot, `going to market ${closestMarket.symbol} to buy ${itemFor} item ${closestItem?.symbol}.`);
				return closestMarket.symbol;
			}
			this.addMessage(bot, `buying ${itemFor} item: ${closestItem.units} ${closestItem.symbol}.`);
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
	
}