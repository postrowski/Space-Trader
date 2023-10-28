import { Injectable } from '@angular/core';
import Dexie from 'dexie';
import { Agent } from 'src/models/Agent';
import { JumpGate } from 'src/models/JumpGate';
import { Market } from 'src/models/Market';
import { Shipyard } from 'src/models/Shipyard';
import { System } from 'src/models/System';
import { Waypoint } from 'src/models/Waypoint';

@Injectable({
	providedIn: 'root',
})
export class DBService {
	private db!: Dexie;
	private dbInfo = new DbInfo();

	systems!: Dexie.Table<System, string>;
	waypoints!: Dexie.Table<Waypoint, string>;
	agent!: Dexie.Table<Agent, string>;
	jumplinks!: Dexie.Table<JumpLink, string>;
	markets!: Dexie.Table<Market, string>;
	shipyards!: Dexie.Table<Shipyard, string>;
	jumpgates!: Dexie.Table<JumpGate, string>;
	agents!: Dexie.Table<AgentInfo, number>;
	dbinfo!: Dexie.Table<DbInfo, number>;

	constructor() {
		this.initDatabase();
	}

	private initDatabase() {
		this.db = new Dexie('Space-TraderDB');
		this.db.version(1).stores({
			systems: 'symbol, x, y',
			waypoints: 'symbol,systemSymbol',
			agent: 'symbol',
			jumplinks: 'fromSymbol',
			markets: 'symbol',
			shipyards: 'symbol',
			jumpgates: 'symbol',
			agents: '++id',
			dbinfo: '++id',
		});
		this.systems = this.db.table('systems');
		this.waypoints = this.db.table('waypoints');
		this.agent = this.db.table('agent');
		this.jumplinks = this.db.table('jumplinks');
		this.markets = this.db.table('markets');
		this.shipyards = this.db.table('shipyards');
		this.jumpgates = this.db.table('jumpgates');
		this.agents = this.db.table('agents');
		this.dbinfo = this.db.table('dbinfo');
		
		this.db.open();
		this.db.on("ready", () => {
			console.log(`Dexie DB Version: ${this.db.verno}`);
			this.dbinfo.get(0).then((result) => {
				if (result) {
					this.dbInfo = result;
					console.log(`Dexie DB Info: ${this.dbInfo}`);
				} else {
					this.setGalaxyPagesLoaded(0);
				}
			},
			(error) => {
				this.setGalaxyPagesLoaded(0);
			});
		});
	}
	
	clearDataBase() {
		// Clear all data from the 'systems' table
		this.systems.clear();
		this.waypoints.clear();
		this.agent.clear();
		this.jumplinks.clear();
		this.markets.clear();
		this.shipyards.clear();
		this.jumpgates.clear();
		this.agents.clear();
		this.dbinfo.clear();
	}
	deleteDatabase() {
		// Open the database (this is needed to delete it)
		this.db.open().then(() => {
			// Delete the entire database
			return this.db.delete();
		}).then(() => {
			console.log(`Database has been deleted.`);
		}).catch(error => {
			console.error(`Error deleting database: ${error}`);
		});
	}
	
	createSystem(system: System): Promise<string> {
		// Check if the system with the same symbol exists
		return this.systems
			.where('symbol')
			.equals(system.symbol)
			.first()
			.then((existingSystem) => {
				if (existingSystem) {
					return Promise.reject('System with the same symbol already exists.');
				}
				return this.systems.add(system);
			});
	}
	createWaypoint(waypoint: Waypoint): Promise<string> {
		// Check if the waypoint with the same symbol exists
		return this.waypoints
			.where('symbol')
			.equals(waypoint.symbol)
			.first()
			.then((existingSystem) => {
				if (existingSystem) {
					return Promise.reject('System with the same symbol already exists.');
				}
				return this.waypoints.add(waypoint);
			});
	}

	async updateSystemWaypoints(systemSymbol: string, waypoints: Waypoint[]): Promise<void> {
		try {
			const existingSystem = await this.systems.get(systemSymbol);
			if (existingSystem) {
				// Update the properties of the existing system
				existingSystem.waypoints = waypoints;
				
				// Update the system in the database
				await this.systems.update(systemSymbol, existingSystem);
			}
		} catch (error) {
			console.error('Error updating system:', error);
		}
	}
	// This should be called after a createChart command to
	// update a single waypoint in an uncharted system
	async updateWaypoint(waypoint: Waypoint): Promise<void> {
		try {
			const existingSystem = await this.systems.get(waypoint.systemSymbol);
			if (existingSystem?.waypoints) {
				// Update the properties of the existing system
				for (const wp of existingSystem.waypoints) {
					if (wp.symbol == waypoint.symbol) {
						wp.traits = waypoint.traits;
						// Update the system in the database
						await this.systems.update(waypoint.systemSymbol, existingSystem);
						return;
					}
				}
			}
		} catch (error) {
			console.error('Error updating system:', error);
		}
	}

	getAllSystems(): Promise<System[]> {
		return this.systems.toArray();
	}

	getAllWaypoints(): Promise<Waypoint[]> {
		return this.waypoints.toArray();
	}
	
	addMarket(market: Market) {
		// Check if the market with the same symbol exists
		return this.markets
			.where('symbol')
			.equals(market.symbol)
			.first()
			.then((existingSystem) => {
				if (existingSystem) {
					return Promise.reject('Market with the same symbol already exists.');
				}
				return this.markets.add(market);
			});
	}
	addShipyard(shipyard: Shipyard) {
		// Check if the shipyard with the same symbol exists
		return this.shipyards
			.where('symbol')
			.equals(shipyard.symbol)
			.first()
			.then((existingSystem) => {
				if (existingSystem) {
					return Promise.reject('Shipyard with the same symbol already exists.');
				}
				return this.shipyards.add(shipyard);
			});
	}
	addJumpgate(jumpgate: JumpGate, symbol: string) {
		// Check if the jumpgate with the same symbol exists
		return this.jumpgates
			.where('symbol')
			.equals(symbol)
			.first()
			.then((existingSystem) => {
				if (existingSystem) {
					return Promise.reject('Jumpgate with the same symbol already exists.');
				}
				for (let connectedSystem of jumpgate.connectedSystems) {
					this.jumplinks.add(new JumpLink(symbol, connectedSystem.symbol));
					this.jumplinks.add(new JumpLink(connectedSystem.symbol, symbol));
				}
				return this.jumpgates.add(jumpgate);
			});
	}
	
	setGalaxyPagesLoaded(pages: number) {
		this.dbinfo.put({ ...this.dbInfo, galaxyPagesLoaded: pages }, 0)
			.then(() => {
				this.dbInfo.galaxyPagesLoaded = pages;
			})
			.catch((error) => {
				console.error('Error updating DbInfo:', error);
			});
      }
	getGalaxyPagesLoaded(): number {
		return this.dbInfo.galaxyPagesLoaded;
	}
}

export class JumpLink {
	fromSymbol: string = '';
	toSymbol: string = '';
	constructor(fromSymbol: string, toSymbol: string) {
		this.fromSymbol = fromSymbol;
		this.toSymbol = toSymbol;
	}
}
export class AgentInfo {
	agentToken = '';
	agentRole = '';	
}
export class DbInfo {
	galaxyPagesLoaded = 0;
}