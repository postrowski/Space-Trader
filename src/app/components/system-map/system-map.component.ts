import { Component } from '@angular/core';
import { ModalService } from 'src/app/services/modal.service';
import { SvgMap } from 'src/app/utils/svg-map';
import { UiWaypoint } from 'src/app/utils/ui-waypoint';
import { LocXY } from 'src/models/LocXY';
import { Ship } from 'src/models/Ship';
import { System, SystemType, SystemTypeAttributes } from 'src/models/System';
import { WaypointBase } from 'src/models/WaypointBase';
import { FleetService } from '../../services/fleet.service';
import { GalaxyService } from '../../services/galaxy.service';

@Component({
	selector: 'app-system-map',
	templateUrl: './system-map.component.html',
	styleUrls: ['./system-map.component.css']
})
export class SystemMapComponent extends SvgMap {

	uiWaypoints: UiWaypoint[] = [];
	shipsBySymbol = new Map<string, Ship>();
	_system: System | null | undefined = null;
	starField: {x: number, y: number, size: number, color: string}[] = [];
	selectedWaypoint: UiWaypoint | null = null;
	selectedShip: Ship | null = null;
	shipLocBySymbol: { [shipSymbol: string]: {system: string, loc: LocXY} } = {};
	shipLocInSystemBySymbol: { [shipSymbol: string]: {system: string, loc: LocXY} } = {};

	constructor(public galaxyService: GalaxyService,
	            public fleetService: FleetService,
	            public modalService: ModalService) {
		super();
		super.componentName = "system-map-svg";
		this.galaxyService.activeSystemWaypoint$.subscribe((waypoint) => {
			for (let uiWaypoint of this.uiWaypoints) {
				if (uiWaypoint.base.symbol == waypoint?.symbol) {
					this.selectedWaypoint = uiWaypoint;
					this.centerOnLocation(uiWaypoint.loc.x, uiWaypoint.loc.y);
					break;
				}
			}
		});
		this.galaxyService.activeSystem$.subscribe((system) => {
			this.system = system;
			this.updateShipLocsInSystem();
		});
		this.fleetService.activeShip$.subscribe((ship) => {
			this.selectedShip = ship;
		});
		this.fleetService.shipLocations$.subscribe((shipLocBySymbol) => {
			this.shipLocBySymbol = shipLocBySymbol;
			this.updateShipLocsInSystem();
		});
		this.fleetService.allShips$.subscribe((ships) => {
			for (const ship of ships) {
				this.shipsBySymbol.set(ship.symbol, ship);
			}
			this.updateShipLocsInSystem();
		});

		
		for (let i = 0; i < 600; i++) {
			const x = Math.random() * this.width;
			const y = Math.random() * this.height;
			const size = .3 + Math.random() * .7;
			const color = this.rgbToHex(128+ Math.random() * 127,
										128 + Math.random() * 127,
										128 + Math.random() * 127);
			this.starField.push({ x, y, size, color});
		}
		this.startAnimationOffset();
	}

	get system(): System | null | undefined{
		return this._system;
	}
	set system(value: System | null | undefined) {
		// Custom logic to execute when ship is set
		this._system = value;
		this.selectedWaypoint = null;
		// recompute the scale for this system:
		if (this._system?.waypoints?.length) {
			const max = this._system.waypoints.reduce((maxValue, waypoint) => {
				const x = Math.abs(waypoint.x);
				const y = Math.abs(waypoint.y);
				return Math.max(maxValue, x, y);
			}, 0);
			this.baseScale = this.scale = (Math.max(this.width, this.height)/2) / (max + 10);
		} else {
			this.baseScale = this.scale = 1;
		}
		this.xOffset = this.width/2;
		this.yOffset = this.height/2;
		this.objectScale = .25;
		this.uiWaypoints = UiWaypoint.getUiWaypointsFromSystem(this._system);
		this.updateShipLocsInSystem();
	}
	
	private startAnimationOffset() {
		if (this.animationInterval) {
			clearInterval(this.animationInterval);
		}
		const animationStartTime = Date.now();
		this.animationInterval = setInterval(() => {
			const elapsedTime = Date.now() - animationStartTime;
			const patternDuration = 1000; // repeat pattern every 1 seconds;
			const delta = elapsedTime % patternDuration;
			const percent = delta / patternDuration;
			this.animationOffset = percent * this.cycleLength;
		}, 200);
	}
	animationInterval: any;
	animationOffset = 0;
	cycleLength = 20;

	updateShipLocsInSystem() {
		this.shipLocInSystemBySymbol = {};
		for (const [key, value] of Object.entries(this.shipLocBySymbol)) {
			if (value.system === this.system?.symbol) {
				this.shipLocInSystemBySymbol[key] = value;
			}
		}
	}
	
