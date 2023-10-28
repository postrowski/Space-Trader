export class Agent {
	accountId!: string;
	symbol!: string;
	headquarters!: string;
	credits!: number;
	startingFaction!: string;
	shipCount?: number;

	public update(src: Agent) {
		this.accountId = src.accountId;
		this.symbol = src.symbol;
		this.headquarters = src.headquarters;
		this.credits = src.credits
		this.startingFaction = src.startingFaction;
		this.shipCount = src.shipCount;
	}
}
