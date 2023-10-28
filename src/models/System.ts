import { LocXY } from "./LocXY";
import { WaypointBase } from "./WaypointBase";

export class System extends LocXY {
	symbol!: string;
	sectorSymbol!: string;
	type!: string;
	waypoints: WaypointBase[] | null = null
	factions: SystemFaction[] = [];
	
	public static update(src: System, dest: System) {
		dest.update(src);
		dest.symbol = src.symbol;
		dest.sectorSymbol = src.sectorSymbol;
		dest.type = src.type;
		dest.waypoints = src.waypoints;
		dest.factions = src.factions;
	}
	
	public static hasShipyard(system: System): boolean {
		return system.waypoints && system.waypoints.some((waypoint) => {
			return WaypointBase.hasShipyard(waypoint);
		}) || false;
	}
	public static hasMarketplace(system: System): boolean {
		return system.waypoints && system.waypoints.some((waypoint) => {
			return WaypointBase.hasMarketplace(waypoint);
		}) || false;
	}
	public static hasJumpGate(system: System): boolean {
		return system.waypoints && system.waypoints.some((waypoint) => {
			return WaypointBase.isJumpGate(waypoint);
		}) || false;
	}
	public static hasAsteroidField(system: System): boolean {
		return system.waypoints && system.waypoints.some((waypoint) => {
			return WaypointBase.isAsteroidField(waypoint);
		}) || false;
	}
	public static hasAsteroidMarket(system: System): boolean {
		return system.waypoints && system.waypoints.some((waypoint) => {
			return WaypointBase.isAsteroidField(waypoint) && WaypointBase.hasMarketplace(waypoint);
		}) || false;
	}
	public static hasUncharted(system: System): boolean {
		if (system.waypoints == null) {
			return true;
		}
		return system.waypoints.some((waypoint) => {
			return WaypointBase.hasUncharted(waypoint);
		}) || false;
	}

}

export class SystemFaction {
	symbol!: String;
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
export const SystemTypeAttributes: Record<SystemType, { size:number, fillColor: string, edgeColor: string, textColor: string }> = {
	[SystemType.NEUTRON_STAR]: { size:  3, fillColor: '#FFF', edgeColor: '#F00', textColor: '#FFF' },
	[SystemType.RED_STAR]:     { size:  8, fillColor: '#F00', edgeColor: '#F44', textColor: '#F44' },
	[SystemType.ORANGE_STAR]:  { size:  8, fillColor: '#FA0', edgeColor: '#FD4', textColor: '#FA0' },
	[SystemType.BLUE_STAR]:    { size:  8, fillColor: '#00F', edgeColor: '#44F', textColor: '#44F' },
	[SystemType.YOUNG_STAR]:   { size:  8, fillColor: '#FF4', edgeColor: '#F00', textColor: '#FF4' },
	[SystemType.WHITE_DWARF]:  { size:  4, fillColor: '#888', edgeColor: '#FFF', textColor: '#AAA' },
	[SystemType.BLACK_HOLE]:   { size:  5, fillColor: '#000', edgeColor: '#444', textColor: '#800' },
	[SystemType.HYPERGIANT]:   { size: 20, fillColor: '#833', edgeColor: '#000', textColor: '#F88' },
	[SystemType.NEBULA]:       { size: 15, fillColor: '#44F', edgeColor: '#FFF', textColor: '#44F' },
	[SystemType.UNSTABLE]:     { size: 15, fillColor: '#444', edgeColor: '#FFF', textColor: '#888' },
};