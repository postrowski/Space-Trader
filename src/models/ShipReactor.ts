import { ShipRequirements } from "./ShipRequirements";

export class ShipReactor {
	symbol: string = "";
	name: string = "";
	description: string = "";
	condition: number = 0;
	powerOutput: number = 0;
	requirements: ShipRequirements = new ShipRequirements();
	
	public update(src: ShipReactor) {
		this.symbol = src.symbol;
		this.name = src.name;
		this.description = src.description;
		this.condition = src.condition;
		this.powerOutput = src.powerOutput;
		this.requirements.update(src.requirements);
	}
};

export enum ShipReactorSymbol {
	REACTOR_SOLAR_I,
	REACTOR_FUSION_I,
	REACTOR_FISSION_I,
	REACTOR_CHEMICAL_I,
	REACTOR_ANTIMATTER_I
}