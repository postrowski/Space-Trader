import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Agent } from 'src/models/Agent';
import { Contract } from 'src/models/Contract';
import { Market } from 'src/models/Market';
import { Ship } from 'src/models/Ship';
import { ShipType } from 'src/models/ShipType';
import { Shipyard } from 'src/models/Shipyard';
import { Survey } from 'src/models/Survey';
import { System } from 'src/models/System';
import { WaypointBase} from 'src/models/WaypointBase';
import { Bot, ExecutionStep, Role } from '../utils/bot';
import { AccountService } from './account.service';
import { ContractService } from './contract.service';
import { DBService } from './db.service';
import { ExplorationService } from './exploration.service';
import { FleetService } from './fleet.service';
import { GalaxyService } from './galaxy.service';
import { JumpgateService } from './jumpgate.service';
import { MarketService } from './market.service';
import { ShipyardService } from './shipyard.service';
import { SurveyService } from './survey.service';

@Injectable({
	providedIn: 'root'
})
export class AutomationService {

	public messagesByShipSymbol = new Map<string, string[]>();
	
	private runningSubject = new BehaviorSubject<boolean>(false);
	running$: Observable<boolean> = this.runningSubject.asObservable();

	errorCount = 0;
	millisPerStep = 350;

	agent: Agent | null = null;
	shipBots: Bot[] = [];
	contract: Contract | null = null;

	refreshAgent = false;
	refreshShips = '';
	refreshWaypoints = '';
	
	constructor(public fleetService: FleetService,
		        public galaxyService: GalaxyService,
		        public accountService: AccountService,
        		public surveyService: SurveyService,
		        public contractService: ContractService,
		        public marketService: MarketService,
		        public shipyardService: ShipyardService,
		        public jumpgateService: JumpgateService,
		        public explorationService: ExplorationService,
		        public dbService: DBService) {
		this.addMessage(null, "starting...");
		this.fleetService.allShips$.subscribe((ships) => {
			for (let ship of ships) {
				let found = false;
				for (let bot of this.shipBots){
					if (bot.ship.symbol == ship.symbol) {
						bot.ship = ship;
						found = true;
						break;
					}
				}
				if (!found) {
					this.shipBots.push(new Bot(ship, this));
				}
			}
		});
		
		this.contractService.acceptedContract$.subscribe((contract) => {
			this.contract = contract;
		});
		this.accountService.agent$.subscribe((agent) => {
			this.agent = agent;
		});
	}
	
	addMessage(ship: Ship | null, message: string) {
		let messages = this.messagesByShipSymbol.get(ship?.symbol || '');
		if (!messages) {
			messages = [];
			this.messagesByShipSymbol.set(ship?.symbol || '', messages);
		}
		message = `${ship?.symbol}: ${new Date().toLocaleTimeString()} - ${message}`;
		messages.push(message);
		if (messages.length > 15) {
			messages.shift();
		}
		console.log(message);
	}
	
	onError(error: any, step: ExecutionStep) {
		while (error.error) {
			error = error.error;
		}
		const message = error.message.toLowerCase();
		if (message.includes("insufficient funds")) {
			this.refreshAgent = true;
		}
		if (message.includes("ship is not currently ")) { // "...in orbit" or "...docked"
			this.refreshShips = 'All';
		}
		const waypointCharted = "waypoint already charted: ";
		if (message.startsWith(waypointCharted)) {
			this.refreshWaypoints = message.slice(waypointCharted.length);
		}
		if (message.includes("ship action is still on cooldown")) { // "...in orbit" or "...docked"
			let found = false;
			for (let bot of this.shipBots) {
				if (bot.ship.symbol == error.data.cooldown.shipSymbol) {
					bot.ship.cooldown = error.data.cooldown;
					found = true;
					break;
				}
			}
			if (!found) {
				this.refreshShips = 'All';
			}
		}
		this.addMessage(null, "Error condition! " + message);
		this.completeStep(step);
		// We add two to the errorCount, because the call to completeStep decrements by 1, and we need to overcome that
		this.errorCount += 2; 
		if (this.errorCount > 10) {
			this.addMessage(null, "10 consecutive Error conditions! stopping.");
			this.stop();
		}
	}
	completeStep(step: ExecutionStep) {
		this.errorCount = Math.max(0, this.errorCount - 1);
		this.addMessage(step.bot?.ship || null, step.message + ' done.');
		if (step.bot?.ship) {
			this.shipOperationBySymbol.delete(step.bot.ship.symbol);
		}
	}

