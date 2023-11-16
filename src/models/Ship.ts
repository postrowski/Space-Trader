import { Cooldown } from "./Cooldown";
import { ShipModule } from "./ShipModule";
import { ShipMount } from "./ShipMount";
import { ShipRegistration } from "./ShipRegistration";
import { ShipNav } from "./ShipNav";
import { ShipCrew } from "./ShipCrew";
import { ShipFuel } from "./ShipFuel";
import { ShipFrame } from "./ShipFrame";
import { ShipReactor } from "./ShipReactor";
import { ShipEngine } from "./ShipEngine";
import { ShipCargo } from "./ShipCargo";

export class Ship {
	// elements that are nullable don't exist on ShipyardShips
	symbol: string = "";
	nav: ShipNav = new ShipNav();
	crew: ShipCrew = new ShipCrew();
	cooldown: Cooldown = new Cooldown();
	fuel: ShipFuel = new ShipFuel();
	frame: ShipFrame = new ShipFrame();
	reactor: ShipReactor = new ShipReactor();
	engine: ShipEngine = new ShipEngine();
	modules: ShipModule[] = [];
	mounts: ShipMount[] = [];
	registration: ShipRegistration = new ShipRegistration();
	cargo: ShipCargo = new ShipCargo();

	public update(src: Ship) {
		this.symbol = src.symbol;
		this.nav = src.nav;
		this.crew.update(src.crew);
		this.fuel.update(src.fuel);
		this.cooldown = src.cooldown;
		this.frame.update(src.frame);
		this.reactor.update(src.reactor);
		this.engine.update(src.engine);
		this.modules = src.modules;
		this.mounts = src.mounts;
		this.registration.update(src.registration);
		this.cargo = src.cargo;
	}
	
	public static containsModule(ship: Ship, moduleStr: string): boolean {
		if (ship) {
			for (let module of ship.modules) {
				if (module.symbol.startsWith(moduleStr)) {
					return true;
				}
			}
		}
		return false;
	}
	public static containsMount(ship: Ship, mountStr: string): boolean {
		if (ship) {
			for (let mount of ship.mounts) {
				if (mount.symbol.startsWith(mountStr)) {
					return true;
				}
			}
		}
		return false;
	}
	public static getPowerAvailable(ship: Ship) {
		let power = ship.reactor.powerOutput;
		for (let mount of ship.mounts) {
			power -= mount.requirements?.power || 0;
		}
		for (let module of ship.modules) {
			power -= module.requirements?.power || 0;
		}
		power -= ship.engine.requirements?.power || 0;
		power -= ship.frame.requirements?.power || 0;
		return power;
	}

	public static getCrewAvailable(ship: Ship) {
		return ship.crew.capacity - ship.crew.required;
	}

	public static getTravelTime(ship: Ship, travelSpeed: string, dist: number) {
		let mult = 1000;
		if (travelSpeed == 'DRIFT') mult = 250;
		else if (travelSpeed == 'CRUISE')  mult = 25;
		else if (travelSpeed == 'BURN')    mult = 7.5;
		else if (travelSpeed == 'STEALTH') mult = 30;
		return Math.floor(Math.round(Math.max(1, dist)) * mult / ship.engine.speed) + 15;
	}
}

