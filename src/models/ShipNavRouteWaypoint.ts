import { WaypointBase } from "./WaypointBase";

export class ShipNavRouteWaypoint extends WaypointBase {
	systemSymbol: string = "";
	
	public override update(src: ShipNavRouteWaypoint) {
		super.update(src);
		this.systemSymbol = src.systemSymbol;
	}
}
