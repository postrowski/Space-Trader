import { System } from "src/models/System";
import { AutomationService, ExecutionStep } from "../services/automation.service";
import { DBService } from "../services/db.service";
import { ExplorationService } from "../services/exploration.service";
import { FleetService } from "../services/fleet.service";
import { GalaxyService } from "../services/galaxy.service";
import { MarketService, UiMarketItem } from "../services/market.service";
import { Bot } from "./bot";
import { WaypointBase } from "src/models/WaypointBase";
import { ShipyardService } from "../services/shipyard.service";
import { JumpgateService } from "../services/jumpgate.service";
import { SurveyService } from "../services/survey.service";
import { Contract } from "src/models/Contract";
import { ConstructionSite } from "src/models/ConstructionSite";
import { Survey } from "src/models/Survey";
import { LocXY } from "src/models/LocXY";

export abstract class Manager {
	shipBots: Bot[] = [];
	automationService: AutomationService;

	fleetService!: FleetService;
	shipyardService!: ShipyardService;
	jumpgateService!: JumpgateService;
	marketService: MarketService;
	galaxyService: GalaxyService;
	dbService: DBService;
	surveyService: SurveyService;
	explorationService!: ExplorationService;
	key: string;

	contractLoadStartTime = 0;

	contract: Contract | null = null;
	constructionSite: ConstructionSite | undefined | null = null;

	constructor(automationService: AutomationService, key: string) {
		this.automationService = automationService;
		this.fleetService = this.automationService.fleetService;
		this.shipyardService = this.automationService.shipyardService;
		this.jumpgateService = this.automationService.jumpgateService;
		this.galaxyService = this.automationService.galaxyService;
		this.dbService = this.automationService.dbService;
		this.marketService = this.automationService.marketService;
		this.surveyService = this.automationService.surveyService;
		this.explorationService = this.automationService.explorationService;
		this.key = key;
	}

	addBot(bot: Bot): boolean {
		if (this.shipBots.includes(bot) || (bot.manager !== null)) {
			return false;
		}
		this.shipBots.push(bot);
		bot.manager = this;
		return true;
	}
	removeBot(bot: Bot): boolean {
		const index = this.shipBots.findIndex(b => b.ship.symbol === bot.ship.symbol);
		if (index >= 0 && bot.manager == this) {
			this.shipBots.splice(index, 1);
			bot.manager = null;
			return true;
		}
		return false;
	}
	addMessage(bot: Bot | null, message: string) {
		this.automationService.addMessage(bot?.ship || null, message);
	}
	getBotsInSystem(systemSymbol: string): Bot[] {
		return this.shipBots.filter(b => b.ship.nav.systemSymbol == systemSymbol);
	}
	abstract doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void;

	static waypointsToExploreBySystemSymbol = new Map<string, WaypointBase[]>();
	static getWaypointsToExplore(systemsBySymbol: Map<string, System | null>, bots: Bot[],
	                             explorationService: ExplorationService) {
		Manager.waypointsToExploreBySystemSymbol.clear();
		const waypointSymbols = new Set<string> (bots.map(bot => bot.ship.nav.waypointSymbol));
		let systemSymbols = [...waypointSymbols].map(waypointSymbol => GalaxyService.getSystemSymbolFromWaypointSymbol(waypointSymbol));
		systemSymbols = [...new Set<string>(systemSymbols)];
		for (const systemSymbol of systemSymbols) {
			const system = systemsBySymbol.get(systemSymbol);
			if (system) {
				const waypointsToExplore = explorationService.getWaypointsNeedingToBeExplored(system) || [];
				Manager.waypointsToExploreBySystemSymbol.set(system.symbol, waypointsToExplore);
			}
		}
	}
	
