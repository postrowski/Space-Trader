import { Transaction } from "./Transaction";

export class ShipyardTransaction extends Transaction {
	price!: number;
	agentSymbol!: string;
}