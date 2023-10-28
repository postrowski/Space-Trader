import { ShipNav } from "./ShipNav";
import { ShipRegistration } from "./ShipRegistration";

export class ScannedShip {
  symbol!: string;
  registration!: ShipRegistration;
  nav!: ShipNav;
  frame!: ScannedShipSymbol;
  reactor!: ScannedShipSymbol;
  engine!: ScannedShipSymbol;
  mounts: ScannedShipSymbol[] = [];
}

export class ScannedShipSymbol {
    symbol!: string;
}
