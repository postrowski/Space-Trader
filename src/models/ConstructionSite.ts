export class ConstructionSite {
	symbol!: string;
	materials: ConstructionMaterial[] = [];
	isComplete: boolean = false;
}
export class ConstructionMaterial {
	tradeSymbol!: string;
	required!: number;
	fulfilled!: number;
}