	rgbToHex(r: number, g: number, b: number): string {
		return `#${(1 << 24 | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
	}

	getShipDest(shipSymbol: string): LocXY | null{
		const ship = this.fleetService.getShipBySymbol(shipSymbol);
		if (ship && ship.nav.status == 'IN_TRANSIT') {
			// Only show the dashed line if the ship is moving within this system: 
			if (ship.nav.route.destination.systemSymbol == ship.nav.route.origin.systemSymbol) {
				for (let uiWaypoint of this.uiWaypoints) {
					if (uiWaypoint.base.symbol == ship.nav.route.destination.symbol) {
						return uiWaypoint.loc;
					}
				}
				return ship.nav.route.destination;
			}
		}
		return null;
	}
	shipTextSize() : number{
		return 10 * Math.sqrt(this.objectScale);
	}
	getDashArray(shipSymbol: string) {
		const ship = this.shipsBySymbol.get(shipSymbol);
		let speed = 1;
		if (ship && ship.nav.status == 'IN_TRANSIT') {
			if (ship.nav.flightMode == 'DRIFT') speed = 1;
			if (ship.nav.flightMode == 'STEALTH') speed = 2;
			if (ship.nav.flightMode == 'CRUISE') speed = 4;
			if (ship.nav.flightMode == 'BURN') speed  = 10;
		}
		return speed + ', ' + (this.cycleLength - speed);
	}
	shipColor(shipSymbol: string) {
		const ship = this.shipsBySymbol.get(shipSymbol);
		if (ship) {
			const frame = ship.frame.name.toLowerCase();
			if (frame.includes('frigate')) return '#FFFFFF';
			if (frame.includes('freighter')) return '#44FFBB';
			if (frame.includes('probe')) return '#FF44BB';
			if (frame.includes('drone') && Ship.containsMount(ship, 'MOUNT_SURVEYOR')) return '#BB44FF';
			if (frame.includes('drone') && Ship.containsMount(ship, 'MOUNT_GAS_SIPHON')) return '#BBFF44';
			if (frame.includes('drone') && Ship.containsMount(ship, 'MOUNT_MINING_LASER')) return '#44BBFF';
		}
		return '#FFBB44';
	}
	getTextAngle(shipSymbol: string) {
		const ship = this.shipsBySymbol.get(shipSymbol);
		if (ship) {
			const frame = ship.frame.name.toLowerCase();
			if (frame.includes('frigate')) return -10;
			if (frame.includes('freighter')) return -20;
			if (frame.includes('probe')) return -40;
			if (frame.includes('drone') && Ship.containsMount(ship, 'MOUNT_SURVEYOR')) return -50;
			if (frame.includes('drone') && Ship.containsMount(ship, 'MOUNT_GAS_SIPHON')) return -30;
			if (frame.includes('drone') && Ship.containsMount(ship, 'MOUNT_MINING_LASER')) return -30;
		}
		return 15;
	}
	onSelectShipBySymbol(symbol: string) {
		const ship = this.fleetService.getShipBySymbol(symbol);
		if (ship) {
			this.fleetService.setActiveShip(ship);
		}
	}
	getShipLocation() : LocXY | null {
		if (this.selectedShip == null) {
			return null;
		}
		if (this.selectedShip.nav.systemSymbol !== this._system?.symbol) {
			return null;
		}
		 //javascript, how do I convert a string like '2019-08-24T14:15:22Z' into a local datetime
		 
		const departure = new Date(this.selectedShip.nav.route.departureTime);
		const arrival   = new Date(this.selectedShip.nav.route.arrival);
		const now   = new Date();
		const totalTripDurationMilliseconds = (arrival.getTime() - departure.getTime());
		const tripDurationSoFarMilliseconds = (now.getTime() - departure.getTime());
		let percentComplete = 0.0;
		if (totalTripDurationMilliseconds > 0) {
			percentComplete = 1.0 * tripDurationSoFarMilliseconds / totalTripDurationMilliseconds;
			if (percentComplete > 1) {
				percentComplete = 1;
			}
		} 
		const departureLoc = this.selectedShip.nav.route.origin;
		const destinationLoc = this.selectedShip.nav.route.destination;
		const curLoc = new LocXY(
			(destinationLoc.x - departureLoc.x) * percentComplete + departureLoc.x,
			(destinationLoc.y - departureLoc.y) * percentComplete + departureLoc.y
		);
		return curLoc;
	}

	onLoadAllWaypoints() {
		if (this._system != null) {
			this.galaxyService.getAllWaypoints(this._system.symbol);
		}
	}
	onScanWaypoints(ship: Ship) {
		this.fleetService.scanWaypoints(ship.symbol).subscribe((response) => {
			if (this._system != null) {
				for (let waypoint of response.data.waypoints) {
					let found = false;
					for (let sysWaypoint of this._system.waypoints || []) {
						if (sysWaypoint.symbol === waypoint.symbol) {
							found = true;
							if (waypoint.traits && waypoint.traits.length > (sysWaypoint.traits?.length || 0)) {
								sysWaypoint.traits = waypoint.traits;
							}
							if (waypoint.orbitals && waypoint.orbitals.length > (sysWaypoint.orbitals?.length || 0)) {
								sysWaypoint.orbitals = waypoint.orbitals;
							}
							break;
						}
					}
					if (!found) {
						if (this._system.waypoints == null) {
							this._system.waypoints = [];
						}
						this._system.waypoints.push(waypoint);
					}
				}
			}
		});
	}
	
	getSystemType() {
		const matchingKey = SystemType[this._system?.type as keyof typeof SystemType];
		if (matchingKey !== undefined) {
			const systemType = matchingKey as SystemType;
			return SystemTypeAttributes[systemType];
		}
		return undefined;
	}
	getSystemSize() {
		const type = this.getSystemType();
		return (type ? type?.size : 1) * this.objectScale;
	}
	getSystemFillColor() {
		return this.getSystemType()?.fillColor;
	}
	getSystemEdgeColor() {
		return this.getSystemType()?.edgeColor;
	}
	
	getSize(waypoint: WaypointBase): number{
		const type = WaypointBase.getWaypointType(waypoint);
		return (type ? type?.size : 1)* this.objectScale;
	}
	
	systemClick(waypoint: UiWaypoint) {
		this.galaxyService.setActiveSystemWaypoint(waypoint.base);
	}
	getTextAnchor(waypoint: WaypointBase) : string {
		if (WaypointBase.isOrbitalStation(waypoint)) {
			return 'end';
		}
		if (WaypointBase.isJumpGate(waypoint)) {
			return 'end';
		}
		if (WaypointBase.isMoon(waypoint)) {
			return '';
		}
		return 'middle';
	}
	getFontSize(waypoint: WaypointBase): number {
		
		let size = this.getSize(waypoint);
		if (size == this.objectScale) {
			size *=2;
		}
		return size/2 + 9;
	}
	getTextLocationOffset(waypoint: WaypointBase) : LocXY {
		let objectSize = this.getSize(waypoint);
		let fontSize = this.getFontSize(waypoint);
		// Start out at the center below the object
		if (waypoint.type === 'ORBITAL_STATION') {
			return new LocXY(-3, -2 -objectSize/2);
		}
		if (waypoint.type === 'JUMP_GATE') {
			return new LocXY(0, -5 -objectSize/2);
		}
		if (waypoint.type === 'MOON' && this._system) {
			return new LocXY(1 + objectSize/2, -objectSize/2);
		}
		return new LocXY(0, objectSize + fontSize);
	}
	
	hasMarketplace(waypoint: WaypointBase | null) {
		return WaypointBase.hasMarketplace(waypoint);
	}
	hasShipyard(waypoint: WaypointBase | null) {
		return WaypointBase.hasShipyard(waypoint);
	}
	isJumpGate(waypoint: WaypointBase | null) {
		return WaypointBase.isJumpGate(waypoint);
	}
	isOrbitalStation(waypoint: WaypointBase | null) {
		return WaypointBase.isOrbitalStation(waypoint);
	}
	hasUncharted(waypoint: WaypointBase | null) {
		return WaypointBase.hasUncharted(waypoint);
	}

	darkenColor(htmlColor: string, factor: number) : string {
	    let hex = htmlColor.replace(/^#/, ''); // Remove the leading #
		if (hex.length === 3) {
			// Expand the 3-digit RGB to 6-digit format
			hex = hex
				.split('')
				.map(char => char.repeat(2))
				.join('');
		}
	    const bigint = parseInt(hex, 16);
	    const r = (bigint >> 16) & 255;
	    const g = (bigint >> 8) & 255;
	    const b = bigint & 255;
	    
	    return this.rgbToHex(Math.floor(r/factor),
	    					 Math.floor(g/factor),
	    					 Math.floor(b/factor));
	}
	
	getShadowColor(waypoint: UiWaypoint) {
		return this.darkenColor(waypoint.fillColor, 5);
	}
	getShadow(waypoint: UiWaypoint) {
		const cx = this.xOffset + waypoint.loc.x * this.scale;
		const cy = this.yOffset + waypoint.loc.y * this.scale;
		const r = this.getSize(waypoint.base);
		return `M${cx+r} ${cy} A${r} ${r} 0 0 1 ${cx-r} ${cy}`;
 	}
 	getShadowTransform(waypoint: UiWaypoint) {
		const cx = this.xOffset + waypoint.loc.x * this.scale;
		const cy = this.yOffset + waypoint.loc.y * this.scale;
		const r = this.getSize(waypoint.base);
		const angle = this.calculateAngle(waypoint.loc.x, 0-waypoint.loc.y) + 180;
		return `rotate(${angle}, ${cx}, ${cy})`;
	}
	calculateAngle(x: number, y: number): number {
		// Calculate the angle in radians using Math.atan2
		const angleRadians = Math.atan2(x, y);

		// Convert radians to degrees
		return angleRadians * (180 / Math.PI);
	}
	onScale(): void {
	}
}
