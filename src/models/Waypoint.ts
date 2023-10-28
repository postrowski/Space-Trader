import { Chart } from "./Chart";
import { ShipNavRouteWaypoint } from "./ShipNavRouteWaypoint";

export class Waypoint extends ShipNavRouteWaypoint {
	faction!: WaypointFaction;
	chart!: Chart;
}
export class WaypointFaction {
	symbol!: String;
}
