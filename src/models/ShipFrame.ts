import { ShipRequirements } from "./ShipRequirements";

export class ShipFrame {
	symbol: string = "";
	name: string = "";
	description: string = "";
	moduleSlots: number = 0;
	mountingPoints: number = 0;
	fuelCapacity: number = 0;
	condition: number = 0;
	requirements: ShipRequirements = new ShipRequirements();

	public update(src: ShipFrame) {
		this.symbol = src.symbol;
		this.name = src.name;
		this.description = src.description;
		this.moduleSlots = src.moduleSlots;
		this.mountingPoints = src.mountingPoints;
		this.fuelCapacity = src.fuelCapacity;
		this.condition = src.condition;
		this.requirements.update(src.requirements);
	}
}