	private interval: any;
	start() {
		if (this.interval) {
			clearInterval(this.interval);
		}
		this.shipOperationBySymbol.clear();
		if (this.contract == null) {
			this.contractService.updateContracts();
		}
		this.errorCount = 0;
		this.runningSubject.next(true);
		this.interval = setInterval(() => {
			this.step();
		}, this.millisPerStep);
	}
	stop() {
		if (this.interval) {
			clearInterval(this.interval);
		}
		this.runningSubject.next(false);
	}

	systemsBySymbol = new Map<string, System | null>();
	shipOperationBySymbol: Map<string, ExecutionStep> = new Map();
	step() {
		const startTime = Date.now();
		try {
			if (this.refreshAgent) {
				this.refreshAgent = false;
				this.doRefreshAgent();
			}
			if (this.refreshShips) {
				const ships = this.refreshShips; 
				this.refreshShips = '';
				this.doRefreshShips(ships);
			}
			if (this.refreshWaypoints) {
				const waypoints = this.refreshWaypoints.toUpperCase(); 
				this.refreshWaypoints = '';
				this.doRefreshWaypoints(waypoints);
			}
			if (this.contract) {
				this.fulfillContract();
			} else {
				this.acceptContract();
			}
			for (const bot of this.shipBots) {
				if (bot.ship.symbol.toLowerCase() != 'blackrat-1') {
					//continue;
				}
				if (bot.ship.nav.status === 'IN_TRANSIT') {
					continue;
				}
				const currentOperation = this.shipOperationBySymbol.get(bot.ship.symbol);
				if (currentOperation) {
					continue;
				}
				if (bot.currentStep) {
					continue;
				}
				const waypointSymbol = bot.ship.nav.waypointSymbol;
				const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypointSymbol);
				const system = this.systemsBySymbol.get(systemSymbol);
				if (system == undefined) {
					this.systemsBySymbol.set(systemSymbol, null);
					this.dbService.systems.get(systemSymbol).then((sys) => {
						if (sys) {
							this.systemsBySymbol.set(sys.symbol, sys);
						}
					});
					this.addMessage(bot.ship, `getting system ${systemSymbol}`);
					continue; // don't proceed until we get that system back from the DB
				}
				const waypoint = system?.waypoints?.find((waypoint) => waypoint.symbol === waypointSymbol) || null;
				if (!waypoint) {
					this.addMessage(bot.ship, `Can't find waypoint ${bot.ship.nav.waypointSymbol}`);
					continue;
				}
				// Jump gates don't typically have traits, so there is no point in loading this
				if (!waypoint.traits && (waypoint.type !== 'JUMP_GATE')) {
					this.loadWaypoints(system);
				}
				const isJumpgate      = WaypointBase.isJumpGate(waypoint);
				const hasShipyard     = WaypointBase.hasShipyard(waypoint);
				const hasUncharted    = WaypointBase.hasUncharted(waypoint);
				const isDebrisField   = WaypointBase.isDebrisField(waypoint);
				const hasMarketplace  = WaypointBase.hasMarketplace(waypoint);
				const isAsteroidField = WaypointBase.isAsteroidField(waypoint);
				const isFactionHome   = this.agent?.headquarters == waypoint.symbol;
				let market = hasMarketplace ? this.getUptoDateCachedMarket(waypoint.symbol) : null;
				let shipyard = hasShipyard ? this.getUptoDateCachedShipyard(waypoint.symbol) : null;
				let jumpgate = isJumpgate ? this.jumpgateService.getJumpgateBySymbol(waypoint.symbol) : null;

				if (hasUncharted) {
					bot.chart(waypoint);
				}
				const waypointsToExplore = (system && this.explorationService.getWaypointsNeedingToBeExplored(system)) || [];
				if (hasMarketplace) {
					// When we are exploring, always keep as full a fuel tank as possible,
					// otherwise keep 40% in the tank
					let minPercent = waypointsToExplore.length > 0 ? 95 : 40;
					bot.refuel(minPercent);

					// If this waypoint has a marketplace, but our cache is too old,
					// update the cached marketplace:
					if (market == null) {
						this.getMarket(waypoint, true);
					} else {
						let currentPriceByTradeSymbol = this.currentPriceByTradeSymbolByWaypoint[waypoint.symbol];
						if (!currentPriceByTradeSymbol ||
							Object.keys(currentPriceByTradeSymbol).length === 0) {
							this.getMarket(waypoint, true);
						}
					}
				}
				if (hasShipyard && (shipyard == null)) {
					// If this waypoint has a shipyard, but our cache is too old,
					// update the cached shipyard:
					this.getShipyard(waypoint, true);
				}
				if (isJumpgate && (jumpgate == null)) {
					// If this waypoint is a jumpgate, but not in our records:
					this.jumpgateService.getJumpgate(waypoint.symbol, true);
				}
				
				const firstFastestBot = this.findFirstFastestShipInSystem(waypoint.symbol);
				const isFirstFastestBot = firstFastestBot == bot;
				if (waypointsToExplore && isFirstFastestBot) {
					this.exploreSystem(bot, system);
				}
				// Lets negatiate contracts first:
				if (isFirstFastestBot && !this.contract) {
					if (isFactionHome) {
						bot.negotiateContract();
					} else if (this.agent &&
					           system?.waypoints &&
					           bot.ship.nav.systemSymbol == GalaxyService.getSystemSymbolFromWaypointSymbol(this.agent?.headquarters)) {
						const homeWaypoint = system.waypoints.find((wp) => wp.symbol === this.agent?.headquarters);
						if (homeWaypoint) {
							this.addMessage(bot.ship, 'going to faction home to negotiate contract');
							bot.navigateTo(homeWaypoint);
						}
					}
				}
				if (isFirstFastestBot) {
					// Make sure we have at least some price data from evey single market and shipyard in this system.
					// If we are a ship at one of these locations, visit that market/shipyard.
					// If we are not at that location, put the location in the list of locations that
					// the fastest ship will visit.
					const marketsToVisit: WaypointBase[] = [];
					for (let sysWaypoint of system?.waypoints || []) {
						if (sysWaypoint.symbol == bot.ship.nav.waypointSymbol) {
							// We've already checked the market and shipyard prices for our current location
							continue;
						}
						const sysWaypointHasMarket = WaypointBase.hasMarketplace(sysWaypoint);
						const sysWaypointHasShipyard = WaypointBase.hasShipyard(sysWaypoint);
						if (sysWaypointHasMarket || sysWaypointHasShipyard) {
							let sysMarket = sysWaypointHasMarket ? this.getUptoDateCachedMarket(sysWaypoint.symbol) : null;
							let sysShipyard = sysWaypointHasShipyard ? this.getUptoDateCachedShipyard(sysWaypoint.symbol) : null;
							const missingMarket = sysWaypointHasMarket && (sysMarket == null);
							const missingShipyard = sysWaypointHasShipyard && (sysShipyard == null);
							if (missingMarket || missingShipyard) {
								marketsToVisit.push(sysWaypoint);
							}
						}
					}
					if (marketsToVisit.length > 0) {
						bot.traverseWaypoints(marketsToVisit);
					}
				}

				const neededUpgrade = bot.getNeededUpgrade();
				let waypointDest: string | null = null;
				if (neededUpgrade) {
					const hasItem = bot.ship.cargo.inventory.some(inv => inv.symbol === neededUpgrade);
					if (!hasItem) {
						const market = this.findCheapestMarketWithItemForSale(bot.ship, neededUpgrade);
						if (market) {
							const inv = market.tradeGoods.filter((good)=> good.symbol === neededUpgrade);
							if (inv && inv.length) {
								if ((this.agent?.credits || 0) > inv[0].purchasePrice) {
									this.addMessage(bot.ship, 'going to market to buy upgrade');
									waypointDest = market.symbol;
								}
							}
						}
					} else {
						const shipyard = this.findNearestShipyard(bot.ship);
						if (shipyard) {
							this.addMessage(bot.ship, 'going to shipyard to install upgrade');
							waypointDest = shipyard.symbol;
						}
					}
				}
				if (isFirstFastestBot && !waypointDest && (this.agent?.credits||0) > 170_000) {
					const shipyard = this.findNearestShipyard(bot.ship);
					if (shipyard) {
						const houndShips = shipyard.ships.filter(ship => ship.name.toLowerCase().includes('hound'));
						if (houndShips && (houndShips.length > 0) && 
							(this.agent?.credits || 0) > houndShips[0].purchasePrice) {
							let otherShipAtYard = this.getShipsAtWaypoint(bot, shipyard.symbol);
							if (otherShipAtYard.length == 0) {
								this.addMessage(bot.ship, 'going to shipyard to buy ship');
								waypointDest = shipyard.symbol;
							}
						}
					} else {
						if (system.waypoints && System.hasShipyard(system)) {
							const shipyardWaypoints: WaypointBase[] = system.waypoints.filter((waypoint) => {
								return WaypointBase.hasShipyard(waypoint);
							});
							if (shipyardWaypoints?.length) {
								let otherShipAtYard = this.getShipsAtWaypoint(bot, shipyardWaypoints[0].symbol);
								if (otherShipAtYard.length == 0) {
									this.addMessage(bot.ship, 'going to shipyard to look at ship');
									waypointDest = shipyardWaypoints[0].symbol;
								}
							}
						}
					}
				}
				if (isFirstFastestBot && !waypointDest && this.contract) {
					let contractItemToBuy: string | null = null;
					let remainingUnits = 0;
					for (const goods of this.contract.terms.deliver) {
						remainingUnits = goods.unitsRequired - goods.unitsFulfilled;
						if ((remainingUnits > 0) &&
						    !goods.tradeSymbol.toUpperCase().endsWith("_ORE")) {
							for (let inv of bot.ship.cargo.inventory) {
								if (goods.tradeSymbol == inv.symbol) {
									remainingUnits -= inv.units;
									break;
								}
							}
							if (remainingUnits > 0) {
								contractItemToBuy = goods.tradeSymbol;
								break;
							} else {
								this.addMessage(bot.ship, `going to deliver contract goods ${goods.tradeSymbol}`);
								waypointDest = goods.destinationSymbol;
							}
						}
					}
					if (contractItemToBuy && (remainingUnits > 0)) {
						const market = this.findCheapestMarketWithItemForSale(bot.ship, contractItemToBuy);
						if (market && GalaxyService.getSystemSymbolFromWaypointSymbol(market.symbol) == bot.ship.nav.systemSymbol) {
							const inv = market.tradeGoods.filter((good) => good.symbol === contractItemToBuy);
							if (inv && inv.length) {
								if ((this.agent?.credits || 0) > inv[0].purchasePrice) {
									this.addMessage(bot.ship, `going to market to buy contract item ${contractItemToBuy}`);
									waypointDest = market.symbol;
								}
							}
						}
					}
				}
				if (waypointDest) {
					const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypointDest);
					const system = this.systemsBySymbol.get(systemSymbol);
					if (system?.waypoints) {
						const waypoint = system.waypoints.find(waypoint => waypoint.symbol === waypointDest);
						if (waypoint) {
							bot.navigateTo(waypoint);
						}
					}
				}

				if (bot.role == Role.Refinery){
					bot.gatherOre(market, this.shipBots);
					bot.refineAll();
				} else if (bot.role == Role.Explorer){
					bot.exploreSystems();
				}

				if (bot.ship.nav.status === 'DOCKED' && market) {
					// If we are already docked at a marketplace, sell everything we've got:
					bot.sellAll(this.contract, market, this.shipBots);
				}

				if (isAsteroidField || isDebrisField) {
					let surveys = this.surveyService.getSurveysForWaypoint(waypoint);
					let bestSurvey = this.getBestSurveyToUse(bot.ship.nav.waypointSymbol, surveys);
					if (surveys.length < 5) {
						bot.survey();
					}
					// If our cargo hold is below half capacity, we should be able
					// to get another load:
					if (bot.ship.cargo.units < bot.ship.cargo.capacity/2) {
						bot.mine(bestSurvey);
					}
				}
				if (market) {
					bot.sellAll(this.contract, market, this.shipBots);
					bot.buyModuleForUpgrade(market!, this.agent?.credits || 0);
				}
				if (hasShipyard) {
					bot.upgradeShip(waypoint);
					this.buyShips(waypoint);
				}
				
				if (this.contract) {
					if (isFirstFastestBot && market) {
						bot.buyContractGoods(market!, this.agent?.credits || 0, this.contract);
					}
					bot.deliverAll(this.contract);
				}
				
				if (!isAsteroidField && !isDebrisField && Ship.containsMount(bot.ship, 'MOUNT_MINING_LASER')) {
					const asteroidField = system?.waypoints?.find((waypoint) => waypoint.type === 'ASTEROID_FIELD') || null;
					if (asteroidField) {
						this.addMessage(bot.ship, 'going to asteroid field to mine.');
						bot.navigateTo(asteroidField);
					}
				}
			}
			this.galaxyService.getMoreGalaxyDetails();
		} catch (error) {
			if (error instanceof ExecutionStep) {
				if (error.bot?.ship) {
					const shipSymbol = error.bot.ship.symbol;
					this.shipOperationBySymbol.set(shipSymbol, error);
					const shipOperationBySymbol = this.shipOperationBySymbol;
					setTimeout(function() {
						if (shipOperationBySymbol.get(shipSymbol) == error) {
							shipOperationBySymbol.delete(shipSymbol);
						  	console.error(`Command '${error}' still not cleared after 10 seconds.`);
						}
					}, 10_000);

				}
				this.addMessage(error.bot?.ship || null, error.message);
				this.errorCount = Math.max(0, this.errorCount - 1);
			} else {
				console.error(error);
			}
		}
		const endTime = Date.now();
		const executionTime = endTime - startTime;
		this.executionTimes.push(executionTime); // Add execution time to the array.

		// Ensure that the array has a maximum length of 10.
		if (this.executionTimes.length > 10) {
			this.executionTimes.shift(); // Remove the oldest execution time.
		}

	}
	executionTimes: number[] = [];
	
	getShipsAtWaypoint(bot: Bot, waypointSymbol: string): Bot[] {
		return this.shipBots.filter((otherBot) => {
			return otherBot !== bot && (
				otherBot.ship.nav.waypointSymbol === waypointSymbol ||
				otherBot.ship.nav.route.destination.symbol === waypointSymbol
			);
		});
	}
						
	findFirstFastestShipInSystem(systemSymbol: string): Bot | null {
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		let fastestShip: Bot | null = null;
		for (const bot of this.shipBots) {
			if (systemSymbol == bot.ship.nav.systemSymbol) {
				if (fastestShip == null || bot.ship.engine.speed > fastestShip.ship.engine.speed) {
					fastestShip = bot;
				}
			}
		}
		return fastestShip;
	}
			
	shipyardBySymbol: Map<string, Shipyard> = new Map();
	shipyardBySymbolTimestamp: Map<string, number> = new Map();
	getShipyard(waypoint: WaypointBase, shipsAtWaypoint: boolean) {
		if (!WaypointBase.hasShipyard(waypoint)) {
			return;
		}
		let shipyardTimestamp = this.shipyardBySymbolTimestamp.get(waypoint.symbol);
		if (!shipyardTimestamp || shipyardTimestamp < Date.now()) {
			shipyardTimestamp = Date.now() + 60 * 60 * 1000; // 1 hour expiration
			this.shipyardBySymbolTimestamp.set(waypoint.symbol, shipyardTimestamp);
			const step = new ExecutionStep(null, `getting shipyard`);
			this.shipyardService.getShipyard(waypoint.symbol, shipsAtWaypoint).subscribe((response) => {
				this.completeStep(step);
				this.shipyardBySymbol.set(waypoint.symbol, response);
			}, (error) => {
				this.onError(error, step);
			});
			throw step;
		}
	}
	doRefreshAgent() {
		const step = new ExecutionStep(null, `refreshing agent`);
		this.accountService.fetchAgent().subscribe((response) => {
			this.completeStep(step);
		}, (error) => {
			this.onError(error, step);
		});
		throw step;
	}
	doRefreshShips(shipSymbol: string) {
		const step = new ExecutionStep(null, `refreshing ship(s) ${shipSymbol}`);
		if (shipSymbol === 'All') {
			this.fleetService.updateFleet().subscribe((response) => {
				this.completeStep(step);
			}, (error) => {
				this.onError(error, step);
			});
		} else {
			this.fleetService.getShip(shipSymbol).subscribe((response) => {
				this.completeStep(step);
			}, (error) => {
				this.onError(error, step);
			});
		}
		throw step;
	}
	
	doRefreshWaypoints(waypointSymbol: string) {
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypointSymbol);
		const step = new ExecutionStep(null, `refreshing waypoint ${systemSymbol}`);
		this.galaxyService.getAllWaypoints(systemSymbol).subscribe((response) => {
			this.completeStep(step);
			const system = this.systemsBySymbol.get(systemSymbol);
			if (system != undefined) {
				system.waypoints = response;
			}
		}, (error) => {
			this.onError(error, step);
		});
		throw step;
	}
	
	fulfillContract() {
		if (this.contract && this.contract.accepted && !this.contract.fulfilled) {
			let goodsRemain = false;
			for (let goods of this.contract.terms.deliver) {
				const remainingUnits = goods.unitsRequired - goods.unitsFulfilled;
				if (remainingUnits > 0) {
					goodsRemain = true;
				}
			}
			if (!goodsRemain) {
				const step = new ExecutionStep(null, `fulfilling contract`);
				this.contractService.fulfillContract(this.contract.id)
				                    .subscribe((response) => {
					this.completeStep(step);
				}, (error) => {
					this.onError(error, step);
				});
				throw step;
			}
		}
	}

	acceptContract() {
		if (!this.contract) {
			for (let contract of this.contractService.getAllContracts()) {
				if (!contract.accepted) {
					const step = new ExecutionStep(null, `Accepting contract`);
					this.contractService.acceptContract(contract.id).subscribe((response) => {
						this.completeStep(step);
					}, (error) => {
						this.onError(error, step);
					});
					throw step;
				}
			}
		}
	}
	marketBySymbol: Map<string, Market> = new Map();
	marketBySymbolTimestamp: Map<string, number> = new Map();
	getMarket(waypoint: WaypointBase, shipsAtWaypoint: boolean) {
		if (!WaypointBase.hasMarketplace(waypoint)) {
			return;
		}
		if (this.getUptoDateCachedMarket(waypoint.symbol) == null) {
			const marketTimestamp = Date.now() + 60 * 60 * 1000; // 1 hour expiration
			this.marketBySymbolTimestamp.set(waypoint.symbol, marketTimestamp);
			const step = new ExecutionStep(null, `getting market`);
			this.marketService.getMarketplace(waypoint.symbol, shipsAtWaypoint).subscribe((response) => {
				this.completeStep(step);
				this.marketBySymbol.set(waypoint.symbol, response);
				
				for (let tradeGood of response.tradeGoods) {
					let currentPriceByTradeSymbol = this.currentPriceByTradeSymbolByWaypoint[waypoint.symbol];
					if (!currentPriceByTradeSymbol) {
						currentPriceByTradeSymbol = {};
						this.currentPriceByTradeSymbolByWaypoint[waypoint.symbol] = currentPriceByTradeSymbol;
					}
					currentPriceByTradeSymbol[tradeGood.symbol] = tradeGood.sellPrice;
				}

			}, (error) => {
				this.onError(error, step);
			});
			throw step;
		}
	}
	getUptoDateCachedMarket(waypointSymbol: string): Market | null {
		let market = this.marketBySymbol.get(waypointSymbol);
		let marketTimestamp = this.marketBySymbolTimestamp.get(waypointSymbol);
		if (!market || !marketTimestamp || marketTimestamp < Date.now()) {
			return null;
		}
		return market;
	}
	getUptoDateCachedShipyard(waypointSymbol: string): Shipyard | null {
		let shipyard = this.shipyardBySymbol.get(waypointSymbol);
		let shipyardTimestamp = this.shipyardBySymbolTimestamp.get(waypointSymbol);
		if (!shipyard || !shipyardTimestamp || shipyardTimestamp < Date.now()) {
			return null;
		}
		return shipyard;
	}

	findCheapestMarketWithItemForSale(ship: Ship | null, itemSymbol: string): Market | null {
		let bestMarket = null;
		let bestPrice = null;
		for (let marketSymbol of this.marketBySymbol.keys()) {
			// Only look within the system of the current ship
			if (ship && !marketSymbol.startsWith(ship.nav.systemSymbol)) {
				continue;
			}
			const market = this.marketBySymbol.get(marketSymbol);
			for (const tradeGood of market?.tradeGoods || []) {
				if (tradeGood.symbol == itemSymbol) {
					if (bestPrice == null || bestPrice > tradeGood.purchasePrice) {
						bestPrice = tradeGood.purchasePrice;
						bestMarket = market;
					}
				}
			}
		}
		if (!bestMarket) {
			if (ship) {
				// If we couldn't find it in the system with this ship, look in other systems.
				return this.findCheapestMarketWithItemForSale(null, itemSymbol);
			}
			return null;
		}
		return bestMarket;
	}
	findNearestShipyard(ship: Ship): Shipyard | null {
		let nearestShipyardSymbol: string | null = null;
		for (let shipyardSymbol of this.shipyardBySymbol.keys()) {
			// Only look within the system of the current ship
			if (ship && !shipyardSymbol.startsWith(ship.nav.systemSymbol)) {
				continue;
			}
			return this.shipyardBySymbol.get(shipyardSymbol) || null;
		}
		return null;
	}
	

	shipTypeMap: Map<ShipType, string> = new Map([
		[ShipType.SHIP_PROBE,               'FRAME_PROBE'],
		[ShipType.SHIP_MINING_DRONE,        'FRAME_DRONE'],
		[ShipType.SHIP_INTERCEPTOR,         'FRAME_INTERCEPTOR'],
	    [ShipType.SHIP_LIGHT_HAULER,        'FRAME_LIGHT_HAULER'],
	    [ShipType.SHIP_COMMAND_FRIGATE,     'FRAME_FRIGATE'],
	    [ShipType.SHIP_EXPLORER,            'FRAME_EXPLORER'],
	    [ShipType.SHIP_HEAVY_FREIGHTER,     'FRAME_HEAVY_FREIGHTER'],
	    [ShipType.SHIP_LIGHT_SHUTTLE,       'FRAME_SHUTTLE'],
	    [ShipType.SHIP_ORE_HOUND,           'FRAME_MINER'],
	    [ShipType.SHIP_REFINING_FREIGHTER,  'FRAME_LIGHT_FREIGHTER'],
	    ]);
	getShipTypeToBuy(shipyard: Shipyard): ShipType | null {
		const idealFleet: ShipType[] = [];
		idealFleet.push(ShipType.SHIP_COMMAND_FRIGATE);
		idealFleet.push(ShipType.SHIP_PROBE);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);// 5
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_HEAVY_FREIGHTER); //10
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_HEAVY_FREIGHTER); //15
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_REFINING_FREIGHTER); // 20
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);
		idealFleet.push(ShipType.SHIP_HEAVY_FREIGHTER); // 25
		idealFleet.push(ShipType.SHIP_REFINING_FREIGHTER);
		idealFleet.push(ShipType.SHIP_LIGHT_HAULER);
		idealFleet.push(ShipType.SHIP_ORE_HOUND);

		for (let bot of this.shipBots) {
			let index = 0;
			for (let shipType of idealFleet) {
				if (this.shipTypeMap.get(shipType) === bot.ship.frame.symbol) {
					idealFleet.splice(index, 1);
					break;
				}
				index++;
			}
		}
		let alternate = null;
		if (idealFleet.length > 0) {
			for (const type of shipyard.shipTypes) {
				if (type.type === ShipType[idealFleet[0]].toString()) {
					return idealFleet[0];
				}
				// Allow for the next ship type, if the first isn't being sold here.
				if (idealFleet.length > 1) {
					if (type.type === ShipType[idealFleet[1]].toString()) {
						alternate = idealFleet[0];
					}
				}
			}
		}
		return alternate;
	}
	
	buyShips(waypoint: WaypointBase) {
		if (!WaypointBase.hasShipyard(waypoint)) {
			return;
		}
		this.getShipyard(waypoint, true);
		
		let shipyard = this.shipyardBySymbol.get(waypoint.symbol);
		if (!shipyard) {
			return;
		}
		const shipTypeToBuy = this.getShipTypeToBuy(shipyard);
		if (!shipTypeToBuy) {
			return
		}
		const shipTypeName = ShipType[shipTypeToBuy].toString();
		if (this.agent && (this.agent.credits > 150_000)) {
			for (let ship of shipyard.ships) {
				if (ship.type === shipTypeName) {
					if (ship.purchasePrice < (this.agent?.credits || 0)) {
						const step = new ExecutionStep(null, `Buying ship ${shipTypeName}`);
						this.fleetService.purchaseShip(shipTypeName, waypoint.symbol).subscribe((response) => {
							this.completeStep(step);
							this.refreshShips = 'All';
							this.refreshAgent = true;
						}, (error) => {
							this.onError(error, step);
						});
						throw step;
					}
					break;
				}
			}
		}
	}
	exploreSystem(bot: Bot, system: System) {
		// Navigate to the next waypoint that needs to be explored:
		const unchartedWaypoints = system.waypoints?.filter((waypoint) => this.explorationService.waypointNeedsToBeExplored(waypoint));
		if (unchartedWaypoints && unchartedWaypoints.length > 0) {
			this.addMessage(bot.ship, "exploring");
			bot.traverseWaypoints(unchartedWaypoints);
		}
	}
	
	currentPriceByTradeSymbolByWaypoint: { [waypointSymbol: string]: { [tradeSymbol: string]: number } } = {};
	
	getBestSurveyToUse(waypointSymbol: string, surveys: Survey[]): Survey | undefined {
		let currentPriceByTradeSymbol = this.currentPriceByTradeSymbolByWaypoint[waypointSymbol];
		if (!currentPriceByTradeSymbol) {
			return undefined;
		}

		const surveyAverages: { [symbol: string]: number } = {};
		// Calculate average price per unit for each survey
		surveys.forEach((survey) => {
			const sum = survey.deposits.reduce((total, deposit) => {
				let value = currentPriceByTradeSymbol[deposit.symbol];
				if (this.contract) {
					// favor surveys that lead to resources we need for a contract
					for (let goods of this.contract.terms.deliver) {
						if (goods.tradeSymbol == deposit.symbol) {
							const remainingUnits = goods.unitsRequired - goods.unitsFulfilled;
							if (remainingUnits > 0) {
								return total + value * 2;
							}
						}
					}
				}
				return total + value;
			}, 0);
			surveyAverages[survey.symbol] = sum / survey.deposits.length;
		});

		// Find the survey with the highest average price per unit
		let highestAverageSurvey: Survey | undefined;
		let highestAveragePrice = -Infinity;

		for (const survey of surveys) {
			const averagePrice = surveyAverages[survey.symbol];
			if (averagePrice !== undefined && averagePrice > highestAveragePrice) {
				highestAverageSurvey = survey;
				highestAveragePrice = averagePrice;
			}
		}

		return highestAverageSurvey;
	}

	loadWaypoints(system: System) {
		this.galaxyService.getAllWaypoints(system.symbol).subscribe((response) => {
			system.waypoints = response
		});
	}
}
