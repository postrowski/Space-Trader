import { ShipNavRouteWaypoint } from "./ShipNavRouteWaypoint";

export class ShipNavRoute {
	departure: ShipNavRouteWaypoint = new ShipNavRouteWaypoint(0, 0); // deprecated!
	origin: ShipNavRouteWaypoint = new ShipNavRouteWaypoint(0, 0);
	destination: ShipNavRouteWaypoint = new ShipNavRouteWaypoint(0, 0);
	arrival: string = "";
	departureTime: string = "";
	
	public update(src: ShipNavRoute) {
		this.departure.update(src.departure);
		this.origin.update(src.origin);
		this.destination.update(src.destination);
		this.arrival = src.arrival;
		this.departureTime = src.departureTime;
	}

}
