import { Contract } from "src/models/Contract";
import { ContractDeliverGood } from "src/models/ContractDeliverGood";
import { LocXY } from "src/models/LocXY";
import { Market } from "src/models/Market";
import { Ship } from "src/models/Ship";
import { ShipCargoItem } from "src/models/ShipCargoItem";
import { Survey } from "src/models/Survey";
import { WaypointBase } from "src/models/WaypointBase";
import { AutomationService } from "../services/automation.service";
import { ExplorationService } from "../services/exploration.service";
import { FleetService } from "../services/fleet.service";
import { GalaxyService } from "../services/galaxy.service";

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
    explorationService!: ExplorationService;
    
	constructor(ship: Ship,
				automationService: AutomationService) {
		this.ship = ship;
		this.automationService = automationService;
		this.fleetService = this.automationService.fleetService;
		this.explorationService = this.automationService.explorationService;
		this.determineRole();
	}
	
	determineRole() {
		const hasSensor = Ship.containsMount(this.ship, 'MOUNT_SENSOR');
		const hasMining = Ship.containsMount(this.ship, 'MOUNT_MINING_LASER');
		const hasRefinery = Ship.containsModule(this.ship, 'MODULE_ORE_REFINERY');
		const hasCargo = Ship.containsModule(this.ship, 'MODULE_CARGO_HOLD_I');
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
			this.fleetService.setFlightMode(this.ship.symbol, mode).subscribe((response)=>{
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
					const waypoint = this.automationService.galaxyService.getWaypointByWaypointSymbol(jumpgates[0].symbol!);
					if (waypoint) {
						this.navigateTo(waypoint);
					}
					// first element in the path is the starting point, so we travel to the second element:
					this.jumpTo(path[1]);
				}
			}
		}
		console.error(`Can't determine how to get ship ${this.ship.symbol} from ${this.ship.nav.systemSymbol} to ${systemSymbol}!`);
	}
	
	navigateTo(waypoint: WaypointBase){
		if (this.ship.nav.waypointSymbol != waypoint.symbol) {
			const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypoint.symbol);
			if (this.ship.nav.systemSymbol != systemSymbol) {
				this.navigateToSystem(systemSymbol);
				return;
			}
			this.orbit();
			const dist = LocXY.getDistance(this.ship.nav.route.destination, waypoint);
			const mustDrift = dist > this.ship.fuel.current;
			let mode = mustDrift ? 'DRIFT' : 'CRUISE';
			this.setFlightMode(mode);
				
			this.currentStep = new ExecutionStep(this, `Navigate to ${waypoint.symbol}`);
			this.fleetService.navigateShip(this.ship.symbol, waypoint.symbol).subscribe((response)=>{
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}

	jumpTo(waypointSymbol: string){
		if (this.ship.nav.waypointSymbol != waypointSymbol) {
			this.orbit();
			this.currentStep = new ExecutionStep(this, `Jump to ${waypointSymbol}`);
			this.fleetService.jumpShip(this.ship.symbol, waypointSymbol).subscribe((response)=>{
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
			this.dock();
			this.currentStep = new ExecutionStep(this, `refueling`);
			const qty = (this.ship.fuel.capacity - this.ship.fuel.current);
			this.fleetService.refuelShip(this.ship.symbol, qty).subscribe((response)=>{
				this.completeStep();
				this.ship.fuel.update(response.data.fuel);
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
			this.fleetService.createSurvey(this.ship.symbol).subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
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
			this.fleetService.extractResourcesWithSurvey(this.ship.symbol, survey).subscribe((response) => {
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
		this.fleetService.extractResources(this.ship.symbol).subscribe((response) => {
			this.completeStep();
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
		this.fleetService.siphonGas(this.ship.symbol).subscribe((response) => {
			this.completeStep();
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
			this.fleetService.installMount(this.ship.symbol, mountToInstall!).subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
		}
	}
	buyModuleForUpgrade(market: Market, agentCredits: number) {
		const mountToBuy: string | null = this.getNeededUpgrade();
		if (mountToBuy == null) {
			return;
		}
		this.buyItems(market, mountToBuy, 1, agentCredits);
	}
	buyContractGoods(market: Market, agentCredits: number, contract: Contract) {
		for (let goods of contract.terms.deliver) {
			let remainingUnits = goods.unitsRequired - goods.unitsFulfilled;
			if (remainingUnits > 0) {
				this.buyItems(market, goods.tradeSymbol, remainingUnits, agentCredits);
			}
		}
		return null;
	}
	
	buyItems(market: Market, itemToBuy: string, quantity: number, agentCredits: number) {
		// If we already have this amount in our inventory, don't buy any more:
		for (let inv of this.ship.cargo.inventory) {
			if ((inv.symbol === itemToBuy) && (inv.units >= quantity)) {
				return;
			}
		}

		let forSale = false;
		for (let inv of market?.tradeGoods || []) {
			if (inv.purchasePrice > agentCredits) {
				continue;
			}
			if (inv.symbol === itemToBuy) {
				forSale = true;
				if (quantity > inv.tradeVolume) {
					quantity = inv.tradeVolume;
				}
				break;
			}
		}
		if (forSale) {
			this.dock();
			this.currentStep = new ExecutionStep(this, `buying item ${itemToBuy}`);
			this.fleetService.purchaseCargo(this.ship.symbol, itemToBuy, quantity)
			                 .subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
		}
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
	sellAll(contract: Contract | null, market: Market, otherShips: Bot[]) {
		if (this.ship.nav.status === 'IN_TRANSIT') {
			return
		}
		if (this.ship.cargo.units === 0) {
			return;
		}
		for (let inv of this.ship.cargo.inventory) {
			// dont sell anti matter, exotic matter or mounts
			if (inv.symbol.toUpperCase().includes('MATTER') ||
			    inv.symbol.toUpperCase().includes('MOUNT')) {
				continue;
			}
			if (inv.units <= 0) {
				continue;
			}
			if (contract) {
				const contractDeliverable = this.getContractDeliverable(inv, contract);
				if (contractDeliverable) {
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
			// make sure the market will buy this item.
			for (let item of market.tradeGoods) {
				if (item.symbol === inv.symbol) {
					this.sellCargo(inv.symbol, inv.units);
					break;
				}
			}
		}
	}
	deliverAll(contract: Contract | null) {
		if (this.ship.nav.status === 'IN_TRANSIT' || this.ship.cargo.units === 0 || !contract) {
			return;
		}
		for (let inv of this.ship.cargo.inventory) {
			if (inv.units <= 0) {
				continue;
			}
			const contractDeliverable = this.getContractDeliverable(inv, contract);
			if (!contractDeliverable) {
				continue;
			}
			if (this.ship.nav.waypointSymbol === contractDeliverable.destinationSymbol) {
				this.deliverCargo(inv.symbol, inv.units);
			} else if (this.ship.cargo.capacity == this.ship.cargo.units || 
					    inv.units >= contractDeliverable.unitsRequired - contractDeliverable.unitsFulfilled) {
				// We have a full cargo load, or all the parts we need, go to that delivery location
				const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(contractDeliverable.destinationSymbol);
				const system = this.automationService.systemsBySymbol.get(systemSymbol);
				if (system == undefined) {
					this.automationService.systemsBySymbol.set(systemSymbol, null);
					this.automationService.dbService.systems.get(systemSymbol).then((sys) => {
						if (sys) {
							this.automationService.systemsBySymbol.set(sys.symbol, sys);
						}
					});
					this.addMessage(`getting system ${systemSymbol}`);
					return; // don't proceed until we get that system back from the DB
				}
				const waypoint = system?.waypoints?.find((waypoint) => waypoint.symbol === contractDeliverable.destinationSymbol) || null;
				if (waypoint) {
					this.addMessage(`delivering goods for contract`);
					this.navigateTo(waypoint);
				}
			}
		}
	}
	getContractDeliverable(inv: ShipCargoItem, contract: Contract): ContractDeliverGood | null {
		for (let goods of contract.terms.deliver) {
			if (goods.tradeSymbol == inv.symbol) {
				const remainingUnits = goods.unitsRequired - goods.unitsFulfilled;
				if (remainingUnits === 0) {
					continue;
				}
				return goods;
			}
		}
		return null;
	}
	sellCargo(symbol: string, units: number) {
		this.dock();
		this.currentStep = new ExecutionStep(this, `sell ${units} units of ${symbol}`);
		this.fleetService.sellCargo(this.ship.symbol, symbol, units).subscribe((response) => {
			this.completeStep();
			const transaction = response.data.transaction;
			let currentPriceByTradeSymbol = this.automationService.marketService.currentPriceByTradeSymbolByWaypoint[transaction.waypointSymbol];
			if (!currentPriceByTradeSymbol) {
				currentPriceByTradeSymbol = {};
				this.automationService.marketService.currentPriceByTradeSymbolByWaypoint[transaction.waypointSymbol] = currentPriceByTradeSymbol;
			}
			currentPriceByTradeSymbol[transaction.tradeSymbol] = transaction.pricePerUnit;
		}, (error) => {
			this.onError(error);
		});
		throw this.currentStep;

	}
	transferCargo(otherShip: Ship, inv:ShipCargoItem) {
		let freeSpace = otherShip.cargo.capacity - otherShip.cargo.units;
		if (freeSpace > 0) {
			this.currentStep = new ExecutionStep(this, `transfer ${inv.units} units of ${inv.symbol} to ${otherShip.symbol}`);
			if (this.ship.nav.status != otherShip.nav.status) {
				if (otherShip.nav.status == 'IN_ORBIT') {
					this.orbit();
				} else if (otherShip.nav.status == 'DOCKED') {
					this.dock();
				}
			}
			this.fleetService.transferCargo(this.ship.symbol,
				otherShip.symbol,
				inv.symbol,
				Math.min(freeSpace, inv.units))
				.subscribe((response) => {
					this.completeStep();
				}, (error) => {
					this.onError(error);
				});
			throw this.currentStep;
		}
	}

	deliverCargo(tradeSymbol: string, units: number) {
		if (this.automationService.contract) {
			this.dock();
			this.currentStep = new ExecutionStep(this, `deliver Contract Goods`);
			this.automationService.contractService.deliverCargo(this.automationService.contract.id, tradeSymbol, units).subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}
	gatherOre(market: Market | null, otherBots: Bot[]) {
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
/*		if (market) {
			const freeSpace = this.ship.cargo.capacity - this.ship.cargo.units;
			for (let item of market.tradeGoods || []) {
				if (item.purchasePrice == 3) {
					if (item.symbol.endsWith("_ORE")) {
						this.purchaseCargo(item.symbol, freeSpace);
					}
				}
			}
		}*/
	}
	purchaseCargo(itemSymbol: string, itemQty: number) {
		this.currentStep = new ExecutionStep(this, `buying ${itemQty} of ${itemSymbol}`);
		this.fleetService.purchaseCargo(this.ship.symbol, itemSymbol, itemQty).subscribe((response) => {
			this.completeStep();
		}, (error) => {
			this.onError(error);
		});
		throw this.currentStep;
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
			this.fleetService.shipRefine(this.ship.symbol, productionType).subscribe((response) => {
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
			this.fleetService.createChart(this.ship.symbol).subscribe((response) => {
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
			this.fleetService.dockShip(this.ship.symbol).subscribe((response) => {
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
			this.fleetService.orbitShip(this.ship.symbol).subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw this.currentStep;
		}
	}

	negotiateContract() {
		if (this.automationService.agent?.headquarters == this.ship.nav.waypointSymbol) {
			this.dock();
			const step = new ExecutionStep(this, `Negotiating contract`);
			this.automationService.contractService.negotiateContract(this.ship.symbol).subscribe((response) => {
				this.completeStep();
			}, (error) => {
				this.onError(error);
			});
			throw step;
		}
	}
	exploreSystems() {
		if (this.role != Role.Explorer || !this.automationService.agent) {
			return;
		}
		const startingSystemStr = this.automationService.agent.headquarters;
		const startingSystem = this.automationService.galaxyService.getSystemBySymbol(startingSystemStr);
		const system = startingSystem;
		if (Ship.containsModule(this.ship, "MODULE_WARP_DRIVE_")) {
			// we can warp to nearby systems
		} else if (system) {
			const nextSystemSymbol = this.explorationService.exploreSystems(this.ship);
			if (nextSystemSymbol && nextSystemSymbol != this.ship.nav.systemSymbol) {
				const jumpgates = this.automationService.jumpgateService.getJumpgatesBySystemSymbol(this.ship.nav.systemSymbol);
				if (jumpgates && jumpgates.length > 0) {
					const waypoint = this.automationService.galaxyService.getWaypointByWaypointSymbol(jumpgates[0].symbol!);
					if (waypoint) {
						this.navigateTo(waypoint);
					}
					this.jumpTo(nextSystemSymbol);
				}
			}
		}
	}

	traverseWaypoints(waypoints: WaypointBase[]) {
		if (waypoints.length == 1) {
			this.navigateTo(waypoints[0]);
		}
		const loc = ExplorationService.organizeRoute(waypoints, this.ship.nav.route.destination);
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
