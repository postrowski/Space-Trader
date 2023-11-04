import { Contract } from "src/models/Contract";
import { LocXY } from "src/models/LocXY";
import { Ship } from "src/models/Ship";
import { ShipCargoItem } from "src/models/ShipCargoItem";
import { Survey } from "src/models/Survey";
import { WaypointBase } from "src/models/WaypointBase";
import { AutomationService } from "../services/automation.service";
import { ExplorationService } from "../services/exploration.service";
import { FleetService } from "../services/fleet.service";
import { GalaxyService } from "../services/galaxy.service";
import { ContractService } from "../services/contract.service";
import { MarketService, TradeRoute, UiMarketItem } from "../services/market.service";
import { ConstructionSite } from "src/models/ConstructionSite";
import { ConstructionService } from "../services/construction.service";

export enum Role {
	Miner,
	Explorer,
	Hauler,
	Surveyor,
	SurveyorMiner,
	Refinery
}

export class Bot {
	ship: Ship;
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
		const hasMining   = Ship.containsMount( this.ship, 'MOUNT_MINING_LASER');
		const hasRefinery = Ship.containsModule(this.ship, 'MODULE_ORE_REFINERY');
		const hasCargo    = Ship.containsModule(this.ship, 'MODULE_CARGO_HOLD_I');
		if (hasRefinery) {
			this.role = Role.Refinery;
		} else if (hasSensor && hasMining) {
			this.role = Role.SurveyorMiner;
		} else if (hasSensor) {
			this.role = Role.Surveyor;
		} else if (hasMining) {
			this.role = Role.Miner;
		} else if (hasCargo) {
			this.role = Role.Hauler;
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
			this.currentStep = new ExecutionStep(this, `enter flight mode ${mode}`);
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
						this.navigateTo(waypoint);
					}
					// first element in the path is the starting point, so we travel to the second element:
					this.jumpTo(path[1]);
				}
			}
		}
		console.error(`Can't determine how to get ship ${this.ship.symbol} from ${this.ship.nav.systemSymbol} to system ${systemSymbol}!`);
	}
	navigateTo(waypoint: WaypointBase){
		if (this.ship.nav.waypointSymbol == waypoint.symbol) {
			return;
		}
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypoint.symbol);
		if (this.ship.nav.systemSymbol != systemSymbol) {
			this.navigateToSystem(systemSymbol);
			return;
		}
		const fuelPricesByWaypointSymbol = this.marketService.getPricesForItemInSystemByWaypointSymbol(systemSymbol, 'FUEL');
		const hasFuelStation = fuelPricesByWaypointSymbol.has(this.ship.nav.route.destination.symbol);

		const dist = LocXY.getDistance(this.ship.nav.route.destination, waypoint);
		let mustDrift = dist > (this.ship.fuel.current - 2);
		if (mustDrift && hasFuelStation && dist < this.ship.fuel.capacity - 2) {
			this.refuel(100);
		}
		if (mustDrift) {
			// Try to find an intermediate fuel station:
			const system = this.galaxyService.getSystemBySymbol(systemSymbol);
			if (system && system.waypoints) {
				const fuelWaypoints = system.waypoints.filter((wp) => fuelPricesByWaypointSymbol.has(wp.symbol));
				let maxRange = this.ship.fuel.current;
				if (hasFuelStation) {
					maxRange = this.ship.fuel.capacity;
				}
				const fuelWaypointsInRange = fuelWaypoints.filter((wp) => LocXY.getDistance(this.ship.nav.route.destination, wp) < maxRange);
				if (fuelWaypointsInRange.length > 0) {
					const fuelStationsNearestToDest = ExplorationService.sortWaypointsByDistanceFrom(fuelWaypointsInRange, waypoint);
					while (fuelStationsNearestToDest.length > 0) {
						const fuelStationNearestToDest = fuelStationsNearestToDest.shift();
						if (fuelStationNearestToDest && fuelStationNearestToDest.symbol != waypoint.symbol) {
							this.navigateTo(fuelStationNearestToDest);
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
										this.navigateTo(waypointTo);
									}
								}
							}*/
			console.error(`Couldn't get to ${waypoint.symbol} at (${waypoint.x}, ${waypoint.y}) without drifting!`)
		}
		
		this.orbit();
		this.setFlightMode(mustDrift ? 'DRIFT' : 'CRUISE');

		this.currentStep = new ExecutionStep(this, `Navigate to ${waypoint.symbol}`);
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
			this.currentStep = new ExecutionStep(this, `Jump to ${waypointSymbol}`);
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
			this.currentStep = new ExecutionStep(this, `refueling`);
			const units = (this.ship.fuel.capacity - this.ship.fuel.current);
			this.marketService.refuelShip(this.ship.symbol, units)
			                  .subscribe((response)=>{
				this.completeStep();
				this.ship.fuel.update(response.data.fuel);
				this.addMessage(`Bought ${units} of FUEL for $-${response.data.transaction.totalPrice} total`);
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
			this.currentStep = new ExecutionStep(this, `Creating survey`);
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
		return true;
	}
	
	jettisonUnsellableCargo(waypoint: WaypointBase, contract: Contract | null, constructionSite: ConstructionSite | null) {
		for (const inv of this.ship.cargo.inventory) {
			if (this.canSellOrJettisonCargo(inv.symbol, contract, constructionSite)) {
				// Assume a full load
				const units = this.ship.cargo.capacity;
				if (this.marketService.findBestMarketToSell(waypoint, inv.symbol, units) == null) {
					this.currentStep = new ExecutionStep(this, `Jettisonning ${inv.units} ${inv.symbol}`);
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
	currentTradeRoute: TradeRoute | null = null;
	tradeRouteState = ''; // possible states: '', 'goBuy', 'buy', 'goSell', 'sell'
	trade(waypoint: WaypointBase, contract: Contract | null, constructionSite: ConstructionSite | null, creditsAvailable: number) {
		const system = this.galaxyService.getSystemBySymbol(waypoint.symbol);
		if (!system || !system.waypoints) {
			return;
		}
		const space = this.ship.cargo.capacity - this.ship.cargo.units;
		if (this.currentTradeRoute == null) {
			if (space > 0) {
				const excludedTradeItems = new Set<string>();
				// avoid creating trade route for items we need to do construction on contract jobs:
				if (contract) {
					for (let deliverable of contract.terms.deliver) {
						excludedTradeItems.add(deliverable.tradeSymbol);
					}
				}
				if (constructionSite) {
					for (let material of constructionSite.materials) {
						excludedTradeItems.add(material.tradeSymbol);
					}
				}
				// always start our current waypoint, and then skip it when we iterate over the waypoints later.
				let bestRoute = this.marketService.getBestTradeRoutesFrom(waypoint, this.ship.cargo.capacity, creditsAvailable, excludedTradeItems);
				const localWaypoints = system.waypoints.filter((wp) => wp.x == waypoint.x && wp.y == waypoint.y);
				if (localWaypoints) {
					for (const way of localWaypoints) {
						if (way.symbol != waypoint.symbol) {
							const bestRouteWay = this.marketService.getBestTradeRoutesFrom(way, this.ship.cargo.capacity, creditsAvailable, excludedTradeItems);
							if ((bestRouteWay?.profit || 0) > (bestRoute?.profit || 0)) {
								bestRoute = bestRouteWay;
							}
						}
					}
				}
				const nonLocalWaypoints = system.waypoints.filter((wp) => wp.x != waypoint.x || wp.y != waypoint.y);
				if (nonLocalWaypoints) {
					const fuelPricesByWaypointSymbol = this.marketService.getPricesForItemInSystemByWaypointSymbol(system.symbol, 'FUEL');
					const localFuelCost = fuelPricesByWaypointSymbol.get(waypoint.symbol);
					for (const way of nonLocalWaypoints) {
						const destFuelCost = fuelPricesByWaypointSymbol.get(waypoint.symbol);
						const dist = LocXY.getDistance(way, waypoint);
						const fuelCost = dist * Math.min(localFuelCost?.purchasePrice || Infinity, destFuelCost?.purchasePrice || Infinity);
						if (way.symbol != waypoint.symbol) {
							const bestRouteWay = this.marketService.getBestTradeRoutesFrom(way, this.ship.cargo.capacity, creditsAvailable, excludedTradeItems);
							if (bestRouteWay) {
								bestRouteWay.profit -= fuelCost;
								if (bestRoute == null || bestRouteWay.profit > bestRoute.profit) {
									if (bestRouteWay.profit>0) {
										bestRoute = bestRouteWay;
									}
								}
							}
						}
					}
				}
				if (bestRoute) {
					this.addMessage(`Creating trade route, trading ${bestRoute.buyItem.symbol} from ${bestRoute.buyItem.marketSymbol} at $${bestRoute.buyItem.purchasePrice} to ${bestRoute.sellItem.marketSymbol} at $${bestRoute.sellItem.sellPrice}, for a profit of ${bestRoute.profit}`);
				}
				this.currentTradeRoute = bestRoute;
				this.tradeRouteState = 'goBuy';
			} else {
				// We don't have a trade route, but we have no space to buy anything new.
				// Figure out where to sell what we have.
				let inventory = [...this.ship.cargo.inventory];
				inventory = inventory.filter((inv) => this.canSellOrJettisonCargo(inv.symbol, contract, constructionSite));
				if (inventory.length > 0) {
					inventory.sort((i1, i2) => {
						if (i1.units < i2.units) return -1;
						if (i1.units > i2.units) return 1;
						return 0;
					});
					const mostPopulousItem = inventory[inventory.length-1];
					const destMarket: {market: WaypointBase, sellItem: UiMarketItem, proceeds: number} | null = 
										 this.marketService.findBestMarketToSell(waypoint,
																				 mostPopulousItem.symbol,
																				 mostPopulousItem.units);
					if (destMarket) {
						this.addMessage(`Going to ${destMarket.market.symbol} to sell trade item ${mostPopulousItem.symbol} for $${destMarket.proceeds}`);
						this.navigateTo(destMarket.market);
					}
				}
			}
		}
		if (!this.currentTradeRoute) {
			return;
		}
		
		if (this.tradeRouteState == 'goBuy') {
			if (this.currentTradeRoute.buyItem.marketSymbol == waypoint.symbol) {
				this.tradeRouteState = 'buy';
			} else {
				// go to the 'buy' location
				const market = system.waypoints.find((wp) => wp.symbol == this.currentTradeRoute!.buyItem.marketSymbol);
				if (market && market.symbol !== waypoint.symbol) {
					this.addMessage(`Going to ${market.symbol} to buy trade item ${this.currentTradeRoute.buyItem.symbol} for $${this.currentTradeRoute.profit}`);
					this.navigateTo(market);
				}
			}
		}
		if (this.tradeRouteState == 'buy') {
			// We are at the 'buy' location, buy until we have no room or money, and then go to the 'sell' location
			if (space == 0) {
				this.tradeRouteState = 'goSell';
			} else {
				const currentItem = this.marketService.getItemAtMarket(this.currentTradeRoute.buyItem.marketSymbol, this.currentTradeRoute.buyItem.symbol);
				// make sure the item purchase price is still cheaper than the sell price
				if (currentItem && (currentItem.purchasePrice < this.currentTradeRoute.sellItem.sellPrice)) {
					this.purchaseCargo(this.currentTradeRoute.buyItem.symbol, space);
				} else {
					this.addMessage(`Costs of trade item ${this.currentTradeRoute.buyItem.symbol} at ${this.currentTradeRoute.buyItem.marketSymbol} have changed from ${this.currentTradeRoute.buyItem.purchasePrice} to ${currentItem?.purchasePrice}, which exceeds the current sell price of $${this.currentTradeRoute.sellItem.sellPrice}, aborting trade route!`);
					this.tradeRouteState = 'goSell';
				}
			}
		}
		if (this.tradeRouteState == 'goSell') {
			if (this.currentTradeRoute.sellItem.marketSymbol == waypoint.symbol) {
				this.tradeRouteState = 'sell';
			} else {
				// go to the 'sell' location
				const market = system.waypoints.find((wp) => wp.symbol == this.currentTradeRoute!.sellItem.marketSymbol);
				if (market && market.symbol !== waypoint.symbol) {
					this.addMessage(`Going to ${this.currentTradeRoute.sellItem.marketSymbol} to sell trade item ${this.currentTradeRoute.sellItem.symbol} for $${this.currentTradeRoute.profit}`);
					this.navigateTo(market);
				}
			}
		}
		if (this.tradeRouteState == 'sell') {
			// We are at the 'sell' location.
			let invItems = this.ship.cargo.inventory.filter((inv) => inv.symbol == this.currentTradeRoute?.sellItem.symbol);
			if (!invItems || invItems.length == 0) {
				this.currentTradeRoute = null;
				this.tradeRouteState = '';
			} else {
				this.sellCargo(this.currentTradeRoute.sellItem.symbol, invItems[0].units);
			}
		}
	}

	mine(survey?: Survey) {
		if (this.ship.cooldown.remainingSeconds) {
			return;
		}
		if (!Ship.containsMount(this.ship, 'MOUNT_MINING_LASER')) {
			return;
		}
		this.orbit();
		if (survey) {
			this.currentStep = new ExecutionStep(this, `Extracting resource with survey`);
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
		this.currentStep = new ExecutionStep(this, `Extracting resource`);
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
		this.currentStep = new ExecutionStep(this, `Siphoning gas`);
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
			this.currentStep = new ExecutionStep(this, `installing mount ${mountToInstall}`);
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

	findOtherShipInSameLocation(otherShips: Bot[], docked: boolean) : Bot[] {
		const nearbyShips: Bot[] = [];
		for (let otherShip of otherShips) {
			if (otherShip == this ||
				(otherShip.ship.nav.status === 'IN_TRANSIT') ||
				(otherShip.ship.nav.waypointSymbol != this.ship.nav.waypointSymbol)) {
				continue;
			}
			if ((otherShip.ship.nav.status === 'DOCKED') === docked) {
				nearbyShips.push(otherShip);
			}
		}
		return nearbyShips;
	}
	sellAll(waypoint: WaypointBase, contract: Contract | null, constructionSite: ConstructionSite | null, otherShips: Bot[]) {
		if (this.ship.nav.status === 'IN_TRANSIT') {
			return
		}
		if (this.ship.cargo.units === 0) {
			return;
		}
		for (let inv of this.ship.cargo.inventory) {
			// dont sell anti matter, exotic matter or mounts
			if (!this.canSellOrJettisonCargo(inv.symbol, contract, constructionSite)) {
				continue;
			}
			if (inv.units <= 0) {
				continue;
			}
			const contractDeliverable = contract && ContractService.getContractDeliverable(inv.symbol, contract);
			const constructionMaterial = constructionSite && ConstructionService.getConstructionMaterial(inv.symbol, constructionSite);
			if (contractDeliverable || constructionMaterial) {
				for (let otherShip of otherShips) {
					if (otherShip == this ||
					    (otherShip.ship.nav.status === 'IN_TRANSIT') || 
					    (otherShip.ship.nav.waypointSymbol != this.ship.nav.waypointSymbol)) {
						continue;
					}
					if (this.ship.engine.speed < otherShip.ship.engine.speed) {
						this.transferCargo(otherShip.ship, inv);
					}
				}
				continue;
			}
			// Check if there are refinery ships nearby:
			if (inv.symbol.endsWith("_ORE")) {
				let found = false;
				for (let otherShip of otherShips) {
					if (otherShip.ship.nav.waypointSymbol == this.ship.nav.waypointSymbol) {
						if (otherShip.role == Role.Refinery) {
							this.transferCargo(otherShip.ship, inv);
							found = true;
						}
					}
				}
				if (found) {
					break;
				}
			}
			const bestMarket = this.marketService.findBestMarketToSell(waypoint, inv.symbol, inv.units);
			// make sure this market is the best place to sell this item.
			if (bestMarket?.market.symbol == waypoint.symbol) {
				this.sellCargo(inv.symbol, inv.units);
			}
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
			} else {
				continue;
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
						this.addMessage(`delivering goods for ${destinationType}`);
						this.navigateTo(waypoint);
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
			this.currentStep = new ExecutionStep(this, `sell ${units} units of ${itemSymbol}`);
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
	
	transferCargo(otherShip: Ship, inv:ShipCargoItem) {
		let freeSpace = otherShip.cargo.capacity - otherShip.cargo.units;
		if (freeSpace > 0) {
			if (this.ship.nav.status != otherShip.nav.status) {
				if (otherShip.nav.status == 'IN_ORBIT') {
					this.orbit();
				} else if (otherShip.nav.status == 'DOCKED') {
					this.dock();
				}
			}
			this.currentStep = new ExecutionStep(this, `transfer ${inv.units} units of ${inv.symbol} to ${otherShip.symbol}`);
			this.fleetService.transferCargo(this.ship.symbol, otherShip.symbol, inv.symbol, Math.min(freeSpace, inv.units))
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
			this.currentStep = new ExecutionStep(this, `deliver Contract Goods: ${units} of ${tradeSymbol}`);
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
			this.currentStep = new ExecutionStep(this, `deliver Construction Materials: ${units} of ${tradeSymbol}`);
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
							otherBot.transferCargo(this.ship, inv);
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
			this.currentStep = new ExecutionStep(this, `buying ${units} of ${itemSymbol}`);
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
			this.currentStep = new ExecutionStep(this, `refining ${productionType}`);
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
			this.currentStep = new ExecutionStep(this, `charting`);
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
			this.currentStep = new ExecutionStep(this, `docking`);
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
			this.currentStep = new ExecutionStep(this, `orbiting`);
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
		if (this.ship.nav.status = 'DOCKED') {
			this.currentStep = new ExecutionStep(this, `Negotiating contract`);
			this.automationService.contractService.negotiateContract(this.ship.symbol)
			                                      .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	
	exploreSystems(startingLoc: WaypointBase) {
		if (this.role != Role.Explorer || !this.automationService.agent) {
			return;
		}
		const startingSystemStr = this.automationService.agent.headquarters;
		const startingSystem = this.galaxyService.getSystemBySymbol(startingSystemStr);
		const system = startingSystem;
		if (Ship.containsModule(this.ship, "MODULE_WARP_DRIVE_")) {
			// we can warp to nearby systems
		} else if (system) {
			const nextSystemSymbol = this.explorationService.exploreSystems(this.ship);
			if (nextSystemSymbol && nextSystemSymbol != this.ship.nav.systemSymbol) {
				const jumpgates = this.automationService.jumpgateService.getJumpgatesBySystemSymbol(this.ship.nav.systemSymbol);
				if (jumpgates && jumpgates.length > 0) {
					const waypoint = this.galaxyService.getWaypointByWaypointSymbol(jumpgates[0].symbol!);
					if (waypoint) {
						this.navigateTo(waypoint);
					}
					this.jumpTo(nextSystemSymbol);
				}
			}
			const marketSymbols = this.marketService.getMarketSymbolsInSystem(system.symbol);
			const tooOld = Date.now() - 1000 * 60 * 30; // 30 minutes ago
			const marketsToVisit: string[] = []; 
			for (let marketSymbol of marketSymbols || []) {
				const lastUpdateDate = this.marketService.lastUpdateDate(marketSymbol);
				if (lastUpdateDate == null || lastUpdateDate.getTime() < tooOld) {
					marketsToVisit.push(marketSymbol);
				}
			}
			const waypointsToVisit = system.waypoints?.filter((wp) => marketsToVisit.includes(wp.symbol));
			if (waypointsToVisit) {
				this.traverseWaypoints(waypointsToVisit, startingLoc);
			}
		}
	}

	traverseWaypoints(waypoints: WaypointBase[], startingLoc: WaypointBase) {
		if (waypoints.length == 1) {
			this.navigateTo(waypoints[0]);
		}
		const loc = ExplorationService.organizeRoute(waypoints, startingLoc);
		if (loc) {
			this.navigateTo(loc);
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

export class ExecutionStep extends Error {
	bot: Bot | null;
	constructor(bot: Bot | null, message: string) {
		super(message);
		this.bot = bot;
		this.name = "ExecutionStep";
	}
}
