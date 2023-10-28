import { ShipCargoItem } from "./ShipCargoItem";
import { ShipRequirements } from "./ShipRequirements";

export class ShipCargo {
    capacity: number = 0;
    units: number = 0;
    inventory: ShipCargoItem[] = []; // Define the structure of the inventory item as needed

	public update(src: ShipCargo) {
		this.capacity = src.capacity;
		this.units = src.units;
		this.inventory = src.inventory;
	}
}

