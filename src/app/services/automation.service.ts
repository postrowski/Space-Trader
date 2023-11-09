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
import { LocXY } from 'src/models/LocXY';
import { LogMessage } from '../utils/log-message';
import { ConstructionSite } from 'src/models/ConstructionSite';
import { ConstructionService } from './construction.service';
import { WeekDay } from '@angular/common';

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
	constructionSite: ConstructionSite | null = null;
	systemsBySymbol = new Map<string, System | null>();
	shipOperationBySymbol: Map<string, ExecutionStep> = new Map();
	timeToSupplyConstruction = 0;

	refreshAgent = false;
	refreshShips = '';
	refreshWaypoints = '';
	refreshMarkets: string[] = [];
	
	constructor(public fleetService: FleetService,
		        public galaxyService: GalaxyService,
		        public accountService: AccountService,
        		public surveyService: SurveyService,
		        public contractService: ContractService,
		        public constructionService: ConstructionService,
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
			if (contract) {
				console.log(`contractService.acceptedContract - id: ${contract.id}, ac: ${contract.accepted}, ff:${contract.fulfilled}`);
			} else {
				console.log(`contractService.acceptedContract - null`);
			}
			this.contract = contract;
		});
		this.constructionService.constructionSiteSubject.subscribe((constructionSite) => {
			this.constructionSite = constructionSite;
			this.timeToSupplyConstruction = Date.now() + 1000 * 60 * 1; // once per minute we can construct the jumpgate.
		});
		this.accountService.agent$.subscribe((agent) => {
			this.agent = agent;
		});
	}
	
	addMessage(ship: Ship | null, message: string) {
		const logMessage = new LogMessage();
		logMessage.message = message;
		logMessage.shipSymbol = ship?.symbol || '';
		logMessage.shipLocation = ship?.nav.waypointSymbol || '';
		logMessage.timestamp  = new Date();
		logMessage.credits = this.agent?.credits || 0;
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
		this.prepare();
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
	singleStep() {
		this.prepare();
		this.step();
	}
	prepare() {
		stop();
		this.shipOperationBySymbol.clear();
		if (this.contract == null) {
			this.contractService.updateContracts();
		}
		this.errorCount = 0;
	}

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
			if (this.refreshMarkets.length > 0) {
				const marketSymbol = this.refreshMarkets.shift(); 
				if (marketSymbol) {
					const market = this.galaxyService.getWaypointByWaypointSymbol(marketSymbol);
					if (market) {
						this.getMarketplaceForced(market);
					}
				}
			}
			if (this.contract) {
				this.fulfillContract();
			} else {
				this.acceptContract();
			}
			if (this.constructionSite == null && this.agent) {
				const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(this.agent.headquarters);
				const system = this.systemsBySymbol.get(systemSymbol);
				if (system) {
					for (const waypoint of system.waypoints || []) {
						if (waypoint.isUnderConstruction) {
							this.getConstructionSite(waypoint.symbol);
						}
					}
				}
			}
			
			const botsByWaypointSymbol = new Map<string, Bot[]>();
			const haulerBots: Bot[] = [];
			for (const bot of this.shipBots) {
				if (bot.role == Role.Hauler) {
					haulerBots.push(bot);
				}
				if (bot.ship.nav.status != 'IN_TRANSIT') {
					const waypointSymbol = bot.ship.nav.waypointSymbol;
					if (!botsByWaypointSymbol.has(waypointSymbol)) {
						botsByWaypointSymbol.set(waypointSymbol, []);
					}
					botsByWaypointSymbol.get(waypointSymbol)!.push(bot);
				}
			}
			let contractBot = null;
			let constructionBot = null;
			const credits = this.agent?.credits || 0;
			if (credits > 500_000) {
				if (haulerBots.length > 2) {
					contractBot = haulerBots[2];
				}
				if (credits > 1_000_000) {
					if (haulerBots.length > 1) {
						constructionBot = haulerBots[1];
					}
				}
			}
			
			for (const bot of this.shipBots) {
				if (bot.ship.nav.status === 'IN_TRANSIT') {
					continue;
				}
				const currentOperation = this.shipOperationBySymbol.get(bot.ship.symbol);
				if (currentOperation || bot.currentStep) {
					continue;
				}
				// Lets negatiate contracts first:
				if (!this.contract) {
					bot.negotiateContract();
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
					this.addMessage(bot.ship, `waiting for DB to get system ${systemSymbol}`);
					continue; // don't proceed until we get that system back from the DB
				}
				const waypoint = system.waypoints?.find((waypoint) => waypoint.symbol === waypointSymbol) || null;
				if (!waypoint) {
					this.addMessage(bot.ship, `Can't find waypoint ${bot.ship.nav.waypointSymbol}`);
					continue;
				}
				// Jump gates don't typically have traits, so we don't use the loadWaypoints when a jumpgate
				// doesn't have traits. The 'loadWaypoints' will load all the waypoints for the entire system
				// though, so this will still load the jumpgate's traits when another waypoint has not traits.
				if (!waypoint.traits && (waypoint.type !== 'JUMP_GATE')) {
					this.loadWaypoints(system);
				}
				const isJumpgate     = WaypointBase.isJumpGate(waypoint);
				const hasShipyard    = WaypointBase.hasShipyard(waypoint);
				const hasUncharted   = WaypointBase.hasUncharted(waypoint);
				const isDebrisField  = WaypointBase.isDebrisField(waypoint);
				const hasMarketplace = WaypointBase.hasMarketplace(waypoint);
				const isAsteroid     = WaypointBase.isAsteroid(waypoint);
				const isGasGiant     = WaypointBase.isGasGiant(waypoint);
				let hasPriceData = hasMarketplace ? this.marketService.hasPriceData(waypoint.symbol) : false;
				let shipyard = hasShipyard ? this.shipyardService.getCachedShipyard(waypoint.symbol, false) : null;
				let jumpgate = isJumpgate ? this.jumpgateService.getJumpgateBySymbol(waypoint.symbol) : null;
				const marketDataAge = hasPriceData ? this.marketService.lastUpdateDate(waypoint.symbol) : null;
				
				// Update our local information, if needed
				if (hasUncharted) {
					bot.chart(waypoint);
				}
				const tooOld = Date.now() - 1000 * 60 * 30; // 30 minutes ago 
				if (hasMarketplace && !hasPriceData) {
					// If this waypoint has a marketplace, but we dont have real price data:
					this.getMarket(waypoint, true);
				} else if (hasMarketplace && 
				           (marketDataAge != null && 
				            (marketDataAge.getTime() < tooOld))) {
					// If this waypoint has a marketplace, but the price data is too old
					this.getMarketplaceForced(waypoint);
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
					bot.traverseWaypoints(waypointsToExplore, waypoint, "exploring");
				}

				// Make sure we have at least some price data from evey single market and shipyard in this system.
				// If we are a ship at one of these locations, visit that market/shipyard.
				let marketsToVisit: WaypointBase[] = [];
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
				// avoid sending two ships to the same location:
				const visitingDestinations = new Set(this.shipBots.map((otherBot) => otherBot.ship.nav.route.destination.symbol));
				marketsToVisit = marketsToVisit.filter((way) => !visitingDestinations.has(way.symbol));
				if (marketsToVisit.length > 0) {
					bot.traverseWaypoints(marketsToVisit, waypoint, "exploring markets");
				}

				const neededUpgrade = bot.getNeededUpgrade();
				let waypointDest: string | null = null;
				let waypointDestPurpose: string | null = null;
				if (neededUpgrade) {
					const hasItem = bot.ship.cargo.inventory.some(inv => inv.symbol === neededUpgrade);
					if (!hasItem) {
						const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(waypoint, neededUpgrade, 1);
						if (marketItem) {
							if (credits > marketItem.purchasePrice) {
								waypointDestPurpose = `going to market ${waypointDest} to buy upgrade ${neededUpgrade}`;
								waypointDest = marketItem.marketSymbol;
							}
						}
					} else {
						const shipyard = this.shipyardService.findNearestShipyard(waypoint);
						if (shipyard) {
							waypointDestPurpose = `going to shipyard ${shipyard.symbol} to install upgrade ${neededUpgrade}`;
							waypointDest = shipyard.symbol;
						}
					}
				}
				/*if (isFirstFastestBot && !waypointDest && credits > 170_000) {
					const shipyard = this.shipyardService.findNearestShipyard(waypoint);
					if (shipyard) {
						const houndShips = shipyard.ships.filter(ship => ship.name.toLowerCase().includes('hound'));
						if (houndShips && (houndShips.length > 0) && 
							credits > houndShips[0].purchasePrice) {
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
				}*/
				const otherShipsAtWaypoint = this.shipBots.filter((otherBot) => {
					return (bot.ship.symbol != otherBot.ship.symbol) && 
							(otherBot.ship.nav.status !== 'IN_TRANSIT') && 
							(bot.ship.nav.waypointSymbol == otherBot.ship.nav.waypointSymbol);
				});
				if (this.contract || this.constructionSite) {
					// If this is a drone or a probe, it doesn't make sense to have it making contract/construction runs.
					if (bot.ship.cargo.capacity > 20 && (bot == contractBot || bot == constructionBot)) {
						bot.deliverAll(this.contract, this.constructionSite);
					}
				}
				let contractAllowed = (bot == contractBot) && (credits > 500_000);
				let constructionAllowed = (bot == constructionBot) && (credits > 1_000_000);
				if (!waypointDest && (bot == contractBot || bot == constructionBot)) {
					bot.sellAtBestLocation(waypoint, contractAllowed ? this.contract : null,
					                       constructionAllowed ? this.constructionSite : null, otherShipsAtWaypoint);
					waypointDestPurpose = `going to market ${waypointDest} to buy contract/construction goods`;
					waypointDest = this.buyContractAndConstructionGoods(bot, waypoint, contractAllowed, constructionAllowed);
				}
				if (waypointDest && waypointDestPurpose) {
					const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypointDest);
					const system = this.systemsBySymbol.get(systemSymbol);
					if (system?.waypoints) {
						const waypoint = system.waypoints.find(waypoint => waypoint.symbol === waypointDest);
						if (waypoint) {
							bot.navigateTo(waypoint, null, waypointDestPurpose);
						}
					}
				}

				if (bot.role == Role.Refinery) {
					bot.gatherOre(this.shipBots);
					bot.refineAll();
				} else if (bot.role == Role.Explorer) {
					bot.exploreSystems(waypoint);
				} else if (bot.role != Role.Miner &&
						   bot.role != Role.Siphon) {
						   //(bot !== contractBot || !contractAllowed) &&
						   //(bot !== constructionBot || !constructionAllowed)
					let res;
					let tries = 0;
					let travelSpeed = 'CRUISE';
					do 	{
						res = bot.trade(waypoint, this.contract, this.constructionSite, credits,
						                travelSpeed, this.shipBots, otherShipsAtWaypoint);
						if (res == 'fail' && travelSpeed == 'CRUISE') {
							res = 'retry';
							travelSpeed = 'DRIFT';
						}
					} while (res == 'retry' && (tries++ < 10));
	                if (res == 'wait') {
						continue;
					}
				}

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
					if (neededUpgrade) {
						this.addMessage(bot.ship, `buying upgrade item ${neededUpgrade}`);
						bot.buyItems(neededUpgrade, 1);
					}
				}
				if (hasShipyard) {
					bot.upgradeShip(waypoint);
					this.buyShips(waypoint);
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
					} else {
						// we aren't doing anything else, check if we should contribute to the contract or construction site
						waypointDest = this.buyContractAndConstructionGoods(bot, waypoint, contractAllowed, constructionAllowed);
						if (waypointDest) {
							const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypointDest);
							const system = this.systemsBySymbol.get(systemSymbol);
							if (system?.waypoints) {
								const waypoint = system.waypoints.find(waypoint => waypoint.symbol === waypointDest);
								if (waypoint) {
									bot.navigateTo(waypoint, null, `going to market ${waypointDest} to buy contract/construction goods`);
								}
							}
						}
					}
				} else if (bot.ship.cargo.units > 0) {
				
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
						const sellItem = this.marketService.findHighestPricedMarketItemForSaleInSystem(waypoint, inv.symbol, inv.units);
						if (sellItem) {
							if (sellItem.marketSymbol == waypoint.symbol) {
								bot.sellCargo(sellItem.symbol, inv.units);
							} else {
								const market = this.galaxyService.getWaypointByWaypointSymbol(sellItem.marketSymbol);
								if (market) {
									bot.navigateTo(market, null, `Navigating to ${sellItem.marketSymbol} to sell ${sellItem.marketSymbol}`);
								}
							}
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
	
	buyContractAndConstructionGoods(bot: Bot, waypoint: WaypointBase, contractAllowed: boolean, constructionAllowed: boolean): string | null {
		if (bot.ship.cargo.capacity < 25) {
			// If we don't have much space for cargo, don't be a part of the contract/construction crew
			return null;
		}
		let itemFor = '';
		let itemsToBuy: {symbol: string, units: number, itemFor: string, deliverTo: string}[] = [];
		if (this.constructionSite && constructionAllowed && this.timeToSupplyConstruction < Date.now()) {
			for (const material of this.constructionSite.materials) {
				itemsToBuy.push({
					symbol: material.tradeSymbol,
					units: material.required - material.fulfilled,
					itemFor: 'construction Site',
					deliverTo: this.constructionSite.symbol
				});
			}
		}
		if (this.contract && contractAllowed) {
			for (const goods of this.contract.terms.deliver) {
				itemsToBuy.push({
					symbol: goods.tradeSymbol,
					units: goods.unitsRequired - goods.unitsFulfilled,
				 	itemFor: 'contract',
					deliverTo: goods.destinationSymbol
				});
			}
		}
		for (const itemToBuy of itemsToBuy) {
			const lowPrice = this.marketService.getItemHistoricalLowPriceAtMarket(waypoint.symbol, itemToBuy.symbol);
			const currentPrices: Map<string, UiMarketItem> = this.marketService.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, itemToBuy.symbol);
			let minPrice = Infinity;
			for (let item of currentPrices.values()) {
				if (item.purchasePrice < minPrice) {
					minPrice = item.purchasePrice;
				}
			}
			let tooExpensive = (minPrice > lowPrice* 2);
			if (tooExpensive || ((this.agent?.credits || 0) > minPrice)) {
				continue;
			}
			
			if (itemToBuy.units > 0) {
				for (let inv of bot.ship.cargo.inventory) {
					if (itemToBuy.symbol == inv.symbol) {
						itemToBuy.units -= inv.units;
						break;
					}
				}
				if (itemToBuy.units <= 0) {
					// We have all the items we need, go deliver them now
					this.addMessage(bot.ship, `going to ${itemToBuy.deliverTo} to deliver ${itemToBuy.itemFor} ${itemToBuy.symbol}`);
					return itemToBuy.deliverTo;
				}
			}
		}
		let closestItem = null;
		let closestDist = Infinity;
		let closestMarket = null;
		for (const itemToBuy of itemsToBuy) {
			const marketItem: UiMarketItem | null = this.marketService.findCheapestMarketItemForSaleInSystem(waypoint, itemToBuy.symbol, itemToBuy.units);
			if (marketItem) {
				const supplierMarket = this.galaxyService.getWaypointByWaypointSymbol(marketItem.marketSymbol);
				if (supplierMarket) {
					const distForItem = LocXY.getDistance(waypoint, supplierMarket);
					if (closestDist > distForItem) {
						closestDist = distForItem;
						closestItem = itemToBuy;
						closestMarket = supplierMarket;
					}
				}
			}
		}
		if (closestMarket && closestItem) {
			if (waypoint.symbol != closestMarket.symbol) {
				this.addMessage(bot.ship, `going to market ${closestMarket.symbol} to buy ${itemFor} item ${closestItem?.symbol}.`);
				return closestMarket.symbol;
			}
			this.addMessage(bot.ship, `buying ${itemFor} item: ${closestItem.units} ${closestItem.symbol}.`);
			bot.purchaseCargo(closestItem.symbol, closestItem.units);
		}
		return null;
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
			
	getShipyard(waypoint: WaypointBase, shipsAtWaypoint: boolean) {
		if (!WaypointBase.hasShipyard(waypoint)) {
			return;
		}
		if (this.shipyardService.getCachedShipyard(waypoint.symbol, false) == null) {
			const step = new ExecutionStep(null, `getting shipyard`);
			this.shipyardService.getShipyard(waypoint.symbol, shipsAtWaypoint)
			                    .subscribe((response) => {
				this.completeStep(step);
			}, (error) => {
				this.onError(error, step);
			});
			throw step;
		}
	}
	doRefreshAgent() {
		const step = new ExecutionStep(null, `refreshing agent`);
		this.accountService.fetchAgent()
		                   .subscribe((response) => {
			this.completeStep(step);
		}, (error) => {
			this.onError(error, step);
		});
		throw step;
	}
	doRefreshShips(shipSymbol: string) {
		const step = new ExecutionStep(null, `refreshing ship(s) ${shipSymbol}`);
		if (shipSymbol === 'All') {
			this.fleetService.updateFleet()
			                 .subscribe((response) => {
				this.completeStep(step);
			}, (error) => {
				this.onError(error, step);
			});
		} else {
			this.fleetService.getShip(shipSymbol)
			                 .subscribe((response) => {
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
		this.galaxyService.getAllWaypoints(systemSymbol)
		                  .subscribe((response) => {
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

	getConstructionSite(waypointSymbol: string) {
		if (!this.constructionSite) {
			const step = new ExecutionStep(null, `getting Construction Site`);
			this.constructionService.getConstructionSite(waypointSymbol)
			                        .subscribe((response) => {
				this.completeStep(step);
			}, (error) => {
				this.onError(error, step);
			});
			throw step;
		}
	}
	
	acceptContract() {
		if (!this.contract) {
			for (let contract of this.contractService.getAllContracts()) {
				if (contract.accepted === false && contract.id) {
					const step = new ExecutionStep(null, `Accepting contract`);
					this.contractService.acceptContract(contract.id)
					                    .subscribe((response) => {
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
			this.marketService.getMarketplace(waypoint.symbol, shipsAtWaypoint)
			                  .subscribe((response) => {
				this.completeStep(step);
			}, (error) => {
				this.onError(error, step);
			});
			throw step;
		}
	}
	
	getMarketplaceForced(waypoint: WaypointBase) {
		const step = new ExecutionStep(null, `getting market refresh ${waypoint.symbol}`);
		this.marketService.getMarketplaceForced(waypoint.symbol)
		                  .subscribe((response) => {
			this.completeStep(step);
		}, (error) => {
			this.onError(error, step);
		});
		throw step;
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
				const nearestMarket = this.marketService.getNearestMarketInSystemThatTradesItem(waypoint, deposit.symbol);
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

	waypointsLoading = new Set<string>();
	loadWaypoints(system: System) {
		if (!this.waypointsLoading.has(system.symbol)) {
			this.waypointsLoading.add(system.symbol);
			const step = new ExecutionStep(null, `Loading Waypoints for system ${system.symbol}`);
			this.galaxyService.getAllWaypoints(system.symbol)
			                  .subscribe((response) => {
				system.waypoints = response
				this.completeStep(step);
			}, (error) => {
				this.onError(error, step);
			});
			throw step;
		}
	}
}
