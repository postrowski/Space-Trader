import { ShipNavRoute } from "./ShipNavRoute";

export class ShipNav {
	systemSymbol: string = "";
	waypointSymbol: string = "";
	route: ShipNavRoute = new ShipNavRoute();
	status: string = "DOCKED";
	flightMode: string = "CRUISE";
	
	public update(src: ShipNav) {
		this.systemSymbol = src.systemSymbol;
		this.waypointSymbol = src.waypointSymbol;
		this.route.update(src.route);
		this.status = src.status;
		this.flightMode = src.flightMode;
	}
}
export enum ShipNavStatus {
	IN_TRANSIT,
	IN_ORBIT,
	DOCKED
}
export enum ShipNavFlightMode {
	DRIFT,
	STEALTH,
	CRUISE,
	BURN
}