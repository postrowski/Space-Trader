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

export class ShipBase  {
	frame: ShipFrame = new ShipFrame();
	reactor: ShipReactor = new ShipReactor();
	engine: ShipEngine = new ShipEngine();
	modules: ShipModule[] = [];
	mounts: ShipMount[] = [];
	crew: ShipCrew = new ShipCrew();

	public static containsModule(ship: ShipBase, moduleStr: string): boolean {
		if (ship) {
			for (let module of ship.modules) {
				if (module.symbol.startsWith(moduleStr)) {
					return true;
				}
			}
		}
		return false;
	}
	public static containsMount(ship: ShipBase, mountStr: string): boolean {
		if (ship) {
			for (let mount of ship.mounts) {
				if (mount.symbol.startsWith(mountStr)) {
					return true;
				}
			}
		}
		return false;
	}
	public static getPowerAvailable(ship: ShipBase) {
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

	public static getCrewAvailable(ship: ShipBase) {
		return ship.crew.capacity - ship.crew.required;
	}

	public static getTravelTime(ship: ShipBase, travelSpeed: string, dist: number) {
		let mult = 1000;
		if (travelSpeed == 'DRIFT') mult = 250;
		else if (travelSpeed == 'CRUISE')  mult = 25;
		else if (travelSpeed == 'BURN')    mult = 12.5;
		else if (travelSpeed == 'STEALTH') mult = 30;
		return Math.floor(Math.round(Math.max(1, dist)) * mult / ship.engine.speed) + 15;
	}
	public static getFuelUsed(ship: ShipBase, travelSpeed: string, dist: number) {
		if (travelSpeed == 'DRIFT') return 1;
		if (travelSpeed == 'BURN') return 2*dist;
		return dist;
	}
}

export class Ship extends ShipBase {
	// elements that are nullable don't exist on ShipyardShips
	symbol: string = "";
	nav: ShipNav = new ShipNav();
	cooldown: Cooldown = new Cooldown();
	fuel: ShipFuel = new ShipFuel();
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
}

