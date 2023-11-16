import { Contract } from "src/models/Contract";
import { LocXY } from "src/models/LocXY";
import { Ship } from "src/models/Ship";
import { ShipCargoItem } from "src/models/ShipCargoItem";
import { Survey } from "src/models/Survey";
import { WaypointBase } from "src/models/WaypointBase";
import { AutomationService, ExecutionStep } from "../services/automation.service";
import { ExplorationService } from "../services/exploration.service";
import { FleetService } from "../services/fleet.service";
import { GalaxyService } from "../services/galaxy.service";
import { ContractService } from "../services/contract.service";
import { MarketService, TradeRoute, UiMarketItem } from "../services/market.service";
import { ConstructionSite } from "src/models/ConstructionSite";
import { ConstructionService } from "../services/construction.service";
import { System } from "src/models/System";
import { Manager } from "./manager";

export enum Role {
	Miner,
	Siphon,
	Explorer,
	Hauler,
	Surveyor,
	SurveyorMiner,
	Refinery
}

export class Bot {
	ship: Ship;
	manager: Manager | null = null;
	automationService: AutomationService;
	role: Role = Role.SurveyorMiner;

    currentStep: ExecutionStep | null = null;
    errorCount = 0;
    fleetService!: FleetService;
	marketService: MarketService;
	galaxyService: GalaxyService;
    explorationService!: ExplorationService;
    
	constructor(ship: Ship,
				automationService: AutomationService) {
		this.ship = ship;
		this.automationService = automationService;
		this.fleetService = this.automationService.fleetService;
		this.galaxyService = this.automationService.galaxyService;
		this.marketService = this.automationService.marketService;
		this.explorationService = this.automationService.explorationService;
		this.determineRole();
	}
	
	determineRole() {
		const hasSensor   = Ship.containsMount( this.ship, 'MOUNT_SENSOR');
		const hasSiphon   = Ship.containsMount( this.ship, 'MOUNT_GAS_SIPHON_');
		const hasMining   = Ship.containsMount( this.ship, 'MOUNT_MINING_LASER');
		const hasRefinery = Ship.containsModule(this.ship, 'MODULE_ORE_REFINERY');
		const hasCargo    = Ship.containsModule(this.ship, 'MODULE_CARGO_HOLD_II');
		if (hasRefinery) {
			this.role = Role.Refinery;
		} else if (hasSensor && hasMining) {
			this.role = Role.SurveyorMiner;
		} else if (hasSensor) {
			this.role = Role.Surveyor;
		} else if (hasCargo) {
			this.role = Role.Hauler;
		} else if (hasSiphon) {
			this.role = Role.Siphon;
		} else if (hasMining) {
			this.role = Role.Miner;
		} else {
			this.role = Role.Explorer;
		}
	}

