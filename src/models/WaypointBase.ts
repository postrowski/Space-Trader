import { LocXY } from "./LocXY";
import { Trait } from "./Trait";

export class WaypointBase extends LocXY {
	symbol: string = "";
	type: string = "PLANET"; // a SystemWaypointType
	orbitals?: SystemOrbital[] = undefined;
	orbits?: string;
	traits?: Trait[] = undefined;
	
	public override update(src: WaypointBase) {
		super.update(src);
		this.symbol = src.symbol;
		this.type = src.type;
		this.orbitals = src.orbitals;
		this.orbits = src.orbits;
		this.traits = src.traits;
	}
	
	public static getWaypointType(waypoint: WaypointBase) {
		const matchingKey = WaypointType[waypoint.type as keyof typeof WaypointType];
		if (matchingKey !== undefined) {
			const waypointType = matchingKey as WaypointType;
			return WaypointTypeAttributes[waypointType];
		}
		return undefined; // Handle the case where the type is not found
	}

	public static hasTrait(waypoint: WaypointBase | null, type: WaypointTrait) {
		if (waypoint?.traits) {
			const traitSymbol = WaypointTrait[type];
			for (let trait of waypoint.traits) {
				if (trait.symbol == traitSymbol) {
					return true;
				}
			}
		}
		return false;
	}

	public static hasMarketplace(waypoint: WaypointBase | null) {
		return WaypointBase.hasTrait(waypoint, WaypointTrait.MARKETPLACE);
	}
	public static hasShipyard(waypoint: WaypointBase | null) {
		return WaypointBase.hasTrait(waypoint, WaypointTrait.SHIPYARD);
	}
	public static hasUncharted(waypoint: WaypointBase | null) {
		return WaypointBase.hasTrait(waypoint, WaypointTrait.UNCHARTED);
	}
	public static isJumpGate(waypoint: WaypointBase | null) {
		return waypoint?.type == WaypointType[WaypointType.JUMP_GATE];
	}
	public static isOrbitalStation(waypoint: WaypointBase | null) {
		return waypoint?.type == WaypointType[WaypointType.ORBITAL_STATION];
	}
	public static isMoon(waypoint: WaypointBase | null) {
		return waypoint?.type == WaypointType[WaypointType.MOON];
	}
	public static isAsteroidField(waypoint: WaypointBase | null) {
		return waypoint?.type == WaypointType[WaypointType.ASTEROID_FIELD];
	}
	public static isDebrisField(waypoint: WaypointBase | null) {
		return waypoint?.type == WaypointType[WaypointType.DEBRIS_FIELD];
	}
	public static isGasGiant(waypoint: WaypointBase | null) {
		return waypoint?.type == WaypointType[WaypointType.GAS_GIANT];
	}
}

export class SystemOrbital {
	symbol!: string;
}

export enum WaypointType {
	PLANET,
	GAS_GIANT,
	MOON,
	ORBITAL_STATION,
	JUMP_GATE,
	ASTEROID_FIELD,
	NEBULA,
	DEBRIS_FIELD,
	GRAVITY_WELL
}
export const WaypointTypeAttributes: Record<WaypointType, {
		size: number,
		textColor: string,
		fillColor: string,
		edgeColor: string
    } > = {
	[WaypointType.PLANET]:          { size:  6, textColor: '#0F0', fillColor: '#0F0', edgeColor: '#004' },
	[WaypointType.GAS_GIANT]:       { size:  8, textColor: '#F00', fillColor: '#F00', edgeColor: '#400' },
	[WaypointType.MOON]:            { size:  3, textColor: '#EEE', fillColor: '#EEE', edgeColor: '#444' },
	[WaypointType.ORBITAL_STATION]: { size:  1, textColor: '#FFF', fillColor: '#FFF', edgeColor: '#DDD' },
	[WaypointType.JUMP_GATE]:       { size:  2, textColor: '#FFF', fillColor: '#000', edgeColor: '#F00' },
	[WaypointType.ASTEROID_FIELD]:  { size: 10, textColor: '#888', fillColor: '#222', edgeColor: '#888' },
	[WaypointType.NEBULA]:          { size: 15, textColor: '#00F', fillColor: '#00F', edgeColor: '#008' },
	[WaypointType.DEBRIS_FIELD]:    { size:  7, textColor: '#811', fillColor: '#311', edgeColor: '#722' },
	[WaypointType.GRAVITY_WELL]:    { size: 10, textColor: '#855', fillColor: '#000', edgeColor: '#444' }
};

export enum WaypointTrait {
	UNCHARTED,
	MARKETPLACE,
	SHIPYARD,
	OUTPOST,
	SCATTERED_SETTLEMENTS,
	SPRAWLING_CITIES,
	MEGA_STRUCTURES,
	OVERCROWDED,
	HIGH_TECH,
	CORRUPT,
	BUREAUCRATIC,
	TRADING_HUB,
	INDUSTRIAL,
	BLACK_MARKET,
	RESEARCH_FACILITY,
	MILITARY_BASE,
	SURVEILLANCE_OUTPOST,
	EXPLORATION_OUTPOST,
	MINERAL_DEPOSITS,
	COMMON_METAL_DEPOSITS,
	PRECIOUS_METAL_DEPOSITS,
	RARE_METAL_DEPOSITS,
	METHANE_POOLS,
	ICE_CRYSTALS,
	EXPLOSIVE_GASES,
	STRONG_MAGNETOSPHERE,
	VIBRANT_AURORAS,
	SALT_FLATS,
	CANYONS,
	PERPETUAL_DAYLIGHT,
	PERPETUAL_OVERCAST,
	DRY_SEABEDS,
	MAGMA_SEAS,
	SUPERVOLCANOES,
	ASH_CLOUDS,
	VAST_RUINS,
	MUTATED_FLORA,
	TERRAFORMED,
	EXTREME_TEMPERATURES,
	EXTREME_PRESSURE,
	DIVERSE_LIFE,
	SCARCE_LIFE,
	FOSSILS,
	WEAK_GRAVITY,
	STRONG_GRAVITY,
	CRUSHING_GRAVITY,
	TOXIC_ATMOSPHERE,
	CORROSIVE_ATMOSPHERE,
	BREATHABLE_ATMOSPHERE,
	JOVIAN,
	ROCKY,
	VOLCANIC,
	FROZEN,
	SWAMP,
	BARREN,
	TEMPERATE,
	JUNGLE,
	OCEAN,
	STRIPPED
}