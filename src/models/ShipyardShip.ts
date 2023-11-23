import { ShipBase } from "./Ship";

export class ShipyardShip extends ShipBase{
	type!: string;
	name!: string;
	description!: string;
	purchasePrice!: number;
}

