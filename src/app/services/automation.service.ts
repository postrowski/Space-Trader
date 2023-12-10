import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Agent } from 'src/models/Agent';
import { Contract } from 'src/models/Contract';
import { Ship } from 'src/models/Ship';
import { System } from 'src/models/System';
import { WaypointBase} from 'src/models/WaypointBase';
import { Bot, Role } from '../utils/bot';
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
import { LogMessage } from '../utils/log-message';
import { ConstructionSite } from 'src/models/ConstructionSite';
import { ConstructionService } from './construction.service';
import { MarketManager } from '../utils/market-manager';
import { TradeManager } from '../utils/trade-manager';
import { MineManager } from '../utils/mine-manager';
import { Manager } from '../utils/manager';
import { PairManager } from '../utils/pair-manager';
import { ConstructionManager } from '../utils/construction-manager';
import { ExploreManager } from '../utils/explore-manager';

@Injectable({
	providedIn: 'root'
})
export class AutomationService {

	public messageSubject = new BehaviorSubject<LogMessage>(new LogMessage());
	private runningSubject = new BehaviorSubject<boolean>(false);
	running$: Observable<boolean> = this.runningSubject.asObservable();

	errorCount = 0;
	stepCount = 0;
	millisPerStep = 350;

	agent: Agent | null = null;
	shipBots: Bot[] = [];
	contract: Contract | null = null;
	constructionSite: ConstructionSite | undefined | null = undefined;
	systemsBySymbol = new Map<string, System | null>();
	shipOperationBySymbol = new Map<string, ExecutionStep>();

	refreshAgent = false;
	serverResetHappening = false;
	refreshShips = '';
	refreshWaypoints = '';
	refreshMarkets: string[] = [];
	pauseOperationsTill = 0;
	marketManager: MarketManager | null = null;
	tradeManager: TradeManager | null = null;
	pairManagers: PairManager[] = [];
	mineManager: MineManager | null = null;
	constructionManager: ConstructionManager | null = null;
	explorationManager: ExploreManager | null = null;
	managers: Manager[] = [];
	executionSteps: {timeElapsed: number, ship: string, manager: string, operation: string}[] = [];
		
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
		this.marketManager = new MarketManager(this, 'mark');
		this.tradeManager = new TradeManager(this, 'trade');
		this.mineManager = new MineManager(this, 'mine');
		this.constructionManager = new ConstructionManager(this, 'const');
		this.explorationManager = new ExploreManager(this, 'xplor');
		this.managers.push(this.marketManager);
		this.managers.push(this.tradeManager);
		this.managers.push(this.mineManager);
		this.managers.push(this.constructionManager);
		this.managers.push(this.explorationManager);
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

	onServerReset() {
		this.agent = null;
		this.shipBots = [];
		this.contract = null;
		this.constructionSite = undefined;
		this.systemsBySymbol = new Map<string, System | null>();
		this.shipOperationBySymbol = new Map<string, ExecutionStep>();

		this.refreshAgent = false;
		this.serverResetHappening = false;
		this.refreshShips = '';
		this.refreshWaypoints = '';
		this.refreshMarkets = [];
		this.pauseOperationsTill = 0;
		this.marketManager = null;
		this.tradeManager = null;
		this.pairManagers = [];
		this.mineManager = null;
		this.constructionManager = null;
		this.managers = [];
		this.executionSteps = [];
		this.fleetService.onServerReset();
		this.galaxyService.onServerReset();
		this.accountService.onServerReset();
        this.surveyService.onServerReset();
		this.contractService.onServerReset();
		this.constructionService.onServerReset();
		this.marketService.onServerReset();
		this.shipyardService.onServerReset();
		this.jumpgateService.onServerReset();
		this.explorationService.onServerReset();
		this.dbService.onServerReset();
	}
		
