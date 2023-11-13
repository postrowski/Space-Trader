import { System } from "src/models/System";
import { AutomationService } from "../services/automation.service";
import { DBService } from "../services/db.service";
import { ExplorationService } from "../services/exploration.service";
import { FleetService } from "../services/fleet.service";
import { GalaxyService } from "../services/galaxy.service";
import { MarketService } from "../services/market.service";
import { Bot, ExecutionStep } from "./bot";
import { WaypointBase } from "src/models/WaypointBase";
import { ShipyardService } from "../services/shipyard.service";
import { JumpgateService } from "../services/jumpgate.service";
import { SurveyService } from "../services/survey.service";

export abstract class Manager {
	shipBots: Bot[] = [];
	automationService: AutomationService;

	currentStep: ExecutionStep | null = null;
	errorCount = 0;
	fleetService!: FleetService;
	shipyardService!: ShipyardService;
	jumpgateService!: JumpgateService;
	marketService: MarketService;
	galaxyService: GalaxyService;
	dbService: DBService;
	surveyService: SurveyService;
	explorationService!: ExplorationService;

	constructor(automationService: AutomationService) {
		this.automationService = automationService;
		this.fleetService = this.automationService.fleetService;
		this.shipyardService = this.automationService.shipyardService;
		this.jumpgateService = this.automationService.jumpgateService;
		this.galaxyService = this.automationService.galaxyService;
		this.dbService = this.automationService.dbService;
		this.marketService = this.automationService.marketService;
		this.surveyService = this.automationService.surveyService;
		this.explorationService = this.automationService.explorationService;
	}

	addBot(bot: Bot): boolean {
		if (this.shipBots.includes(bot) || (bot.manager !== null)) {
			return false;
		}
		this.shipBots.push(bot);
		bot.manager = this;
		return true;
	}
	addMessage(bot: Bot | null, message: string) {
		this.automationService.addMessage(bot?.ship || null, message);
	}
	
	abstract doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void;

	step(systemsBySymbol: Map<string, System | null>,
         shipOperationBySymbol: Map<string, ExecutionStep>,
         activeShips: string[],
         credits: number) {
		try {
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
				this.doStepCommon(bot, system, waypoint);
				// Then so this specific manager needs to do.
				this.doStep(bot, system, waypoint, credits);
			}
		} catch (error) {
			if (error instanceof ExecutionStep) {
				if (error.bot?.ship) {
					const shipSymbol = error.bot.ship.symbol;
					shipOperationBySymbol.set(shipSymbol, error);
					setTimeout(function() {
						if (shipOperationBySymbol.get(shipSymbol) == error) {
							shipOperationBySymbol.delete(shipSymbol);
						  	console.error(`Command '${error}' still not cleared after 10 seconds.`);
						}
					}, 10_000);
				}
				this.addMessage(error.bot, error.message);
				this.errorCount = Math.max(0, this.errorCount - 1);
			} else {
				console.error(error);
			}
		}
	}
	
	doStepCommon(bot: Bot, system: System, waypoint: WaypointBase): void {
		// Jump gates don't typically have traits, so we don't use the loadWaypoints when a jumpgate
		// doesn't have traits. The 'loadWaypoints' will load all the waypoints for the entire system
		// though, so this will still load the jumpgate's traits when another waypoint has not traits.
		if (!waypoint.traits && (waypoint.type !== 'JUMP_GATE')) {
			this.automationService.loadWaypoints(system);
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
			// Navigate to the next waypoint that needs to be explored:
			bot.traverseWaypoints(waypointsToExplore, waypoint, "exploring");
		}
	}

}