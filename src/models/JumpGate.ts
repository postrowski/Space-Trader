import { ConnectedSystem } from "./ConnectedSystem";

export class JumpGate {
	symbol?: string;
	jumpRange!: number;
	factionSymbol!: string;
	connectedSystems: ConnectedSystem[] = [];
}