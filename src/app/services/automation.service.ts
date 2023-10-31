import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Agent } from 'src/models/Agent';
import { Contract } from 'src/models/Contract';
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
import { UiMarketItem, MarketService } from './market.service';
import { ShipyardService } from './shipyard.service';
import { SurveyService } from './survey.service';
import { ShipCargoItem } from 'src/models/ShipCargoItem';
import { LocXY } from 'src/models/LocXY';
import { LogMessage } from '../utils/log-message';

@Injectable({
	providedIn: 'root'
})
export class AutomationService {

	public messageSubject = new BehaviorSubject<LogMessage>(new LogMessage());
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
		const logMessage = new LogMessage();
		logMessage.message = message;
		logMessage.shipSymbol = ship?.symbol || '';
		logMessage.timestamp  = new Date();
		this.messageSubject.next(logMessage);
		
		message = `${ship?.symbol}: ${new Date().toLocaleTimeString()} - ${message}`;
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
		if (message.includes("ship is currently ")) { // "ship is currently in-transit...
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
		//this.addMessage(step.bot?.ship || null, step.message + ' done.');
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
			const botsByWaypointSymbol = new Map<string, Bot[]>();
			for (const bot of this.shipBots) {
				if (bot.ship.nav.status != 'IN_TRANSIT') {
					const waypointSymbol = bot.ship.nav.waypointSymbol;
					if (!botsByWaypointSymbol.has(waypointSymbol)) {
						botsByWaypointSymbol.set(waypointSymbol, []);
					}
					botsByWaypointSymbol.get(waypointSymbol)!.push(bot);
				}
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
				if (!system) {
					this.systemsBySymbol.set(systemSymbol, null);
					this.dbService.systems.get(systemSymbol).then((sys) => {
						if (sys) {
							this.systemsBySymbol.set(sys.symbol, sys);
						}
					});
					this.addMessage(bot.ship, `getting system ${systemSymbol}`);
					continue; // don't proceed until we get that system back from the DB
				}
				const waypoint = system.waypoints?.find((waypoint) => waypoint.symbol === waypointSymbol) || null;
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
				const isAsteroid      = WaypointBase.isAsteroid(waypoint);
				const isGasGiant      = WaypointBase.isGasGiant(waypoint);
				const isFactionHome   = true;//this.agent?.headquarters == waypoint.symbol;
				let hasPriceData = hasMarketplace ? this.marketService.hasPriceData(waypoint.symbol) : false;
				let shipyard = hasShipyard ? this.shipyardService.getCachedShipyard(waypoint.symbol, false) : null;
				let jumpgate = isJumpgate ? this.jumpgateService.getJumpgateBySymbol(waypoint.symbol) : null;

				if (hasUncharted) {
					bot.chart(waypoint);
				}
				if (hasMarketplace && !hasPriceData) {
					// If this waypoint has a marketplace, but we dont have real price data:
					this.getMarket(waypoint, true);
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

				const waypointsToExplore = this.explorationService.getWaypointsNeedingToBeExplored(system) || [];
				if (hasMarketplace) {
					// When we are exploring, always keep as full a fuel tank as possible,
					// otherwise keep 40% in the tank
					let minPercent = waypointsToExplore.length > 0 ? 95 : 40;
					bot.refuel(minPercent);
				}
				
				const firstFastestBot = this.findFirstFastestShipInSystem(waypoint.symbol);
				const isFirstFastestBot = firstFastestBot == bot;
				if (waypointsToExplore && isFirstFastestBot && waypointsToExplore.length > 0) {
					// Navigate to the next waypoint that needs to be explored:
					this.addMessage(bot.ship, "exploring");
					bot.traverseWaypoints(waypointsToExplore, waypoint);
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
							let sysMarket = sysWaypointHasMarket ? this.marketService.hasPriceData(sysWaypoint.symbol) : false;
							let sysShipyard = sysWaypointHasShipyard ? this.shipyardService.getCachedShipyard(sysWaypoint.symbol, false) : null;
							const missingMarket = sysWaypointHasMarket && !sysMarket;
							const missingShipyard = sysWaypointHasShipyard && (sysShipyard == null);
							if (missingMarket || missingShipyard) {
								marketsToVisit.push(sysWaypoint);
							}
						}
					}
					if (marketsToVisit.length > 0) {
						bot.traverseWaypoints(marketsToVisit, waypoint);
					}
				}

				const neededUpgrade = bot.getNeededUpgrade();
				let waypointDest: string | null = null;
				if (neededUpgrade) {
					const hasItem = bot.ship.cargo.inventory.some(inv => inv.symbol === neededUpgrade);
					if (!hasItem) {
						const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(system.symbol, neededUpgrade);
						if (marketItem) {
							if ((this.agent?.credits || 0) > marketItem.purchasePrice) {
								this.addMessage(bot.ship, 'going to market to buy upgrade');
								waypointDest = marketItem.marketSymbol;
							}
						}
					} else {
						const shipyard = this.shipyardService.findNearestShipyard(waypoint);
						if (shipyard) {
							this.addMessage(bot.ship, 'going to shipyard to install upgrade');
							waypointDest = shipyard.symbol;
						}
					}
				}
				if (isFirstFastestBot && !waypointDest && (this.agent?.credits||0) > 170_000) {
					const shipyard = this.shipyardService.findNearestShipyard(waypoint);
					if (shipyard) {
						const houndShips = shipyard.ships.filter(ship => ship.name.toLowerCase().includes('hound'));
						if (houndShips && (houndShips.length > 0) && 
							(this.agent?.credits || 0) > houndShips[0].purchasePrice) {
							let botsAtYard = botsByWaypointSymbol.get(shipyard.symbol);
							if (!botsAtYard) {
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
								let botsAtYard = botsByWaypointSymbol.get(shipyardWaypoints[0].symbol);
								if (!botsAtYard) {
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
							}
							this.addMessage(bot.ship, `going to deliver contract goods ${goods.tradeSymbol}`);
							waypointDest = goods.destinationSymbol;
							break;
						}
					}
					if (contractItemToBuy && (remainingUnits > 0)) {
						const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(system.symbol, contractItemToBuy);
						if (marketItem && ((this.agent?.credits || 0) > marketItem.purchasePrice)) {
							this.addMessage(bot.ship, `going to market to buy contract item ${contractItemToBuy}`);
							waypointDest = marketItem.marketSymbol;
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
					bot.gatherOre(this.shipBots);
					bot.refineAll();
				} else if (bot.role == Role.Explorer){
					bot.exploreSystems();
				}

				if (bot.ship.nav.status === 'DOCKED' && hasMarketplace) {
					// If we are already docked at a marketplace, sell everything we've got:
					bot.sellAll(this.contract, this.shipBots);
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
					bot.sellAll(this.contract, this.shipBots);
					bot.buyModuleForUpgrade(this.agent?.credits || 0);
				}
				if (hasShipyard) {
					bot.upgradeShip(waypoint);
					this.buyShips(waypoint);
				}
				
				if (this.contract) {
					if (isFirstFastestBot && hasMarketplace) {
						bot.buyContractGoods(this.agent?.credits || 0, this.contract);
					}
					bot.deliverAll(this.contract);
				}
				
				if (roomToMine) {
					if (Ship.containsMount(bot.ship, 'MOUNT_GAS_SIPHON')) {
						if (!isGasGiant) {
							const gasGiants = system.waypoints?.filter((way) => WaypointBase.isGasGiant(way) && way != waypoint) || [];
							if (gasGiants.length > 0) {
								const nearbyWaypoints = ExplorationService.sortWaypointsByDistanceFrom(gasGiants, waypoint);
								this.addMessage(bot.ship, 'going to gas giant to siphon.');
								bot.navigateTo(nearbyWaypoints[0]);
							}
						}
					} else if (!isAsteroid && !isDebrisField && Ship.containsMount(bot.ship, 'MOUNT_MINING_LASER')) {
						const asteroids = system.waypoints?.filter((way) => WaypointBase.isAsteroid(way) && way != waypoint) || [];
						if (asteroids.length > 0) {
							const nearbyWaypoints = ExplorationService.sortWaypointsByDistanceFrom(asteroids, waypoint);
							this.addMessage(bot.ship, 'going to asteroid to mine.');
							bot.navigateTo(nearbyWaypoints[0]);
						}
					}
				} else if (bot.ship.cargo.units > 0) {
					let majorityItem: ShipCargoItem | null = null;
					let inventory = [...bot.ship.cargo.inventory];
					inventory = inventory.filter((inv) => !inv.symbol.startsWith("MODULE") &&
														  !inv.symbol.startsWith("MOUNT") &&
														  !inv.symbol.includes("ANTIMATTER"));
					inventory.sort((i1, i2) => {
						if (i1.units < i2.units) return -1;
						if (i1.units > i2.units) return 1;
						return 0;
					});
					for (const inv of inventory) {
						const destWaypoint = this.marketService.getNearestMarketInSystemThatTradesItem(waypoint, inv.symbol, false);
						if (destWaypoint) {
							this.addMessage(bot.ship, `Navigating to ${destWaypoint.symbol} to sell ${inv?.symbol}`);
							bot.navigateTo(destWaypoint);
						}
					}
				}
			}
			this.galaxyService.getNextPageOfWaypoints();
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
			
	getShipyard(waypoint: WaypointBase, shipsAtWaypoint: boolean) {
		if (!WaypointBase.hasShipyard(waypoint)) {
			return;
		}
		if (this.shipyardService.getCachedShipyard(waypoint.symbol, false) == null) {
			const step = new ExecutionStep(null, `getting shipyard`);
			this.shipyardService.getShipyard(waypoint.symbol, shipsAtWaypoint).subscribe((response) => {
				this.completeStep(step);
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
	getMarket(waypoint: WaypointBase, shipsAtWaypoint: boolean) {
		if (!WaypointBase.hasMarketplace(waypoint)) {
			return;
		}
		if (!this.marketService.hasPriceData(waypoint.symbol)) {
			const step = new ExecutionStep(null, `getting market ${waypoint.symbol}`);
			this.marketService.getMarketplace(waypoint.symbol, shipsAtWaypoint).subscribe((response) => {
				this.completeStep(step);
			}, (error) => {
				this.onError(error, step);
			});
			throw step;
		}
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
		
		let shipyard = this.shipyardService.getCachedShipyard(waypoint.symbol, false);
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

	getBestSurveyToUse(waypoint: WaypointBase, surveys: Survey[]): Survey | undefined {
		const surveyAverages: { [symbol: string]: number } = {};

		// Calculate average price per unit for each survey
		surveys.forEach((survey) => {
			const sum = survey.deposits.reduce((total, deposit) => {
				const nearestMarket = this.marketService.getNearestMarketInSystemThatTradesItem(waypoint, deposit.symbol, true);
				if (!nearestMarket) return total;

				const distance = LocXY.getDistance(nearestMarket, waypoint);
				const fuelCost = distance * 2 / 20;
				const marketItem = this.marketService.getItemAtMarket(nearestMarket.symbol, deposit.symbol);
				if (!marketItem) return total;

				let value = marketItem.sellPrice;
				if (this.contract && ContractService.getContractDeliverable(deposit.symbol, this.contract)) {
					// Favor surveys that lead to resources needed for a contract
					return total + value * 2 - fuelCost;
				}

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

	loadWaypoints(system: System) {
		this.galaxyService.getAllWaypoints(system.symbol).subscribe((response) => {
			system.waypoints = response
		});
	}
}
