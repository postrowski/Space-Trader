import { ShipCrew } from "./ShipCrew";
import { ShipEngine } from "./ShipEngine";
import { ShipFrame } from "./ShipFrame";
import { ShipModule } from "./ShipModule";
import { ShipMount } from "./ShipMount";
import { ShipReactor } from "./ShipReactor";

export class ShipyardShip {
	type!: string;
	name!: string;
	description!: string;
	purchasePrice!: number;
	frame!: ShipFrame;
	reactor!: ShipReactor;
	engine!: ShipEngine;
	modules: ShipModule[] = [];
	mounts: ShipMount[] = [];
	crew!: ShipCrew;
}
