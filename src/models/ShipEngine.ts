import { ShipRequirements } from "./ShipRequirements";

export class ShipEngine {
	symbol: string = "";
	name: string = "";
	description: string = "";
	condition: number = 0;
	speed: number = 0;
	requirements: ShipRequirements = new ShipRequirements();
	
	public update(src: ShipEngine) {
		this.symbol = src.symbol;
		this.name = src.name;
		this.description = src.description;
		this.condition = src.condition;
		this.speed = src.speed;
		this.requirements.update(src.requirements);
	}
};
