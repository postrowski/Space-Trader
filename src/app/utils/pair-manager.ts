import { Bot, Role } from "./bot";
import { Ship } from "src/models/Ship";
import { WaypointBase } from "src/models/WaypointBase";
import { System } from "src/models/System";
import { Manager } from "./manager";
import { ExplorationService } from "../services/exploration.service";
import { LocXY } from "src/models/LocXY";
import { Survey } from "src/models/Survey";

export class PairManager extends Manager {

	haulerBot: Bot | null = null;
	minerBots: Bot[] = [];
	role: Role | null = null;
	miningWaypoint: WaypointBase | null = null;
	
	override addBot(bot: Bot): boolean {
		if (bot.role == Role.Hauler && this.haulerBot != null) {
			return false;
		}
		if (bot.role != Role.Miner &&
		    bot.role != Role.Siphon &&
		    bot.role != Role.Hauler) {
			return false;
		}
		if (bot.role != Role.Hauler) {
			if (this.role && bot.role != this.role) {
				return false;
			}
			this.role = bot.role;
		}
		
		if (super.addBot(bot)) {
			if (bot.role == Role.Hauler) {
				this.haulerBot = bot;
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
				this.minerBots = this.minerBots.splice(index, 1);
			}
			if (bot == this.haulerBot) {
				this.haulerBot = null;
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

		let cargoFull = bot.ship.cargo.units === bot.ship.cargo.capacity;
		if (isAsteroid || isDebrisField) {
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
			this.getLocationToMine(system);
		}
		
		// If the haulerBot is not at the minning site, or needs to go sell stuff,
		// sell everything we have before we return to the mines.
		if (bot == this.haulerBot && 
		    (this.miningWaypoint?.symbol != bot.ship.nav.waypointSymbol || cargoFull)) {
			this.sellAll(bot, waypoint);
		}
		
		if (!cargoFull && this.miningWaypoint && this.miningWaypoint.symbol != bot.ship.nav.waypointSymbol) {
			bot.navigateTo(this.miningWaypoint, null, `going to ${this.miningWaypoint.symbol} to mine.`);
		}
	}
	getLocationToMine(system: System) {
		let miningDestinations;
		if (this.role == Role.Miner) {
			miningDestinations = system.waypoints?.filter((way) => WaypointBase.isAsteroid(way)) || [];
		} else if (this.role == Role.Siphon) {
			miningDestinations = system.waypoints?.filter((way) => WaypointBase.isGasGiant(way)) || [];
		}
		// TODO: sort these waypoint based ont he expected profits from a neaby market
		if (miningDestinations && miningDestinations.length > 0) {
			this.miningWaypoint = miningDestinations[0];
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