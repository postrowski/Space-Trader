import { Bot } from "./bot";
import { Ship } from "src/models/Ship";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";

export class MarketManager extends Manager {

	doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void {
		this.exploreSystems(bot, waypoint);
	}
	
	exploreSystems(bot: Bot, startingLoc: WaypointBase) {
		if (!this.automationService.agent) {
			return;
		}
		const startingSystemStr = this.automationService.agent.headquarters;
		const startingSystem = this.galaxyService.getSystemBySymbol(startingSystemStr);
		const system = startingSystem;
		if (Ship.containsModule(bot.ship, "MODULE_WARP_DRIVE_")) {
			// we can warp to nearby systems
		} else if (system) {
			const nextSystemSymbol = this.explorationService.exploreSystems(bot.ship);
			if (nextSystemSymbol && nextSystemSymbol != bot.ship.nav.systemSymbol) {
				const jumpgates = this.automationService.jumpgateService.getJumpgatesBySystemSymbol(bot.ship.nav.systemSymbol);
				if (jumpgates && jumpgates.length > 0) {
					const waypoint = this.galaxyService.getWaypointByWaypointSymbol(jumpgates[0].symbol!);
					if (waypoint) {
						bot.navigateTo(waypoint, null,
										`Going to jumpgate at ${waypoint.symbol} to explore system.`);
					}
					bot.jumpTo(nextSystemSymbol);
				}
			}
			// First look for markets we haven't visited in 12 hours or more
			this.exploreMarkets(bot, startingLoc, system, Date.now() - 1000 * 60 * 60 * 12);
			// Then check for markets we haven't visited within the last 30 minutes
			this.exploreMarkets(bot, startingLoc, system, Date.now() - 1000 * 60 * 30);
			// Then check for markets we haven't visited within the last 5 minutes
			this.exploreMarkets(bot, startingLoc, system, Date.now() - 1000 * 60 * 5);
		}
	}
	exploreMarkets(bot: Bot, startingLoc: WaypointBase, system: System, tooOld: number) {
		const marketSymbols = this.marketService.getMarketSymbolsInSystem(system.symbol);
		const marketsToVisit: string[] = [];
		for (let marketSymbol of marketSymbols || []) {
			const lastUpdateDate = this.marketService.lastUpdateDate(marketSymbol);
			if (lastUpdateDate == null || lastUpdateDate.getTime() < tooOld) {
				marketsToVisit.push(marketSymbol);
			}
		}
		const waypointsToVisit = system.waypoints?.filter((wp) => marketsToVisit.includes(wp.symbol));
		if (waypointsToVisit && waypointsToVisit.length > 0) {
			bot.traverseWaypoints(waypointsToVisit, startingLoc, `updating markets`);
		}
	}

}