	setFlightMode(mode: string) {
		if (this.ship.fuel.capacity == 0) {
			// Probes don't use fuel, they don't make use of flight mode
			return;
		}
		if (this.ship.nav.flightMode != mode) {
			this.currentStep = new ExecutionStep(this, `enter flight mode ${mode}`, 'mode');
			this.fleetService.setFlightMode(this.ship.symbol, mode)
			                 .subscribe((response)=>{
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}

	navigateToSystem(systemSymbol: string){
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		if (this.ship.nav.systemSymbol != systemSymbol) {
			const path = this.automationService.jumpgateService.findShortestPath(this.ship.nav.systemSymbol, systemSymbol);
			if (path && path.length > 1) {
				const jumpgates = this.automationService.jumpgateService.getJumpgatesBySystemSymbol(this.ship.nav.systemSymbol);
				if (jumpgates && jumpgates.length > 0) {
					const waypoint = this.galaxyService.getWaypointByWaypointSymbol(jumpgates[0].symbol!);
					if (waypoint) {
						this.navigateTo(waypoint, null, 'Going to jumpgate to leave system.');
					}
					// first element in the path is the starting point, so we travel to the second element:
					this.jumpTo(path[1]);
				}
			}
		}
		console.error(`Can't determine how to get ship ${this.ship.symbol} from ${this.ship.nav.systemSymbol} to system ${systemSymbol}!`);
	}
	navigateTo(waypoint: WaypointBase, flightMode: string | null, reason: string){
		if (this.ship.nav.waypointSymbol == waypoint.symbol) {
			return;
		}
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypoint.symbol);
		if (this.ship.nav.systemSymbol != systemSymbol) {
			this.navigateToSystem(systemSymbol);
			return;
		}
		this.addMessage(reason);
		const fuelPricesByWaypointSymbol = this.marketService.getPricesForItemInSystemByWaypointSymbol(systemSymbol, 'FUEL');
		const hasFuelStation = fuelPricesByWaypointSymbol.has(this.ship.nav.route.destination.symbol);

		const system = this.galaxyService.getSystemBySymbol(systemSymbol);
		let mustDrift = false;
		if (system && system.waypoints && this.ship.fuel.capacity > 0) {
			const currentWaypoints = system.waypoints.filter((way) => way.symbol == this.ship.nav.waypointSymbol);
			if (currentWaypoints && currentWaypoints.length == 1) {
				const currentWaypoint = currentWaypoints[0];
	
				const dist = LocXY.getDistance(currentWaypoint, waypoint);
				mustDrift = dist > (this.ship.fuel.current - 2);
				if (mustDrift && hasFuelStation && dist < this.ship.fuel.capacity - 2) {
					this.refuel(100);
				}
				if (mustDrift) {
					// Try to find an intermediate fuel station:
					const fuelWaypoints = system.waypoints.filter((wp) => fuelPricesByWaypointSymbol.has(wp.symbol));
					let maxRange = this.ship.fuel.current;
					if (hasFuelStation) {
						maxRange = this.ship.fuel.capacity;
					}
					const fuelWaypointsInRange = fuelWaypoints.filter((wp) => LocXY.getDistance(this.ship.nav.route.destination, wp) < maxRange);
					if (fuelWaypointsInRange.length > 0) {
						fuelWaypointsInRange.push(currentWaypoint);
						const fuelStationsNearestToDest = ExplorationService.sortWaypointsByDistanceFrom(fuelWaypointsInRange, waypoint);
						while (fuelStationsNearestToDest.length > 0) {
							const fuelStationNearestToDest = fuelStationsNearestToDest.shift();
							if (fuelStationNearestToDest) {
								// make sure we are actually getting closer to our destination:
								const newDist = LocXY.getDistance(fuelStationNearestToDest, waypoint);
								if (newDist < dist) {
									this.navigateTo(fuelStationNearestToDest, flightMode,
									                `Trying to get to ${waypoint.symbol} (dist: ${dist}) via ${fuelStationNearestToDest.symbol} (dist: ${newDist})`);
								}
							}
						}
					}
				}
			}

			// TODO: get this bestRouteTo working!
			/*				const system = this.galaxyService.getSystemBySymbol(this.ship.nav.waypointSymbol);
							const waypointFrom = this.galaxyService.getWaypointByWaypointSymbol(this.ship.nav.waypointSymbol);
							if (waypointFrom && system) {
								const route = ExplorationService.bestRouteTo(waypointFrom, waypoint, system, this.marketService,
																	this.ship.fuel.current, this.ship.fuel.capacity, 0);
								if (route && route.path.length>0) {
									const waypointTo = this.galaxyService.getWaypointByWaypointSymbol(route.path[0].symbol);
									if (waypointTo) {
										this.navigateTo(waypointTo, flightMode, '?');
									}
								}
							}*/
			this.addMessage(`Couldn't get to ${waypoint.symbol} at (${waypoint.x}, ${waypoint.y}) without drifting!`)
		}
		
		this.orbit();
		if (mustDrift) {
			this.setFlightMode('DRIFT');
		} else if (flightMode) {
			this.setFlightMode(flightMode);
		} else {
			this.setFlightMode('CRUISE');
		}

		this.currentStep = new ExecutionStep(this, `Navigate to ${waypoint.symbol}`, 'nav');
		this.fleetService.navigateShip(this.ship.symbol, waypoint.symbol)
		                 .subscribe((response) => {
			this.completeStep();
		}, (error) => {
			this.onError(error);
		});
		throw this.currentStep;
	}

	jumpTo(waypointSymbol: string){
		if (this.ship.nav.waypointSymbol != waypointSymbol) {
			this.orbit();
			this.currentStep = new ExecutionStep(this, `Jump to ${waypointSymbol}`, 'jump');
			this.fleetService.jumpShip(this.ship.symbol, waypointSymbol)
			                 .subscribe((response)=>{
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	refuel(minPercent: number){
		const currentPercent = 100 * this.ship.fuel.current / this.ship.fuel.capacity;
		if (currentPercent < minPercent) {
			// make sure our current location trades in fuel
			if (!this.marketService.getItemAtMarket(this.ship.nav.waypointSymbol, 'FUEL')) {
				return;
			}
			this.dock();
			this.currentStep = new ExecutionStep(this, `refueling`, 'refuel');
			const units = (this.ship.fuel.capacity - this.ship.fuel.current);
			this.marketService.refuelShip(this.ship.symbol, units)
			                  .subscribe((response)=>{
				this.completeStep();
				this.ship.fuel.update(response.data.fuel);
				this.addMessage(`Bought ${response.data.transaction.units} of FUEL for $-${response.data.transaction.totalPrice} total`);
				this.automationService.refreshMarkets.push(this.ship.nav.waypointSymbol);
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}

	survey() {
		if ((this.ship.cooldown.remainingSeconds === 0) &&
			Ship.containsMount(this.ship, 'MOUNT_SURVEYOR')) {
			this.orbit();
			this.currentStep = new ExecutionStep(this, `Creating survey`, 'survey');
			this.fleetService.createSurvey(this.ship.symbol)
			                 .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	canSellOrJettisonCargo(itemSymbol: string, contract: Contract | null, constructionSite: ConstructionSite | null) {
		// dont jettison anti matter, modules or mounts
		if (itemSymbol.toUpperCase().includes('ANTIMATTER') ||
			itemSymbol.toUpperCase().startsWith('MODULE') ||
			itemSymbol.toUpperCase().startsWith('MOUNT')) {
			return false;
		}
		if (contract != null &&
			ContractService.getContractDeliverable(itemSymbol, contract) != null) {
			return false;
		}
		if (constructionSite != null &&
			ConstructionService.getConstructionMaterial(itemSymbol, constructionSite) != null) {
			return false;
		}
		if (this.currentTradeRoute && this.currentTradeRoute.sellItem.symbol == itemSymbol) {
			return false;
		}
		return true;
	}
	
	jettisonUnsellableCargo(waypoint: WaypointBase, contract: Contract | null, constructionSite: ConstructionSite | null) {
		for (const inv of this.ship.cargo.inventory) {
			if (this.canSellOrJettisonCargo(inv.symbol, contract, constructionSite)) {
				// Assume a full load
				const units = this.ship.cargo.capacity;
				if (this.marketService.findBestMarketToSell(waypoint, inv.symbol, units, 'DRIFT') == null) {
					this.currentStep = new ExecutionStep(this, `Jettisonning ${inv.units} ${inv.symbol}`, 'jett');
					this.fleetService.jettisonCargo(this.ship.symbol, inv.symbol, inv.units)
					                 .subscribe((response) => {
						this.completeStep();
					}, (error) => {
						this.onError(error);
					});
					throw this.currentStep;
				}
			}
		}
	}
	getBestMinerToSupport(waypoint: WaypointBase, travelSpeed: string, system: System,
						  fuelPricesByWaypointSymbol: Map<string, UiMarketItem>, allShips: Bot[]) 
						  : {waypointSymbol: string, sellItem: UiMarketItem, proceeds: number, travelSpeed: string} | null {
		const miners = allShips.filter((bot) => (bot.ship.symbol !== this.ship.symbol) &&
										(bot.ship.nav.status != 'IN_TRASIT') &&
										(bot.role == Role.Miner || bot.role == Role.Siphon));
		const haulers = allShips.filter((bot) => (bot.ship.symbol !== this.ship.symbol) &&
										(bot.role == Role.Hauler));
		const haulerLocations = haulers.map((bot) => bot.ship.nav.waypointSymbol);
		let bestRoute: { market: WaypointBase, sellItem: UiMarketItem, proceeds: number, travelSpeed: string } | null = null;
		let bestWaypointSymbol: string | null = null;
		if (miners && system.waypoints) {
			const localFuelCost = fuelPricesByWaypointSymbol.get(waypoint.symbol);
			for (const miner of miners) {
				const minerWaypoints = system.waypoints.filter((w) => w.symbol == miner.ship.nav.waypointSymbol);
				if (minerWaypoints && minerWaypoints.length == 1) {
					const minerWaypoint = minerWaypoints[0];
					if (haulerLocations.includes(minerWaypoint.symbol) && minerWaypoint.symbol != this.ship.nav.waypointSymbol) {
						// this mining location already has a hauler supporting it, and it's not us.
						continue;
					}
					const dist = LocXY.getDistance(minerWaypoint, waypoint);
					let fuelCost = dist * Math.min(localFuelCost?.purchasePrice || Infinity, this.marketService.getAverageFuelCost(system.symbol));
					if (travelSpeed == 'DRIFT') {
						fuelCost = 1;
					}
					const minedItems: string[] = [];
					if (miner.role == Role.Siphon && WaypointBase.isGasGiant(minerWaypoint)) {
						minedItems.push('LIQUID_HYDROGEN');
						minedItems.push('LIQUID_NITROGEN');
						minedItems.push('HYDROCARBONS');
					} else if (miner.role == Role.Miner && WaypointBase.isAsteroid(minerWaypoint)) {
						minedItems.push('IRON_ORE');
						minedItems.push('COPPER_ORE');
						minedItems.push('ALUMINUM_ORE');
						minedItems.push('QUARTZ_SAND');
						minedItems.push('SILICON_CRYSTALS');
						minedItems.push('AMMONIA_ICE');
					}
					for (const item of minedItems) {
						const route = this.marketService.findBestMarketToSell(minerWaypoint, item, this.ship.cargo.capacity, travelSpeed);
						if (route) {
							route.proceeds -= fuelCost;
							if ((route.proceeds > 0) && (bestRoute == null || route.proceeds > bestRoute.proceeds)) {
								bestRoute = route;
								bestWaypointSymbol = minerWaypoint.symbol;
							}
						}
					}
				}
			}
		}
		if (bestWaypointSymbol && bestRoute) {
			return { waypointSymbol: bestWaypointSymbol, 
					proceeds: bestRoute.proceeds,
					sellItem: bestRoute.sellItem,
					travelSpeed: bestRoute.travelSpeed};
			}
		return null;
	}

	currentTradeRoute: TradeRoute | null = null;
	tradeRouteState = ''; // possible states: '', 'goBuy', 'buy', 'goSell', 'sell'
	
	mine(survey?: Survey) {
		if (this.ship.cooldown.remainingSeconds) {
			return;
		}
		if (!Ship.containsMount(this.ship, 'MOUNT_MINING_LASER')) {
			return;
		}
		this.orbit();
		if (survey) {
			this.currentStep = new ExecutionStep(this, `Extracting resource with survey`, 'xtrct+');
			this.fleetService.extractResourcesWithSurvey(this.ship.symbol, survey)
			                 .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				while (error.error) {
					error = error.error;
				}
				if (error.code === 4224) {
					// Resources have been exhuasted, this should have already been removed.
					//this.surveyService.deleteSurvey(survey!);
					console.log("suvery exhausted");
					this.completeStep();
				} else {
					this.onError(error);
				}
			});
			throw this.currentStep;
		}
		this.currentStep = new ExecutionStep(this, `Extracting resource`, 'xtrct');
		this.fleetService.extractResources(this.ship.symbol)
		                 .subscribe((response) => {
			this.completeStep();
			this.addMessage(`Extracted ${response.data.extraction.yield.units} ${response.data.extraction.yield.symbol}`);
		}, (error) => {
			this.onError(error);
		});
		throw this.currentStep;
	}
	siphon() {
		if (this.ship.cooldown.remainingSeconds) {
			return;
		}
		if (!Ship.containsMount(this.ship, 'MOUNT_GAS_SIPHON')) {
			return;
		}
		this.orbit();
		this.currentStep = new ExecutionStep(this, `Siphoning gas`, 'gas');
		this.fleetService.siphonGas(this.ship.symbol)
		                 .subscribe((response) => {
			this.completeStep();
			this.addMessage(`Siphoned ${response.data.siphon.yield.units} ${response.data.siphon.yield.symbol}`);
		}, (error) => {
			this.onError(error);
		});
		throw this.currentStep;
	}

	getNeededUpgrade(): string | null {
		if (this.ship.frame.mountingPoints <= this.ship.mounts.length) {
			return null;
		}
		// If it has any power available, and a free mounting point, it needs an upgrade
		const powerAvailable = Ship.getPowerAvailable(this.ship);
		const crewAvailable = Ship.getCrewAvailable(this.ship);
		if (this.role == Role.Miner || this.role == Role.SurveyorMiner) {
			if ((this.ship.crew.current) > 0 && (powerAvailable >= 2)) {
				return 'MOUNT_MINING_LASER_II';
			}
			if (powerAvailable >= 1 && crewAvailable >= 1) {
				return 'MOUNT_MINING_LASER_I';
			}
		}
		return null;
	}
	upgradeShip(waypoint: WaypointBase) {
		if (!WaypointBase.hasShipyard(waypoint)) {
			return;
		}
		const mountToInstall = this.getNeededUpgrade();
		if (mountToInstall == null) {
			return;
		}
		const mountInInventory = this.ship.cargo.inventory.some(inv => inv.symbol === mountToInstall);
		if (mountInInventory) {
			this.dock();
			this.currentStep = new ExecutionStep(this, `installing mount ${mountToInstall}`, 'mount');
			this.fleetService.installMount(this.ship.symbol, mountToInstall!)
			                 .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	
	buyItems(itemToBuy: string, quantity: number) {
		// If we already have this amount in our inventory, don't buy any more:
		for (let inv of this.ship.cargo.inventory) {
			if ((inv.symbol === itemToBuy) && (inv.units >= quantity)) {
				return;
			}
		}
		// Only try to buy this if its traded here
		this.purchaseCargo(itemToBuy, quantity);
	}

	findOtherShipInSameLocation(otherBots: Bot[], docked: boolean) : Bot[] {
		const nearbyShips: Bot[] = [];
		for (let otherBot of otherBots) {
			if (otherBot == this ||
				(otherBot.ship.nav.status === 'IN_TRANSIT') ||
				(otherBot.ship.nav.waypointSymbol != this.ship.nav.waypointSymbol)) {
				continue;
			}
			if ((otherBot.ship.nav.status === 'DOCKED') === docked) {
				nearbyShips.push(otherBot);
			}
		}
		return nearbyShips;
	}
	consolidateCargo(otherBotsAtWaypoint: Bot[]) {
		if (this.ship.nav.status === 'IN_TRANSIT') {
			return
		}
		const shipsWithSpace = otherBotsAtWaypoint.filter((bot) => bot.ship.cargo.capacity > bot.ship.cargo.units);
		for (let inv of this.ship.cargo.inventory) {
			// First check if there are refinery ships nearby:
			if (inv.symbol.endsWith("_ORE")) {
				for (let otherBot of shipsWithSpace) {
					if (otherBot.role == Role.Refinery) {
						this.transferCargo(otherBot, inv);
					}
				}
			}
			const shipsWithSameItem = shipsWithSpace.filter((bot) => bot.ship.cargo.inventory.some((i) => i.symbol == inv.symbol));
			const biggerShipsWithSameItem = shipsWithSameItem.filter((bot) => bot.ship.cargo.capacity > this.ship.cargo.capacity);
			const similarShipsWithSameItem = shipsWithSameItem.filter((bot) => bot.ship.cargo.capacity == this.ship.cargo.capacity);
			const biggerShips = shipsWithSpace.filter((bot) => bot.ship.cargo.capacity > this.ship.cargo.capacity);
			// Next, look for a bigger ship that already has some of the items we are transferring.
			// Then look for a similar-sized ship that already has some of the items we are transferring.
			// If we couldn't find a ship with the same item, just transfer to any bigger ship.
			for (const bots of [biggerShipsWithSameItem, similarShipsWithSameItem, biggerShips]) {
				// First try to find a ship to which we can transfer everything
				for (let otherBot of bots) {
					if (otherBot.ship.cargo.capacity - otherBot.ship.cargo.units > inv.units) {
						this.transferCargo(otherBot, inv);
					}
				}
				// If we can't transfer everything, maybe we can transfer some of our stuff?
				for (let otherBot of bots) {
					this.transferCargo(otherBot, inv);
				}
			}
		}
	}
	sellAll(waypoint: WaypointBase, contract: Contract | null, constructionSite: ConstructionSite | null, otherBotsAtWaypoint: Bot[]) {
		if (this.ship.nav.status === 'IN_TRANSIT') {
			return
		}
		this.consolidateCargo(otherBotsAtWaypoint);
		for (let inv of this.ship.cargo.inventory) {
			// dont sell trade route items unless we are at the destination market
			if (this.currentTradeRoute && 
			    this.currentTradeRoute.sellItem.symbol === inv.symbol &&
			    this.currentTradeRoute.sellItem.marketSymbol !== waypoint.symbol) {
				continue;
			}
			// dont sell anti matter, exotic matter or mounts
			if (!this.canSellOrJettisonCargo(inv.symbol, contract, constructionSite) || (inv.units <= 0)) {
				continue;
			}
			let bestMarket = this.marketService.findBestMarketToSell(waypoint, inv.symbol, inv.units, 'CRUISE');
			if (bestMarket == null) {
				bestMarket = this.marketService.findBestMarketToSell(waypoint, inv.symbol, inv.units, 'DRIFT');
			}
			// make sure this market is the best place to sell this item.
			if (bestMarket?.market.symbol == waypoint.symbol) {
				this.addMessage(`market ${waypoint.symbol} identified as best place to sell ${inv.symbol}.`);
				this.sellCargo(inv.symbol, inv.units);
			}
		}
	}
	sellAtBestLocation(waypoint: WaypointBase, contract: Contract | null,
	                   constructionSite: ConstructionSite | null, otherBotsAtWaypoint: Bot[]) {
		if (this.ship.nav.status === 'IN_TRANSIT') {
			return
		}
		// Sell anything we can sell at our current location:
		this.sellAll(waypoint, contract, constructionSite, otherBotsAtWaypoint);
		const marketsToCruiseTo: WaypointBase[] = [];
		const marketsToDriftTo: WaypointBase[] = [];
		for (let inv of this.ship.cargo.inventory) {
			// dont sell trade route items unless we are at the destination market
			if (this.currentTradeRoute && 
			    this.currentTradeRoute.sellItem.symbol === inv.symbol &&
			    this.currentTradeRoute.sellItem.marketSymbol !== waypoint.symbol) {
				continue;
			}
			// dont sell anti matter, exotic matter or mounts
			if (!this.canSellOrJettisonCargo(inv.symbol, contract, constructionSite) || (inv.units <= 0)) {
				continue;
			}
			// make sure this market is the best place to sell this item.
			let market = this.marketService.findBestMarketToSell(waypoint, inv.symbol, inv.units, 'CRUISE');
			if (market) {
				marketsToCruiseTo.push(market.market);
			} else {
				market = this.marketService.findBestMarketToSell(waypoint, inv.symbol, inv.units, 'DRIFT');
				if (market) {
					marketsToDriftTo.push(market.market);
				}
			}
		}
		if (marketsToCruiseTo.length > 0) {
			const waypoints = ExplorationService.sortWaypointsByDistanceFrom(marketsToCruiseTo, waypoint);
			this.navigateTo(waypoints[0], 'CRUISE', `going to market ${waypoints[0].symbol} to sell items`);
		}
		if (marketsToDriftTo.length > 0) {
			const waypoints = ExplorationService.sortWaypointsByDistanceFrom(marketsToDriftTo, waypoint);
			this.navigateTo(waypoints[0], 'DRIFT', `drifting to market ${waypoints[0].symbol} to sell items`);
		}
	}
	deliverAll(contract: Contract | null, constructionSite: ConstructionSite | null) {
		if (this.ship.nav.status === 'IN_TRANSIT' || this.ship.cargo.units === 0 || (!contract && !constructionSite)) {
			return;
		}
		for (let inv of this.ship.cargo.inventory) {
			if (inv.units <= 0) {
				continue;
			}
			let destinationSymbol: string | null = null;
			let destinationType = '';
			let unitsRequired = 0;
			const contractDeliverable = contract ? ContractService.getContractDeliverable(inv.symbol, contract) : null;
			if (contractDeliverable) {
				destinationSymbol = contractDeliverable.destinationSymbol;
				unitsRequired = contractDeliverable.unitsRequired - contractDeliverable.unitsFulfilled;
				destinationType = 'contract';
			} else if (constructionSite) {
				const constructionMaterial = ConstructionService.getConstructionMaterial(inv.symbol, constructionSite);
				if (!constructionMaterial) {
					continue;
				}
				unitsRequired = constructionMaterial.required - constructionMaterial.fulfilled;
				destinationSymbol = constructionSite.symbol;
				destinationType = 'construction site';
			}
			
			if (this.ship.nav.waypointSymbol === destinationSymbol) {
				const units = Math.min(unitsRequired, inv.units);
				this.deliverCargo(inv.symbol, units);
				this.supplyConstructionSite(inv.symbol, units);
			} else if (this.ship.cargo.capacity == this.ship.cargo.units || inv.units >= unitsRequired) {
				// We have a full cargo load, or all the parts we need, go to that delivery location
				const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(destinationSymbol!);
				const system = this.automationService.systemsBySymbol.get(systemSymbol);
				if (system) {
					const waypoint = system?.waypoints?.find((waypoint) => waypoint.symbol === destinationSymbol) || null;
					if (waypoint) {
						this.navigateTo(waypoint, null,
										`going to ${waypoint.symbol} to deliver ${inv.symbol} ${inv.units} for ${destinationType}`);
					}
				}
			}
		}
	}
	sellCargo(itemSymbol: string, units: number) {
		this.dock();
		const item = this.marketService.getItemAtMarket(this.ship.nav.waypointSymbol, itemSymbol);
		if (item) {
			let message = null; 
			if (units > item.tradeVolume) {
				units = item.tradeVolume;
				message = `Can only a sell maximum of ${units} ${itemSymbol}`;
			}
			if (units <= 0) {
				return;
			}
			if (message) {
				this.addMessage(message);
			}
			this.currentStep = new ExecutionStep(this, `sell ${units} units of ${itemSymbol}`, 'sell');
			this.marketService.sellCargo(this.ship.symbol, itemSymbol, units)
			                  .subscribe((response) => {
				this.completeStep();
				this.addMessage(`Sold ${units} of ${itemSymbol} for $${response.data.transaction.totalPrice} total`);
				this.automationService.refreshMarkets.push(this.ship.nav.waypointSymbol);
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	
	transferCargo(otherBot: Bot, inv:ShipCargoItem) {
		let freeSpace = otherBot.ship.cargo.capacity - otherBot.ship.cargo.units;
		if (freeSpace > 0) {
			if (this.ship.nav.status != otherBot.ship.nav.status) {
				if (otherBot.ship.nav.status == 'IN_ORBIT') {
					this.orbit();
				} else if (otherBot.ship.nav.status == 'DOCKED') {
					this.dock();
				}
			}
			otherBot.addMessage(`recieving transfer of ${inv.units} units of ${inv.symbol} from ${this.ship.symbol}`);
			this.currentStep = new ExecutionStep(this, `transfer ${inv.units} units of ${inv.symbol} to ${otherBot.ship.symbol}`, 'xfer');
			this.fleetService.transferCargo(this.ship.symbol, otherBot.ship.symbol, inv.symbol, Math.min(freeSpace, inv.units))
				             .subscribe((response) => {
					this.completeStep();
				}, (error) => {
					this.onError(error);
				});
			throw this.currentStep;
		}
	}

	deliverCargo(tradeSymbol: string, units: number) {
		const contract = this.automationService.contract;
		if (contract && contract.terms.deliver.some((goods)=> goods.destinationSymbol == this.ship.nav.waypointSymbol)) {
			this.dock();
			this.currentStep = new ExecutionStep(this, `deliver Contract Goods: ${units} of ${tradeSymbol}`, 'delvr');
			this.automationService.contractService.deliverCargo(contract.id, this.ship.symbol, tradeSymbol, units)
			                                      .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	supplyConstructionSite(tradeSymbol: string, units: number) {
		const site = this.automationService.constructionSite;
		if (site && site.symbol == this.ship.nav.waypointSymbol) {
			this.dock();
			this.currentStep = new ExecutionStep(this, `deliver Construction Materials: ${units} of ${tradeSymbol}`, 'Delvr');
			this.automationService.constructionService.supplyConstructionSite(site.symbol, this.ship.symbol,
																			  tradeSymbol, units)
			    									  .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	gatherOre(otherBots: Bot[]) {
		for (let otherBot of otherBots) {
			if (otherBot.ship.nav.waypointSymbol == this.ship.nav.waypointSymbol) {
				if (otherBot.ship.nav.status == this.ship.nav.status) {
					for (let inv of otherBot.ship.cargo.inventory) {
						if (inv.symbol.endsWith("_ORE")) {
							otherBot.transferCargo(this, inv);
						}
					}
				}
			}
		}
	}
	purchaseCargo(itemSymbol: string, units: number) {
		const item = this.marketService.getItemAtMarket(this.ship.nav.waypointSymbol, itemSymbol);
		if (item) {
			let message = null; 
			if (units > (this.ship.cargo.capacity - this.ship.cargo.units)) {
				units = this.ship.cargo.capacity - this.ship.cargo.units;
				message = `Ship only has room for ${units} of ${itemSymbol}`;
			}
			if (units > item.tradeVolume) {
				units = item.tradeVolume;
				message = `Can only a buy maximum of ${units} ${itemSymbol}`;
			}
			if (this.automationService.agent && 
			    (this.automationService.agent.credits < item.purchasePrice * units)) {
				// we don't have enough money to buy this much
				units = Math.floor(this.automationService.agent.credits / item.purchasePrice);
				message = `Can only afford to buy ${units} ${itemSymbol}`;
			}
			if (units <= 0) {
				return;
			}
			if (message) {
				this.addMessage(message);
			}
			this.dock();
			this.currentStep = new ExecutionStep(this, `buying ${units} of ${itemSymbol}`, 'buy');
			this.marketService.purchaseCargo(this.ship.symbol, itemSymbol, units)
			                  .subscribe((response) => {
				this.completeStep();
				this.addMessage(`Bought ${units} of ${itemSymbol} for $-${response.data.transaction.totalPrice} total`);
				this.automationService.refreshMarkets.push(this.ship.nav.waypointSymbol);
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}

	refineAll() {
		if (Ship.containsModule(this.ship, 'MODULE_ORE_REFINERY') && 
		    this.ship.cooldown.remainingSeconds === 0) {
			for (let inv of this.ship.cargo.inventory) {
				if (inv.symbol.endsWith("_ORE") && inv.units >= 30) {
					this.refine(inv.symbol.slice(0, -"_ORE".length));
				}
			}
		}
	}
	refine(productionType: string) {
		if (Ship.containsModule(this.ship, 'MODULE_ORE_REFINERY') && 
		    this.ship.cooldown.remainingSeconds === 0) {
			this.currentStep = new ExecutionStep(this, `refining ${productionType}`, 'refine');
			this.fleetService.shipRefine(this.ship.symbol, productionType)
			                 .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	chart(waypoint: WaypointBase) {
		if (this.ship.cooldown.remainingSeconds === 0) {
			this.currentStep = new ExecutionStep(this, `charting`, 'chart');
			this.fleetService.createChart(this.ship.symbol)
			                 .subscribe((response) => {
				this.completeStep();
				waypoint.traits = response.data.waypoint.traits;
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	dock() {
		if (this.ship.nav.status === 'IN_ORBIT') {
			this.currentStep = new ExecutionStep(this, `docking`, 'dock');
			this.fleetService.dockShip(this.ship.symbol)
			                 .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	orbit() {
		if (this.ship.nav.status === 'DOCKED') {
			this.currentStep = new ExecutionStep(this, `orbiting`, 'orbit');
			this.fleetService.orbitShip(this.ship.symbol)
			                 .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}

	negotiateContract() {
		if (this.ship.nav.status == 'DOCKED') {
			this.currentStep = new ExecutionStep(this, `Negotiating contract`, 'negot');
			this.automationService.contractService.negotiateContract(this.ship.symbol)
			                                      .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}

	getMarket(waypoint: WaypointBase) {
		if (!WaypointBase.hasMarketplace(waypoint) || 
		    (this.ship.nav.status == 'IN_TRANSIT')) {
			return;
		}
		const waypointSymbol = this.ship.nav.waypointSymbol;
		if (waypointSymbol == waypoint.symbol) {
			if (!this.marketService.hasPriceData(waypoint.symbol)) {
				const step = new ExecutionStep(this, `getting market ${waypoint.symbol}`, 'market');
				this.marketService.getMarketplace(waypoint.symbol, true)
				                  .subscribe((response) => {
					this.completeStep();
				}, (error) => {
					this.onError(error);
				});
				throw step;
			}
		}
	}
	getMarketplaceForced() {
		if (this.ship.nav.status != 'IN_TRANSIT') {
			const waypointSymbol = this.ship.nav.waypointSymbol;
			const step = new ExecutionStep(this, `getting market refresh ${waypointSymbol}`, 'Market');
			this.marketService.getMarketplaceForced(waypointSymbol)
			                  .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw step;
		}
	}


	traverseWaypoints(waypoints: WaypointBase[], startingLoc: WaypointBase, reason: string) {
		if (waypoints.length == 1) {
			this.navigateTo(waypoints[0], null, `Going to ${waypoints[0].symbol}: ${reason}`);
		}
		const loc = ExplorationService.organizeRoute(waypoints, startingLoc);
		if (loc) {
			this.navigateTo(loc, null, `Going to ${loc.symbol}: ${reason}`);
		}
	}
	
	onError(error: any) {
		while (error.error) {
			error = error.error;
		}
		const message = error.message.toLowerCase();
		if (message.includes("insufficient funds")) {
			this.automationService.refreshAgent = true;
		}
		if (message.includes("ship is not currently ")) { // "...in orbit" or "...docked"
			this.automationService.refreshShips = this.ship.symbol;
		}
		if (message.includes("cargo does not contain")) {// "Failed to update ship cargo. Ship BLACKRAT-1 cargo does not contain 35 unit(s) of PLATINUM. Ship has 0 unit(s) of PLATINUM."
			this.automationService.refreshShips = this.ship.symbol;
		}
		if (message.includes("ship is currently ")) { // "ship is currently in-transit...
			this.automationService.refreshShips = this.ship.symbol;
		}
		if (message.includes("ship action is still on cooldown")) { // "...in orbit" or "...docked"
			this.ship.cooldown = error.data.cooldown;
		}
		const waypointCharted = "waypoint already charted: ";
		if (message.startsWith(waypointCharted)) {
			this.automationService.refreshWaypoints = message.slice(waypointCharted.length);
		}
		this.addMessage("Error condition! " + message);
		this.completeStep();
		// We add two to the errorCount, because the call to completeStep decrements by 1, and we need to overcome that
		this.errorCount += 2; 
		if (this.errorCount > 10) {
			this.addMessage("10 consecutive Error conditions! stopping.");
			this.automationService.stop();
		}
	}
	completeStep() {
		this.errorCount = Math.max(0, this.errorCount - 1);
		if (this.currentStep) {
			this.automationService.completeStep(this.currentStep);
			this.currentStep = null;
		}
	}
	addMessage(message: string) {
		this.automationService.addMessage(this.ship, message);
	}
}
