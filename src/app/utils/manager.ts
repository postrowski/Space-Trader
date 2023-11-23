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
			this.shipBots.splice(index, 1);
			bot.manager = null;
			return true;
		}
		return false;
	}
	addMessage(bot: Bot | null, message: string) {
		this.automationService.addMessage(bot?.ship || null, message);
	}
	
	abstract doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void;

	static waypointsToExploreBySystemSymbol = new Map<string, WaypointBase[]>();
	static getWaypointsToExplore(systemsBySymbol: Map<string, System | null>, bots: Bot[],
	                             explorationService: ExplorationService) {
		Manager.waypointsToExploreBySystemSymbol.clear();
		const waypointSymbols = new Set<string> (bots.map(bot => bot.ship.nav.waypointSymbol));
		const systemSymbols = [...waypointSymbols].map(waypointSymbol => GalaxyService.getSystemSymbolFromWaypointSymbol(waypointSymbol));
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
         activeShips: string[],
         credits: number) {
		
		this.contract = this.automationService.contract;
		this.constructionSite = this.automationService.constructionSite;
	
		for (const bot of this.shipBots) {
			const stepStart = Date.now();
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
		const waypointsToExplore = Manager.waypointsToExploreBySystemSymbol.get(system.symbol);
		if (hasMarketplace) {
			// When we are exploring, always keep as full a fuel tank as possible,
			// otherwise keep 40% in the tank
			let minPercent = (waypointsToExplore && (waypointsToExplore.length > 0)) ? 95 : 40;
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
		
		if (hasShipyard && (shipyard?.ships == null || shipyard.ships.length == 0)) {
			// If this waypoint has a shipyard, but no cache data, update the cached shipyard:
			this.automationService.getShipyard(waypoint);
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
		bot.deliverAll(this.contract, this.constructionSite, true);
		const sellPlan = this.marketService.findBestMarketToSellAll(bot.ship, waypoint, 0);
		if (sellPlan) {
			if (sellPlan.sellWaypoint.symbol == waypoint.symbol) {
				for (const sellItem of sellPlan.sellItems) {
					for (const inv of bot.ship.cargo.inventory.filter(i => i.symbol == sellItem.symbol)) {
	                    if (bot.canSellOrJettisonCargo(inv.symbol, this.contract, this.constructionSite)) {
							bot.sellCargo(inv.symbol, inv.units);
						}
					}
				}
			} else {
				bot.navigateTo(sellPlan.sellWaypoint, sellPlan.route.steps[0].speed,
				               `Navigating to ${sellPlan.sellWaypoint.symbol} to sell ${sellPlan.sellItems.map(i => i.symbol)}`);
			}
		}
	}
}