import { Bot, Role } from "./bot";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";
import { LocXY } from "src/models/LocXY";
import { Survey } from "src/models/Survey";
import { ExplorationService } from "../services/exploration.service";

export class PairManager extends Manager {

	haulerBot: Bot | null = null;
	surveyBot: Bot | null = null;
	minerBots: Bot[] = [];
	role: Role | null = null;
	miningWaypoint: WaypointBase | null = null;
	
	override addBot(bot: Bot): boolean {
		if (bot.role == Role.Hauler && this.haulerBot != null) {
			return false;
		}
		if (bot.role == Role.Surveyor && this.surveyBot != null) {
			return false;
		}
		if (bot.role != Role.Miner &&
		    bot.role != Role.Siphon &&
		    bot.role != Role.Surveyor &&
		    bot.role != Role.Hauler) {
			return false;
		}
		if (bot.role != Role.Hauler && bot.role != Role.Surveyor) {
			if (this.role && bot.role != this.role) {
				return false;
			}
			this.role = bot.role;
		}
		
		if (super.addBot(bot)) {
			if (bot.role == Role.Hauler) {
				this.haulerBot = bot;
			} else if (bot.role == Role.Surveyor) {
				this.surveyBot = bot;
			} else {
				this.minerBots.push(bot);
			}
			return true;
		}
		return false;
	}
	override removeBot(bot: Bot): boolean {
		if (super.removeBot(bot)) {
			const index = this.minerBots.findIndex(b => b.ship.symbol === bot.ship.symbol);
			if (index >= 0) {
				this.minerBots.splice(index, 1);
			}
			if (bot == this.haulerBot) {
				this.haulerBot = null;
			}
			if (bot == this.surveyBot) {
				this.surveyBot = null;
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
		
		const otherShipsAtWaypoint = this.otherShipsAtWaypoint(bot);
		
		let cargoFull = bot.ship.cargo.units === bot.ship.cargo.capacity;
		if (isAsteroid || isDebrisField) {
			if (bot.role == Role.Surveyor) {
				bot.survey();
			}
			let surveys = this.surveyService.getSurveysForWaypoint(waypoint);
			if (surveys.length < 5) {
				bot.survey();
			}
			// If our cargo hold is below half capacity, we should be able
			// to get another load:
			if (!cargoFull) {
				let bestSurvey = this.getBestSurveyToUse(waypoint, surveys);
				bot.mine(bestSurvey);
			}
		}
		if (isGasGiant && !cargoFull) {
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
		
		if (this.miningWaypoint == null) {
			this.getLocationToMine(system, waypoint);
		}
		
		// If the haulerBot is not at the minning site, or needs to go sell stuff,
		// sell everything we have before we return to the mines.
		if (bot == this.haulerBot && 
		    (this.miningWaypoint?.symbol != bot.ship.nav.waypointSymbol || cargoFull)) {
			this.sellAll(bot, waypoint);
		}
		
		if ((!cargoFull || bot.role == Role.Surveyor) &&
		     this.miningWaypoint && this.miningWaypoint.symbol != bot.ship.nav.waypointSymbol) {
			bot.navigateTo(this.miningWaypoint, 'DRIFT', `going to ${this.miningWaypoint.symbol} to mine.`);
		}
	}
	getLocationToMine(system: System, waypoint: WaypointBase) {
		let miningDestinations;
		if (this.role == Role.Miner) {
			miningDestinations = system.waypoints?.filter((way) => WaypointBase.isAsteroid(way)) || [];
		} else if (this.role == Role.Siphon) {
			miningDestinations = system.waypoints?.filter((way) => WaypointBase.isGasGiant(way)) || [];
		} else {
			return;
		}
		const miningDestinationsWithMiners = miningDestinations?.filter((way) => this.minerBots.some(bot => bot.ship.nav.waypointSymbol == way.symbol));
		// TODO: sort these waypoint based on the expected profits from a neaby market
		if (miningDestinationsWithMiners && miningDestinationsWithMiners.length > 0) {
			this.miningWaypoint = miningDestinationsWithMiners[0];
		} else {
			// Go to the nearest mine
			const waypoints = ExplorationService.sortWaypointsByDistanceFrom(miningDestinations, waypoint);
			this.miningWaypoint = waypoints[0];
		}
	}
	scoreWaypoint(waypoint: WaypointBase): number {
		//this.marketService.findBestMarketToSell();
		return 0;
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