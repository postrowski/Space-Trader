import { Bot, Role } from "./bot";
import { Ship } from "src/models/Ship";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";
import { ExplorationService } from "../services/exploration.service";
import { LocXY } from "src/models/LocXY";
import { Survey } from "src/models/Survey";

export class MineManager extends Manager {

	haulerBots: Bot[] = [];
	
	override addBot(bot: Bot): boolean {
		if (super.addBot(bot)) {
			if (bot.role == Role.Hauler) {
				this.haulerBots.push(bot);
			}
			return true;
		}
		return false;
	}
	override removeBot(bot: Bot): boolean {
		if (super.removeBot(bot)) {
			const index = this.haulerBots.findIndex(b => b.ship.symbol === bot.ship.symbol);
			if (index >= 0) {
				this.haulerBots = this.haulerBots.splice(index, 1);
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

		if (bot.role == Role.Refinery) {
			bot.gatherOre(this.shipBots);
			bot.refineAll();
		}
		
		const otherShipsAtWaypoint = this.shipBots.filter((otherBot) => {
			return (bot.ship.symbol != otherBot.ship.symbol) && 
					(otherBot.ship.nav.status !== 'IN_TRANSIT') && 
					(bot.ship.nav.waypointSymbol == otherBot.ship.nav.waypointSymbol);
		});

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
			}
		} else if (bot.ship.cargo.units > 0) {
			this.sellAll(bot, waypoint);
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
	
}