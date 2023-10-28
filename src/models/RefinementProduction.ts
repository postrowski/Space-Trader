import { Cooldown } from "./Cooldown";
import { ShipCargo } from "./ShipCargo";

export class RefinementProduction {
    cargo!: ShipCargo;
    cooldown!: Cooldown;
    produced: RefinementProductionItem[] = [];
    consumed: RefinementProductionItem[] = [];
}

export class RefinementProductionItem {
	tradeSymbol!: string;
	units: number = 0
}
