import { LocXY } from "src/models/LocXY";
import { System } from "src/models/System";
import { WaypointBase } from "src/models/WaypointBase";

export class UiWaypoint {
	loc: LocXY = new LocXY(0,0);
	orbitCenter: LocXY = new LocXY(0,0);
	textLoc: LocXY = new LocXY(0,0);
	orbitRadius: number = 0;
	orbits: UiWaypoint | null = null;
	orbitalPosition: number = 0;
	orbitals: UiWaypoint[] = [];
	base!: WaypointBase;
	fillColor!: string;
	edgeColor!: string;
	textColor!: string;
	orbitColor!: string;
	overTextColor!: string;
	
	public static getUiWaypointsFromSystem(system: System | null | undefined): UiWaypoint[] {
		if (!system?.waypoints) {
			return [];
		}
		const waypointMap = new Map<string, UiWaypoint>();
		// Create UiWaypoint objects for each waypoint, and put them all in a map by symbol
		for (const waypoint of system.waypoints) {
			const wp :UiWaypoint = {
				loc: new LocXY(waypoint.x, waypoint.y),
				orbitCenter: new LocXY(0,0),
				textLoc: new LocXY(0,0),
				orbitRadius: Math.sqrt(waypoint.x*waypoint.x + waypoint.y*waypoint.y),
				orbits: null,
				orbitalPosition: 0,
				orbitals: [],
				base: waypoint,
				fillColor: this.getFillColor(waypoint),
				edgeColor: this.getEdgeColor(waypoint),
				textColor: this.getTextColor(waypoint),
				orbitColor: this.getTextColor(waypoint),
				overTextColor: this.invertColor(this.getFillColor(waypoint))
			}
			waypointMap.set(waypoint.symbol, wp);
		}
		// setup the orbital links and orbital positions of each waypoint:
		for (let waypoint of system.waypoints) {
			const uiWaypoint = waypointMap.get(waypoint.symbol);
			if (uiWaypoint) {
				if (waypoint.orbits) {
					uiWaypoint.orbits = waypointMap.get(waypoint.orbits)!;
				}
				if (waypoint.orbitals) {
					let orbitalPosition = 1;
					for (let orbital of waypoint.orbitals) {
						const uiOrbital = waypointMap.get(orbital.symbol);
						if (uiOrbital) {
							uiOrbital.orbitalPosition = orbitalPosition++;
							uiWaypoint.orbitals.push(uiOrbital);
						}
					}
				}
			}
		}
		// find all the non-orbiting waypoints, and recursively compute the location
		// of each of their orbitals:
		for (let waypoint of system.waypoints) {
			const uiWaypoint = waypointMap.get(waypoint.symbol);
			if (uiWaypoint && uiWaypoint.orbits == null) {
				this.getLocOfOrbit(uiWaypoint);
			}
		}
		// Finally, now that each waypoint is positioned, establish the orbital center and
		// radius for each waypoint, and put them in the uiWaypoints map
		const uiWaypoints = [];
		for (let waypoint of system.waypoints) {
			const uiWaypoint = waypointMap.get(waypoint.symbol);
			if (uiWaypoint) {
				if (uiWaypoint.orbits) {
					uiWaypoint.orbitCenter = uiWaypoint.orbits.loc;
					const dx = uiWaypoint.loc.x - uiWaypoint.orbits.loc.x;
					const dy = uiWaypoint.loc.y - uiWaypoint.orbits.loc.y;
					uiWaypoint.orbitRadius = Math.sqrt(dx * dx + dy * dy);
				}
				uiWaypoints.push(uiWaypoint);
			}
		}
		return uiWaypoints;
	}
	static invertColor(rgb: string) : string {
		// Remove the '#' character from the input
		rgb = rgb.slice(1);

		// Check if it's a 3-digit or 6-digit RGB
		if (rgb.length === 3) {
			// Expand the 3-digit RGB to 6-digit format
			rgb = rgb
				.split('')
				.map(char => char.repeat(2))
				.join('');
		}

		// Parse the hex color code and invert it
		let invertedColor = (0xFFFFFF ^ parseInt(rgb, 16)).toString(16);

		// Ensure the inverted color has 6 digits (RGB format)
		while (invertedColor.length < 6) {
			invertedColor = '0' + invertedColor;
		}

		// Add the '#' character back to the inverted color
		return '#' + invertedColor;
	}
	
	static getFillColor(waypoint: WaypointBase): string {
		return WaypointBase.getWaypointType(waypoint)?.fillColor || '#FFFFFF';
	}
	static getTextColor(waypoint: WaypointBase): string {
		return WaypointBase.getWaypointType(waypoint)?.textColor || '#FFFFFF';
	}
	static getEdgeColor(waypoint: WaypointBase): string {
		return WaypointBase.getWaypointType(waypoint)?.edgeColor || '#FFFFFF';
	}
	static getSize(waypoint: WaypointBase): number{
		return WaypointBase.getWaypointType(waypoint)?.size || 1;
	}

	static getLocOfOrbit(uiWaypoint: UiWaypoint): void {
		if (uiWaypoint.orbits) {
			const total = uiWaypoint.orbits.orbitals.length || 0;
			const baseSize = this.getSize(uiWaypoint.orbits.base);
			const offset = this.getIndexOffset(uiWaypoint.orbitalPosition, total, baseSize);
			this.moveWaypointAndOrbitals(uiWaypoint, offset.x, offset.y);
		}
		for (const orbital of uiWaypoint.orbitals) {
			this.getLocOfOrbit(orbital);
		}
	}
	static moveWaypointAndOrbitals(uiWaypoint: UiWaypoint, x: number, y: number) {
		uiWaypoint.loc.x += x;
		uiWaypoint.loc.y += y;
		for (const orbital of uiWaypoint.orbitals) {
			this.moveWaypointAndOrbitals(orbital, x, y);
		}
	}
	static anglesByOrbit: number[][] = [
		[10],
		[-30, 45], // 75
		[-60, 15, 110],	// 75, 95
		[-100, -45, 20, 80], //55. 65, 60
		[-120, -60,  0, 45, 100], // 60, 60, 45, 55
		[-135, -80, -20, 30, 90, 150], // 55, 60, 50, 60, 60
		[-145, -90, -35, 15, 60, 100, 160], // 55, 55, 50, 45, 40, 60
		[-150, -110, -75, -20, 25, 70, 110, 160] // 40, 35, 55, 45, 45, 40, 50
		];	
	static getIndexOffset(index: number, total: number, size: number): {x:number, y: number} {
		const angle = this.anglesByOrbit[total][index];
		// Calculate x and y
		const x = (size/2+index) * Math.cos(angle * (Math.PI / 180))/2;
		const y = (size/2+index) * Math.sin(angle * (Math.PI / 180))/2;
		return {x, y};
	}
	
}