	step(systemsBySymbol: Map<string, System | null>,
         shipOperationBySymbol: Map<string, ExecutionStep>,
         automationEnabledShips: string[],
         credits: number) {
		
		this.contract = this.automationService.contract;
		this.constructionSite = this.automationService.constructionSite;
	
		for (const bot of this.shipBots) {
			const stepStart = Date.now();
			// See if this ship is ready and able to do something for this manager:
			if (automationEnabledShips.length > 0 && !automationEnabledShips.includes(bot.ship.symbol)) {
				continue;
			}
			if (bot.manager != this) {
				continue;
			}
			if (bot.ship.nav.status === 'IN_TRANSIT') {
				continue;
			}
			const currentOperation = shipOperationBySymbol.get(bot.ship.symbol);
			if (currentOperation || bot.currentStep) {
				continue;
			}
			
			// Get the system and waypoint we'll need later:
			const waypointSymbol = bot.ship.nav.waypointSymbol;
			const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypointSymbol);
			const system = systemsBySymbol.get(systemSymbol);
			if (!system) {
				continue; // don't proceed until we get that system back from the DB
			}
			const waypoint = system.waypoints?.find((waypoint) => waypoint.symbol === waypointSymbol) || null;
			if (!waypoint) {
				this.addMessage(bot, `Can't find waypoint ${bot.ship.nav.waypointSymbol}`);
				continue;
			}
			// Do what ALL manager-controlled bots need to do
			const stepCommonStart = Date.now();
			this.doStepCommon(bot, system, waypoint, credits);
			const stepSpecificStart = Date.now();
			// Then so this specific manager needs to do.
			this.doStep(bot, system, waypoint, credits);
			const end = Date.now();
			//console.log(`manager key ${this.key}, ship ${bot.ship.symbol}: prep took ${stepCommonStart - stepStart}, common took ${stepSpecificStart - stepCommonStart}, specific took ${end - stepSpecificStart}`)
		}
	}
	
	doStepCommon(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void {
		// Jump gates don't typically have traits, so we don't use the loadWaypoints when a jumpgate
		// doesn't have traits. The 'loadWaypoints' will load all the waypoints for the entire system
		// though, so this will still load the jumpgate's traits when another waypoint has not traits.
		if (!waypoint.traits && (waypoint.type !== 'JUMP_GATE')) {
			this.automationService.loadWaypoints(system);
		}
		// Lets negatiate contracts first:
		// but don't try to get contracts more frequently than once a minute,
		// in case we are waiting for the load to complete
		if (!this.contract && this.contractLoadStartTime < Date.now()) {
			this.contractLoadStartTime = Date.now() + 1000 * 60;
			bot.negotiateContract();
		}
		
		const isJumpgate     = WaypointBase.isJumpGate(waypoint);
		const hasShipyard    = WaypointBase.hasShipyard(waypoint);
		const hasUncharted   = WaypointBase.hasUncharted(waypoint);
		const hasMarketplace = WaypointBase.hasMarketplace(waypoint);
		let hasPriceData = hasMarketplace ? this.marketService.hasPriceData(waypoint.symbol) : false;
		let shipyard = hasShipyard ? this.shipyardService.getCachedShipyard(waypoint.symbol) : null;
		let jumpgate = isJumpgate ? this.jumpgateService.getJumpgateBySymbol(waypoint.symbol) : null;
		const marketDataAge = hasPriceData ? this.marketService.lastUpdateDate(waypoint.symbol) : null;

		// Update our local information, if needed
		if (hasUncharted) {
			bot.chart(waypoint);
		}
		bot.refuel(40);
		const tooOld = Date.now() - 1000 * 60 * 5; // 5 minutes ago 
		if (hasMarketplace && !hasPriceData) {
			// If this waypoint has a marketplace, but we dont have real price data:
			bot.getMarket(waypoint);
		} else if (hasMarketplace && (marketDataAge != null && (marketDataAge.getTime() < tooOld))) {
			// If this waypoint has a marketplace, but the price data is too old
			this.automationService.getMarketplaceForced(waypoint);
		}
		
		if (hasShipyard && (shipyard?.ships == null || shipyard.ships.length == 0)) {
			// If this waypoint has a shipyard, but no cache data, update the cached shipyard:
			this.automationService.getShipyard(waypoint);
		}
		
		if (isJumpgate && (jumpgate == null)) {
			// If this waypoint is a jumpgate, but not in our records:
			this.jumpgateService.getJumpgate(waypoint.symbol, true);
		}
		
		if (hasShipyard) {
			this.automationService.buyShips(waypoint);
		}
		// In 2.1, ship upgrades are not functional:
		//this.upgradeShipIfNeeded(bot, waypoint, credits);
	}
	
	otherShipsAtWaypoint(bot: Bot): Bot[] {
		return this.shipBots.filter((otherBot) => {
			return (bot.ship.symbol != otherBot.ship.symbol) && 
					(otherBot.ship.nav.status !== 'IN_TRANSIT') && 
					(bot.ship.nav.waypointSymbol == otherBot.ship.nav.waypointSymbol);
		});
	}
	otherShipsInSystem(bot: Bot): Bot[] {
		return this.shipBots.filter((otherBot) => {
			return (bot.ship.symbol != otherBot.ship.symbol) && 
					(bot.ship.nav.systemSymbol == otherBot.ship.nav.systemSymbol);
		});
	}
	
	upgradeShipIfNeeded(bot: Bot, waypoint: WaypointBase, credits: number) {
		const neededUpgrade = bot.getNeededUpgrade();
		let waypointDest: string | null = null;
		let waypointDestPurpose: string | null = null;
		if (neededUpgrade) {
			const hasItem = bot.ship.cargo.inventory.some(inv => inv.symbol === neededUpgrade);
			if (hasItem) {
				const shipyard = this.shipyardService.findNearestShipyard(waypoint);
				if (shipyard) {
					if (shipyard.symbol == waypoint.symbol) {
						bot.upgradeShip(waypoint);
					} else {
						waypointDestPurpose = `going to shipyard ${shipyard.symbol} to install upgrade ${neededUpgrade}`;
						waypointDest = shipyard.symbol;
					}
				}
			} else {
				const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(waypoint, neededUpgrade, 1, false);
				if (marketItem && (credits > marketItem.purchasePrice)) {
					if (marketItem.marketSymbol == waypoint.symbol) {
						this.addMessage(bot, `buying upgrade item ${neededUpgrade}`);
						bot.buyItems(neededUpgrade, 1);
					} else {
						waypointDest = marketItem.marketSymbol;
						waypointDestPurpose = `going to market ${waypointDest} to buy upgrade ${neededUpgrade}`;
					}
				}
			}
		}
		
		if (waypointDest && waypointDestPurpose) {
			const dest = this.galaxyService.getWaypointByWaypointSymbol(waypointDest);
			if (dest) {
				bot.navigateTo(dest, null, waypointDestPurpose);
			}
		}
	}
	
	sellAll(bot: Bot, waypoint: WaypointBase) {
		bot.deliverAll(this.contract, this.constructionSite, true, true);
		const sellPlan = this.marketService.findBestMarketToSellAll(bot.ship, waypoint, 0);
		if (sellPlan) {
			if (sellPlan.endingWaypoint.symbol == waypoint.symbol) {
				for (const sellItem of sellPlan.sellItems) {
					for (const inv of bot.ship.cargo.inventory.filter(i => i.symbol == sellItem.symbol)) {
	                    if (bot.canSellOrJettisonCargo(inv.symbol, this.contract, this.constructionSite)) {
							bot.sellCargo(inv.symbol, inv.units);
						}
					}
				}
			} else {
				bot.navigateTo(sellPlan.endingWaypoint, sellPlan.route.steps[0].speed,
				               `Navigating to ${sellPlan.endingWaypoint.symbol} to sell ${sellPlan.sellItems.map(i => i.symbol)}`);
			}
		}
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

	executeTradeRoute(bot: Bot, waypoint: WaypointBase, system: System, otherShipsAtWaypoint: Bot[]): 'retry' | 'wait' | 'fail' {
		if (!bot.currentTradeRoute || !system.waypoints) {
			return 'fail';
		}
		const space = bot.ship.cargo.capacity - bot.ship.cargo.units;
		const invItems = bot.ship.cargo.inventory
		                    .filter((inv) => bot.currentTradeRoute?.sellItems.some(i => i.symbol === inv.symbol)
		                                  || bot.currentTradeRoute?.deliverItems.some(i => i.symbol === inv.symbol)
		                                  || bot.currentTradeRoute?.buyItem?.symbol === inv.symbol);
		const invItem = (invItems && invItems.length > 0) ? invItems[0] : null;
		const itemCount = invItem?.units || 0;
		
		if (bot.currentTradeRoute.state == 'goBuy') {
			if (waypoint.symbol == bot.currentTradeRoute.buyItem?.marketSymbol) {
				bot.currentTradeRoute.state = 'buy';
			} else if (waypoint.symbol == bot.currentTradeRoute.startingWaypoint.symbol) {
				bot.currentTradeRoute.state = 'collect';
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
		if (bot.currentTradeRoute.state == 'buy') {
			if (bot.currentTradeRoute.buyItem?.marketSymbol != bot.ship.nav.waypointSymbol) {
				bot.currentTradeRoute.state = 'goBuy';
				return 'retry';
			}
			// We are at the 'buy' location, buy until we have no room or money, and then go to the 'sell' location
			if (space == 0 || (this.automationService.agent?.credits || 0) < bot.currentTradeRoute.buyItem.purchasePrice) {
				bot.currentTradeRoute.state = 'goSell';
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
						return 'retry';
					}
					bot.currentTradeRoute.state = 'goSell';
				}
			}
		}
		if (bot.currentTradeRoute.state == 'collect' && bot.currentTradeRoute.startingWaypoint.symbol == bot.ship.nav.waypointSymbol) {
			// We are at the 'collect' location, buy until we have no room, and then go to the 'sell' location
			if (space == 0) {
				bot.currentTradeRoute.state = 'goSell';
			} else if (bot.ship.nav.status != 'IN_TRANSIT') {
				// wait here until our cargo gets filled up by a miner.
				if (otherShipsAtWaypoint.length == 0) {
					// If there are no longer any mining ships here, we should go sell what we've got.
					bot.currentTradeRoute.state = 'goSell';
				}
			}
		}
		if (bot.currentTradeRoute.state == 'goSell') {
			if (bot.currentTradeRoute.endingWaypoint.symbol == waypoint.symbol) {
				bot.currentTradeRoute.state = 'sell';
			} else {
				if ((space > 0) && (itemCount == 0)) {
					// We don't we the item to sell. Maybe we didn't have enough money to buy the item when we got here?
					// Wait until we have at least something!
					bot.currentTradeRoute.state = 'goBuy';
					return 'wait';
				}
				// go to the 'sell' location
				const market = system.waypoints.find((wp) => wp.symbol == bot.currentTradeRoute!.endingWaypoint.symbol);
				if (market && market.symbol !== waypoint.symbol) {
					let via = '';
					if (bot.currentTradeRoute.route.steps.length > 1) { 
						via = (' (via ' + bot.currentTradeRoute.route.steps.map(s=>s.loc.symbol)+')');
					}
					bot.navigateTo(market, bot.currentTradeRoute.route.steps[0].speed,
									`Going to ${bot.currentTradeRoute.endingWaypoint.symbol}`+
									`${via} to sell trade item ${bot.currentTradeRoute.sellItems.map(i => i.symbol)}`+
									` for $${bot.currentTradeRoute.profit}`);
				}
			}
		}
		if (bot.currentTradeRoute.state == 'sell' &&
		    bot.currentTradeRoute.endingWaypoint.symbol == bot.ship.nav.waypointSymbol) {
			// We are at the 'sell' location.
			if (itemCount == 0) {
				bot.currentTradeRoute = null;
				return 'retry';
			}
			this.addMessage(bot, `market ${waypoint.symbol} end of trade route to sell ${bot.currentTradeRoute.sellItems.map(i => i.symbol)}.`);
			if (bot.currentTradeRoute.deliverItems.length > 0) {
				bot.deliverAll(this.contract, this.constructionSite, false, false);
			}
			if (invItem && bot.currentTradeRoute.sellItems.some(i => i.symbol == invItem.symbol)) {
				bot.sellCargo(invItem.symbol, invItem.units);
			}
		}
		return 'fail';
	}

}