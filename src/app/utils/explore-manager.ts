import { Bot, Role } from "./bot";
import { Ship } from "src/models/Ship";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";
import { ExplorationService } from "../services/exploration.service";
import { GalaxyService } from "../services/galaxy.service";

export class ExploreManager extends Manager {

	override addBot(bot: Bot): boolean {
		if (super.addBot(bot)) {
			return true;
		}
		return false;
	}
	override removeBot(bot: Bot): boolean {
		if (super.removeBot(bot)) {
			return true;
		}
		return false;
	}
	
	doStep(bot: Bot, system: System, waypoint: WaypointBase, credits: number): void {

		const hasMarketplace = WaypointBase.hasMarketplace(waypoint);
		const waypointsToExplore = Manager.waypointsToExploreBySystemSymbol.get(system.symbol);
		if (hasMarketplace) {
			// When we are exploring, always keep as full a fuel tank as possible,
			bot.refuel(95);
		}
		if (waypointsToExplore && waypointsToExplore.length > 0) {
			// check to see which waypoints have ships already in-route or present:
			for (const bot of this.automationService.shipBots) {
				const index = waypointsToExplore.findIndex((way)=> way.symbol == bot.ship.nav.waypointSymbol);
				if (index !== -1) {
					waypointsToExplore.splice(index, 1);
				}
			}
			if (waypointsToExplore && waypointsToExplore.length > 0) {
				// Navigate to the next waypoint that needs to be explored:
				const loc = bot.traverseWaypoints(waypointsToExplore, waypoint, "exploring");
			}
		}
		
		const waypointSymbol = this.explorationService.exploreSystems(bot.ship);
		if (waypointSymbol) {
			if (GalaxyService.getSystemSymbolFromWaypointSymbol(waypointSymbol) != bot.ship.nav.systemSymbol) {
				// need to jump to this next system:
				bot.jumpTo(waypointSymbol);
			}
			// travel to the next location, this could be a jumpgate to get to the next system:
			const waypointDest = this.galaxyService.getWaypointByWaypointSymbol(waypointSymbol);
			if (waypointDest) {
				const loc = bot.navigateTo(waypointDest, "CRUISE", "exploring");
			}
		}
	}
}