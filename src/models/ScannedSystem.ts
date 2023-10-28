import { LocXY } from "./LocXY";

export class ScannedSystem extends LocXY {
  symbol!: string;
  sectorSymbol!: string;
  type!: string;
  distance!: number;
}

export enum SystemType {
	NEUTRON_STAR,
	RED_STAR,
	ORANGE_STAR,
	BLUE_STAR,
	YOUNG_STAR,
	WHITE_DWARF,
	BLACK_HOLE,
	HYPERGIANT,
	NEBULA,
	UNSTABLE
}