import { ShipNavRouteWaypoint } from "./ShipNavRouteWaypoint";

export class Waypoint extends ShipNavRouteWaypoint {
	faction!: WaypointFaction;
}
export class WaypointFaction {
	symbol!: String;
}
