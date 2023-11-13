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
import { MarketManager } from '../utils/market-manager';
import { TradeManager } from '../utils/trade-manager';

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

	refreshAgent = false;
	refreshShips = '';
	refreshWaypoints = '';
	refreshMarkets: string[] = [];
	marketManager: MarketManager | null = null;
	tradeManager: TradeManager | null = null;
	managers: any[] = [];
	
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
		this.marketManager = new MarketManager(this);
		this.tradeManager = new TradeManager(this);
		this.managers.push(this.marketManager);
		this.managers.push(this.tradeManager);
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
		this.constructionService.constructionSiteSubject.subscribe((constructionSite) => {
			this.constructionSite = constructionSite;
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
		this.dbService.addLogMessage(logMessage);
		
		message = `${ship?.symbol}: ${new Date().toLocaleTimeString()} - ${message}`;
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
	
	activeShips: string[] = [];
	setActiveShips(activeShips: { shipSymbol: string, value: boolean }[]) {
		this.activeShips = [];
		for (const activeShip of activeShips) {
			if (activeShip.value) {
				this.activeShips.push(activeShip.shipSymbol);
			}
		}
	}

	prepare() {
		stop();
		this.shipOperationBySymbol.clear();
		if (this.contract == null) {
			this.contractService.getAllContracts();
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
			for (const bot of this.shipBots) {
				if (bot.manager == null) {
					if (bot.role == Role.Explorer && this.marketManager) {
						this.marketManager.addBot(bot);
					} else if (this.tradeManager) {
						this.tradeManager.addBot(bot);
					}
				}
				if (bot.ship.nav.status != 'IN_TRANSIT') {
					const waypointSymbol = bot.ship.nav.waypointSymbol;
					if (!botsByWaypointSymbol.has(waypointSymbol)) {
						botsByWaypointSymbol.set(waypointSymbol, []);
					}
					botsByWaypointSymbol.get(waypointSymbol)!.push(bot);
				}
			}
			const credits = this.agent?.credits || 0;
			
			const systemSymbols = this.shipBots.map(bot => bot.ship?.nav?.waypointSymbol)
			                                   .filter(Boolean)
			                                   .map((waypointSymbol) => GalaxyService.getSystemSymbolFromWaypointSymbol(waypointSymbol));
			const uniqueSystemSymbols = [...new Set(systemSymbols)]
			for (const systemSymbol of uniqueSystemSymbols) {
				const system = this.systemsBySymbol.get(systemSymbol);
				if (!system) {
					this.systemsBySymbol.set(systemSymbol, null);
					this.dbService.systems.get(systemSymbol).then((sys) => {
						if (sys) {
							this.systemsBySymbol.set(sys.symbol, sys);
						}
					});
					// don't proceed until we get that system back from the DB
					throw `waiting for DB to get system ${systemSymbol}`;
				}
			}

			for (const manager of this.managers) {
				manager.step(this.systemsBySymbol, this.shipOperationBySymbol, this.activeShips, credits);
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
			for (let contract of this.contractService.getContracts()) {
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
