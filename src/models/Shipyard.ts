import { ShipyardShip } from "./ShipyardShip";
import { ShipyardTransaction } from "./ShipyardTransaction";

export class Shipyard {
  symbol!: string;
  shipTypes: ShipyardType[] = [];
  transactions: ShipyardTransaction[] =[];
  ships: ShipyardShip[] = [];
  modificationsFee!: number;
}

export class ShipyardType {
	type!: string
}