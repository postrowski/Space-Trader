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
	constructionSite: ConstructionSite | null = null;

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
			this.shipBots = this.shipBots.splice(index, 1);
			bot.manager = null;
			return true;
		}
		return false;
	}
	addMessage(bot: Bot | null, message: string) {
		this.automationService.addMessage(bot?.ship || null, message);
	}
	
	abstract doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void;

	step(systemsBySymbol: Map<string, System | null>,
         shipOperationBySymbol: Map<string, ExecutionStep>,
         activeShips: string[],
         credits: number) {
		
		this.contract = this.automationService.contract;
		this.constructionSite = this.automationService.constructionSite;
		
		for (const bot of this.shipBots) {
			// See if this ship is ready and able to do something for this manager:
			if (activeShips.length > 0 && !activeShips.includes(bot.ship.symbol)) {
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
			this.doStepCommon(bot, system, waypoint, credits);
			// Then so this specific manager needs to do.
			this.doStep(bot, system, waypoint, credits);
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
		let shipyard = hasShipyard ? this.shipyardService.getCachedShipyard(waypoint.symbol, false) : null;
		let jumpgate = isJumpgate ? this.jumpgateService.getJumpgateBySymbol(waypoint.symbol) : null;
		const marketDataAge = hasPriceData ? this.marketService.lastUpdateDate(waypoint.symbol) : null;

		const waypointsToExplore = this.explorationService.getWaypointsNeedingToBeExplored(system) || [];
		// Update our local information, if needed
		if (hasUncharted) {
			bot.chart(waypoint);
		}
		if (hasMarketplace) {
			// When we are exploring, always keep as full a fuel tank as possible,
			// otherwise keep 40% in the tank
			let minPercent = waypointsToExplore.length > 0 ? 95 : 40;
			bot.refuel(minPercent);
		}
		const tooOld = Date.now() - 1000 * 60 * 5; // 5 minutes ago 
		if (hasMarketplace && !hasPriceData) {
			// If this waypoint has a marketplace, but we dont have real price data:
			bot.getMarket(waypoint);
		} else if (hasMarketplace && (marketDataAge != null && (marketDataAge.getTime() < tooOld))) {
			// If this waypoint has a marketplace, but the price data is too old
			this.automationService.getMarketplaceForced(waypoint);
		}
		
		if (hasShipyard && (shipyard == null)) {
			// If this waypoint has a shipyard, but our cache is too old,
			// update the cached shipyard:
			this.automationService.getShipyard(waypoint, true);
		}
		
		if (isJumpgate && (jumpgate == null)) {
			// If this waypoint is a jumpgate, but not in our records:
			this.jumpgateService.getJumpgate(waypoint.symbol, true);
		}
		
		if (waypointsToExplore && waypointsToExplore.length > 0) {
			// check to see which waypoints have ships already in-route or present:
			for (const bot of this.automationService.shipBots) {
				const index = waypointsToExplore.findIndex((way)=> way.symbol == bot.ship.nav.waypointSymbol);
				if (index == -1) {
					waypointsToExplore.splice(index, 1);
				}
			}
			if (waypointsToExplore && waypointsToExplore.length > 0) {
				// Navigate to the next waypoint that needs to be explored:
				const loc = bot.traverseWaypoints(waypointsToExplore, waypoint, "exploring");
			}
		}
		
		if (hasShipyard) {
			this.automationService.buyShips(waypoint);
		}
		this.upgradeShipIfNeeded(bot, waypoint, credits);
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
				const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(waypoint, neededUpgrade, 1);
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
		bot.deliverAll(this.contract, this.constructionSite);
		let inventory = [...bot.ship.cargo.inventory];
		inventory = inventory.filter((inv) => inv.units > 0 &&
		                             bot.canSellOrJettisonCargo(inv.symbol, this.contract, this.constructionSite));
		inventory.sort((i1, i2) => {
			if (i1.units < i2.units) return -1;
			if (i1.units > i2.units) return 1;
			return 0;
		}).reverse();
		for (const inv of inventory) {
			const sellPlan = this.marketService.findBestMarketToSell(bot.ship, waypoint,
			                                                         inv.symbol, inv.units, 0);
			if (!sellPlan || sellPlan.profitPerSecond < 0) {
				continue;
			}
			if (sellPlan.sellItem.marketSymbol == waypoint.symbol) {
				bot.sellCargo(sellPlan.sellItem.symbol, inv.units);
			} else {
				const market = this.galaxyService.getWaypointByWaypointSymbol(sellPlan.sellItem.marketSymbol);
				if (market) {
					bot.navigateTo(market, sellPlan.travelSpeed,
					               `Navigating to ${sellPlan.sellItem.marketSymbol} to sell ${sellPlan.sellItem.symbol}`);
				}
			}
		}
	}
}