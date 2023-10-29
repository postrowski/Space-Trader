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

	public async initDatabase(): Promise<void> {
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
			dbinfo: 'id',
		});
		
		// Open the database and perform further actions when it's ready
		await this.db.open()
		console.log(`Dexie DB Version: ${this.db.verno}`);

		// Initialize the dbinfo table, creating an entry if it doesn't exist
		this.systems = this.db.table('systems');
		this.waypoints = this.db.table('waypoints');
		this.agent = this.db.table('agent');
		this.jumplinks = this.db.table('jumplinks');
		this.markets = this.db.table('markets');
		this.shipyards = this.db.table('shipyards');
		this.jumpgates = this.db.table('jumpgates');
		this.agents = this.db.table('agents');
		this.dbinfo = this.db.table('dbinfo');

		// Try to get the DbInfo entry
		this.dbinfo.toArray().then(
			(result) => {
				if (result && result.length>0) {
					this.dbInfo = result[0];
					console.log(`Dexie DB Info:`, this.dbInfo);
				} else {
					// If no entry exists, create one
					this.setGalaxyPagesLoaded(0);
				}
			},
			(error) => {
				this.setGalaxyPagesLoaded(0);
			}
		);
		// Explicitly resolve the promise when initialization is complete
  		return Promise.resolve();
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
		return this.systems.put(system, system.symbol);
	}
	createWaypoint(waypoint: Waypoint) {
		this.waypoints.put(waypoint, waypoint.symbol)
			.then(() => {
				console.log(`updated waypoint: ${waypoint}`);
			})
			.catch((error) => {
				console.error('Error updating waypoint:', error);
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
			const systemSymbol = waypoint.systemSymbol;
			const existingSystem = await this.systems.get(systemSymbol);
			if (existingSystem?.waypoints) {
				// Update the properties of the existing system
				for (const wp of existingSystem.waypoints) {
					if (wp.symbol == waypoint.symbol) {
						wp.traits = waypoint.traits;
						// Update the system in the database
						await this.systems.update(systemSymbol, existingSystem);
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
		this.markets.put(market, market.symbol)
			.then(() => {
				console.log(`updated market: ${market}`);
			})
			.catch((error) => {
				console.error('Error updating market:', error);
			});
	}
	addShipyard(shipyard: Shipyard) {
		this.shipyards.put(shipyard, shipyard.symbol)
			.then(() => {
				console.log(`updated shipyard: ${shipyard}`);
			})
			.catch((error) => {
				console.error('Error updating shipyard:', error);
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
				for (let waypointSymbol of jumpgate.connections) {
					this.jumplinks.add(new JumpLink(symbol, waypointSymbol));
					this.jumplinks.add(new JumpLink(waypointSymbol, symbol));
				}
				return this.jumpgates.add(jumpgate);
			});
	}
	
	setGalaxyPagesLoaded(pages: number) {
		this.dbinfo.clear();
		this.dbInfo.galaxyPagesLoaded = pages;
		this.dbinfo.put(this.dbInfo, 0)
			.then(() => {
				console.log(`updated DbInfo: ${this.dbInfo}`);
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