	handleErrorMessage(error: any, ship: Ship | null) {
		while (error.error) {
			error = error.error;
		}
		const message = error.message?.toLowerCase() || 'null';
		this.addMessage(null, "Error condition! " + message);
		if (message.includes("Token version does not match the server")) {
			if (this.serverResetHappening) {
				return;
			}
			this.onServerReset();
		}
		if (message.includes("insufficient funds") ||
		    message.includes("agent does not have sufficient credits to purchase")) {
			this.refreshAgent = true;
			if (ship) {
				this.refreshMarkets.push(ship.nav.waypointSymbol);
			}
		}
		if (message.includes("ship is not currently ")) { // "...in orbit" or "...docked"
			this.refreshShips = ship?.symbol || 'All';
		}
		if (message.includes("cargo does not contain")) {// "Failed to update ship cargo. Ship BLACKRAT-1 cargo does not contain 35 unit(s) of PLATINUM. Ship has 0 unit(s) of PLATINUM."
			this.refreshShips = ship?.symbol || 'All';
		}
		if (message.includes("ship is currently ")) { // "ship is currently in-transit...
			this.refreshShips = ship?.symbol || 'All';
		}
		if (message.includes("failed to update ship cargo.")) {
			this.refreshShips = ship?.symbol || 'All';
		}
		if (message.includes("you have reached your api limit.")) {
			this.pauseOperationsTill = Date.now() + 30 * 1000;
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
				this.refreshShips = ship?.symbol || 'All';
			}
		}
	}
	onError(error: any, step: ExecutionStep) {
		this.handleErrorMessage(error, null);
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
	stopOne(bot: Bot) {
		for (const automationEnabledShip of this.automationEnabledShips) {
			if (automationEnabledShip.shipSymbol.toLowerCase() == bot.ship.symbol.toLowerCase()) {
				automationEnabledShip.value = false;
				return;
			}
		}
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
	
	automationEnabledShips: { shipSymbol: string, value: boolean }[] = [];
	setAutomationEnabledShips(automationEnabledShips: { shipSymbol: string, value: boolean }[]) {
		this.automationEnabledShips = automationEnabledShips;
	}

	prepare() {
		stop();
		this.shipOperationBySymbol.clear();
		if (this.contract == null) {
			this.contractService.getAllContracts();
		}
		this.errorCount = 0;
		this.stepCount = 0;
		
		for (const bot of this.shipBots) {
			bot.prepare();
		}
	}

	step() {
		const startTime = Date.now();
		if (this.pauseOperationsTill != 0) {
			if (this.pauseOperationsTill > startTime) {
				console.log("no operation taken: on API pause");
				return;
			}
			this.pauseOperationsTill = 0;
		}
		//LocXY.test();
		let executionStep: {timeElapsed: number, ship: string, manager: string, operation: string} = {
			timeElapsed: 0, ship: '', manager:'', operation: ''
		};
		try {
			if (this.refreshAgent) {
				this.refreshAgent = false;
				this.doRefreshAgent();
			}
			if (this.refreshShips) {
				const ships = this.refreshShips; 
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
			if (this.constructionSite === undefined && this.agent) {
				const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(this.agent.headquarters);
				const system = this.systemsBySymbol.get(systemSymbol);
				for (const waypoint of system?.waypoints || []) {
					if (waypoint.isUnderConstruction) {
						this.getConstructionSite(waypoint.symbol);
					}
				}
			}
			
			const botsBySystem = new Map<string, Bot[]>();
			const botsByWaypointSymbol = new Map<string, Bot[]>();
			for (const bot of this.shipBots) {
				if (!botsBySystem.has(bot.ship.nav.systemSymbol)) {
					botsBySystem.set(bot.ship.nav.systemSymbol, []);
				}
				botsBySystem.get(bot.ship.nav.systemSymbol)!.push(bot);

				if (bot.ship.nav.status != 'IN_TRANSIT') {
					const waypointSymbol = bot.ship.nav.waypointSymbol;
					if (!botsByWaypointSymbol.has(waypointSymbol)) {
						botsByWaypointSymbol.set(waypointSymbol, []);
					}
					botsByWaypointSymbol.get(waypointSymbol)!.push(bot);
				}
			}
			this.assignBotsToManagers(botsBySystem);
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
			
			Manager.getWaypointsToExplore(this.systemsBySymbol, this.shipBots, this.explorationService);

			const automationEnabledShipSymbols = this.automationEnabledShips
													.filter(a=>a.value)
													.map(a=>a.shipSymbol);

			this.stepCount++;													
			if (this.stepCount % 25) {
				// Make sure we get a chance to update our galaxies and waypoints at least ever 25th step
				this.galaxyService.completeIncompleteGalaxies();
				this.galaxyService.getNextPageOfWaypoints();
			}
			for (const manager of [this.explorationManager, 
									this.marketManager,
									//this.constructionManager,
									this.tradeManager,
									...this.pairManagers,
									this.mineManager]){
				if (manager) {
					executionStep.manager = manager.key;
					manager.step(this.systemsBySymbol, this.shipOperationBySymbol, automationEnabledShipSymbols, credits);
				}
			}
			this.galaxyService.completeIncompleteGalaxies();
			this.galaxyService.getNextPageOfWaypoints();
			executionStep.manager = '';
		} catch (error) {
			if (error instanceof ExecutionStep) {
				const step = error as ExecutionStep;
				executionStep.operation = error.key;
				if (step && step.bot?.ship) {
					executionStep.ship = '🛦 ' + step.bot.ship.symbol.split('-')[1];
					const shipSymbol = step.bot.ship.symbol;
					this.shipOperationBySymbol.set(shipSymbol, step);
					const shipOperationBySymbol = this.shipOperationBySymbol;
					const me = this;
					setTimeout(function() {
						if (shipOperationBySymbol.get(shipSymbol) == step) {
							shipOperationBySymbol.delete(shipSymbol);
							const message = `Command '${step}' on ship ${shipSymbol} still not cleared after 10 seconds.`;
						  	me.addMessage(step.bot?.ship || null, message);
						  	console.error(message);
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
		executionStep.timeElapsed = endTime - startTime;
		this.executionSteps.push(executionStep); // Add execution time to the array.

		// Ensure that the array has a maximum length of 10.
		if (this.executionSteps.length > 10) {
			this.executionSteps.shift(); // Remove the oldest execution time.
		}

	}
	
	assignBotsToManagers(botsBySystem: Map<string, Bot[]>) {
		for (const bot of this.shipBots) {
			if (bot.manager) {
				continue;
			}
			if (botsBySystem.get(bot.ship.nav.systemSymbol)?.length == 1 && this.explorationManager) {
				this.addMessage(bot.ship, `Adding ship ${bot.ship.symbol} to exploration manager`);
				this.explorationManager.addBot(bot);
			} else if (bot.role == Role.Explorer && this.marketManager && this.marketManager.getBotsInSystem(bot.ship.nav.systemSymbol).length == 0) {
				this.addMessage(bot.ship, `Adding ship ${bot.ship.symbol} to market manager`);
				this.marketManager.addBot(bot);
			} else if (bot.role == Role.Explorer && this.explorationManager) {
				this.addMessage(bot.ship, `Adding ship ${bot.ship.symbol} to exploration manager`);
				this.explorationManager.addBot(bot);
			} else if ((bot.role == Role.Miner || bot.role == Role.Siphon) && this.mineManager) {
				this.addMessage(bot.ship, `Adding ship ${bot.ship.symbol} to mine manager`);
				this.mineManager.addBot(bot);
			} else if (bot.role == Role.Surveyor) {
				for (const pairManager of this.pairManagers) {
					if (pairManager.surveyBot == null && pairManager.role == Role.Miner) {
						this.addMessage(bot.ship, `Pairing surveyor ship ${bot.ship.symbol} with pair ${pairManager.key}`);
						pairManager.addBot(bot);
						break;
					}
				}
			} else if (this.tradeManager && this.constructionManager) {
				if ((this.tradeManager.shipBots.length/3) > this.constructionManager.shipBots.length &&
					this.constructionManager.shipBots.length < 1 &&
					this.constructionSite !== null) {
					this.addMessage(bot.ship, `Adding ship ${bot.ship.symbol} to construction manager`);
					this.constructionManager.addBot(bot);
				} else {
					this.addMessage(bot.ship, `Adding ship ${bot.ship.symbol} to trade manager`);
					this.tradeManager.addBot(bot);
				}
			}
			// check if we should pull a hauler and a miner to make a pair:					
			if (this.mineManager && this.tradeManager && 
				this.tradeManager.shipBots.length > 3 &&
				this.mineManager.shipBots.length > 0) {
				const mineBot = this.mineManager.shipBots[this.mineManager.shipBots.length-1];
				let tradeBot = null;
				// find a hauler from the traderManager that is in the same system as this miner:
				for (const traderBot of this.tradeManager.shipBots) {
					if (mineBot.ship.nav.systemSymbol == traderBot.ship.nav.systemSymbol) {
						tradeBot = traderBot;
						break;
					}
				}
				let fail = true;
				if (mineBot && tradeBot && this.mineManager.removeBot(mineBot)) {
					if (this.tradeManager.removeBot(tradeBot)) {
						const pairManager = new PairManager(this, 'pair' + this.pairManagers.length);
						if (pairManager.addBot(mineBot) && pairManager.addBot(tradeBot)) {
							this.pairManagers.push(pairManager);
							this.managers.push(pairManager);
							this.addMessage(tradeBot.ship, `Pairing hauler ship ${tradeBot.ship.symbol} with miner ${mineBot.ship.symbol} in pair ${pairManager.key}`);
							this.addMessage(mineBot.ship, `Pairing hauler ship ${tradeBot.ship.symbol} with miner ${mineBot.ship.symbol} in pair ${pairManager.key}`);
							fail = false;
						} else {
							pairManager.removeBot(tradeBot);
							pairManager.removeBot(mineBot);
						}
					}
				}
				if (mineBot && tradeBot && fail) {
					this.mineManager.addBot(mineBot);
					this.tradeManager.addBot(tradeBot);
				}
			}
		}
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
			
	getShipyard(waypoint: WaypointBase) {
		if (!WaypointBase.hasShipyard(waypoint)) {
			return;
		}
		const step = new ExecutionStep(null, `getting shipyard`, 'yard');
		this.shipyardService.getShipyard(waypoint.symbol)
			.subscribe((response) => {
				this.completeStep(step);
			}, (error) => {
				this.onError(error, step);
			});
		throw step;
	}
	doRefreshAgent() {
		const step = new ExecutionStep(null, `refreshing agent`, 'agent');
		this.accountService.fetchAgent()
		                   .subscribe((response) => {
			this.completeStep(step);
		}, (error) => {
			this.onError(error, step);
		});
		throw step;
	}
	doRefreshShips(shipSymbol: string) {
		if (this.refreshShips === 'InProgess') {
			// just wait until the response comes back, which will change the value of this.refreshShips
			throw new ExecutionStep(null, `waiting for all ships refresh`, 'ships');
		}
		const step = new ExecutionStep(null, `refreshing ship(s) ${shipSymbol}`, 'ships');
		if (shipSymbol === 'All') {
			this.refreshShips = 'InProgess';
			this.fleetService.updateFleet()
			                 .subscribe((response) => {
				this.completeStep(step);
				this.refreshShips = '';
			}, (error) => {
				this.onError(error, step);
				this.refreshShips = 'All';
			});
		} else {
			this.refreshShips = '';
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
		const step = new ExecutionStep(null, `refreshing waypoint ${systemSymbol}`, 'ways');
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
				const step = new ExecutionStep(null, `fulfilling contract`, 'ffill');
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
		if (this.constructionSite !== null) {
			const step = new ExecutionStep(null, `getting Construction Site`, 'site');
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
					const step = new ExecutionStep(null, `Accepting contract`, 'accept');
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
		if (WaypointBase.hasMarketplace(waypoint)) {
			for (const bot of this.shipBots) {
				if (bot.ship.nav.status != 'IN_FLIGHT' &&
				    bot.ship.nav.waypointSymbol == waypoint.symbol) {
					bot.getMarketplaceForced();
					return;
				}
			}
		}
	}


	frigate = {frame:'FRAME_FRIGATE', mount: ''};
	probe = {frame:'FRAME_PROBE', mount: ''};
	miner = {frame:'FRAME_DRONE', mount: 'MOUNT_MINING_LASER_I'};
	siphoner = {frame:'FRAME_DRONE', mount: 'MOUNT_GAS_SIPHON_I'};
	surveyor = {frame:'FRAME_DRONE', mount: 'MOUNT_SURVEYOR_I'};
	lightFreighter = {frame:'FRAME_LIGHT_FREIGHTER', mount: ''};
	nextShipTypeToBuy: ShipConfig | null | undefined = undefined;
	
	getShipTypeToBuy(): ShipConfig | null {
		const idealFleet: ShipConfig[] = [
			/*01*/this.frigate,
			/*02*/this.probe,
			/*03*/this.lightFreighter,
			/*04*/this.siphoner,
			/*05*/this.lightFreighter,
			/*06*/this.lightFreighter,
			/*07*/this.lightFreighter,
			/*08*/this.lightFreighter,
			/*09*/this.miner,
			/*10*/this.surveyor,
			/*11*/this.lightFreighter,
			/*12*/this.lightFreighter,
			/*13*/this.lightFreighter,
			/*14*/this.lightFreighter,
			/*15*/this.lightFreighter,
			/*16*/this.lightFreighter,
			/*17*/this.lightFreighter,
			/*18*/this.lightFreighter,
			/*19*/this.lightFreighter,
			/*20*/this.miner,
			/*21*/this.surveyor,
			/*22*/this.lightFreighter,
			/*23*/this.lightFreighter,
			/*24*/this.lightFreighter,
			/*25*/this.lightFreighter,
			/*26*/this.lightFreighter,
			/*27*/this.lightFreighter,
			/*28*/this.lightFreighter,
			/*29*/this.lightFreighter,
			/*30*/this.miner,
			/*31*/this.surveyor,
			/*32*/this.lightFreighter,
			/*33*/this.lightFreighter,
			/*34*/this.lightFreighter,
			/*35*/this.lightFreighter,
			/*36*/this.lightFreighter,
			/*37*/this.lightFreighter,
			/*38*/this.lightFreighter,
			/*39*/this.miner,
			/*40*/this.surveyor,
			/*41*/this.lightFreighter,
			/*42*/this.lightFreighter,
			/*43*/this.lightFreighter,
			/*44*/this.lightFreighter,
			/*45*/this.lightFreighter,
			/*46*/this.lightFreighter,
			/*47*/this.miner,
			/*48*/this.surveyor,
			/*49*/this.lightFreighter,
			/*50*/this.lightFreighter,
			/*51*/this.probe,
			/*52*/this.probe,
			/*53*/this.probe,
			/*54*/this.probe,
			/*55*/this.probe,
			/*56*/this.probe,
			/*57*/this.probe,
			/*58*/this.probe,
			/*59*/this.probe,
			/*60*/this.probe,
			/*61*/this.probe,
			/*62*/this.probe,
			/*63*/this.probe,
			/*64*/this.probe,
			/*65*/this.probe,
			/*66*/this.probe,
			/*67*/this.probe,
			/*68*/this.probe,
			/*69*/this.probe,
			/*70*///this.lightFreighter,
		];
		for (let bot of this.shipBots) {
			let index = 0;
			for (let shipType of idealFleet) {
				if ((shipType.frame === bot.ship.frame.symbol) && 
				     (shipType.mount === '' || Ship.containsMount(bot.ship, shipType.mount))) {
					idealFleet.splice(index, 1);
					break;
				}
				index++;
			}
		}
		if (idealFleet.length == 0) {
			return null;
		}
		return idealFleet[0];
	}
	
	buyShips(waypoint: WaypointBase) {
		if (!WaypointBase.hasShipyard(waypoint)) {
			return;
		}
		
		let shipyard = this.shipyardService.getCachedShipyard(waypoint.symbol);
		if (!shipyard?.ships || shipyard.ships.length == 0) {
			this.getShipyard(waypoint);
			return;
		}
		if (this.nextShipTypeToBuy == undefined) {
			this.nextShipTypeToBuy = this.getShipTypeToBuy();
		}
		if (this.nextShipTypeToBuy == null) {
			return
		}
		// As we get more ship, we need to keep more free capital in order to keep our trade network going
		const minCreditsToKeep = (this.tradeManager?.shipBots.length || 1) * 25_000 + 25_000;
		const credits = (this.agent?.credits || 0) - minCreditsToKeep;
		if (this.agent && (credits > 0)) {
			for (let ship of shipyard.ships) {
				if ((this.nextShipTypeToBuy.frame === ship.frame.symbol) && 
				     (this.nextShipTypeToBuy.mount === '' || 
				      Ship.containsMount(ship, this.nextShipTypeToBuy.mount))) {
					if (ship.purchasePrice < credits && !AutomationService.shipPurchaseInProgress) {
						AutomationService.shipPurchaseInProgress = true;
						const step = new ExecutionStep(null, `Buying ship ${ship.name} (${ship.type})`, 'bShip');
						this.fleetService.purchaseShip(ship.type, waypoint.symbol)
						                 .subscribe((response) => {
							this.completeStep(step);
							this.refreshShips = 'All';
							this.refreshAgent = true;
							this.nextShipTypeToBuy = undefined; // undef indicates we need to lookup the next ship
							AutomationService.shipPurchaseInProgress = false;
						}, (error) => {
							this.onError(error, step);
							this.nextShipTypeToBuy = undefined; // undef indicates we need to lookup the next ship
							AutomationService.shipPurchaseInProgress = false;
						});
						// Set nextShipTypeToBuy to null to indicate we aren't buying anything (ever!).
						// This will be reset once the response from the current purchase ship request comes back
						this.nextShipTypeToBuy = null; 
						throw step;
					}
					break;
				}
			}
		}
	}
	static shipPurchaseInProgress = false;
	
	waypointsLoading = new Set<string>();
	loadWaypoints(system: System) {
		if (!this.waypointsLoading.has(system.symbol)) {
			this.waypointsLoading.add(system.symbol);
			const step = new ExecutionStep(null, `Loading Waypoints for system ${system.symbol}`, 'system');
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

export class ShipConfig {
	frame!: string;
	mount!: string;
};

export class ExecutionStep extends Error {
	bot: Bot | null;
	key: string;
	constructor(bot: Bot | null, message: string, key: string) {
		super(message);
		this.bot = bot;
		this.key = key;
		this.name = "ExecutionStep";
	}
}
