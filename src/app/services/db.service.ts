import { Injectable } from '@angular/core';
import { Dexie } from 'dexie';
import { Agent } from 'src/models/Agent';
import { JumpGate } from 'src/models/JumpGate';
import { Shipyard } from 'src/models/Shipyard';
import { System } from 'src/models/System';
import { Waypoint } from 'src/models/Waypoint';
import { UiMarketItem } from './market.service';
import { LogMessage } from '../utils/log-message';
import { MarketTransaction } from 'src/models/MarketTransaction';

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
	marketItems!: Dexie.Table<UiMarketItem, number>;
	marketTransactions!: Dexie.Table<MarketTransaction, number>;
	shipyards!: Dexie.Table<Shipyard, string>;
	jumpgates!: Dexie.Table<JumpGate, string>;
	agents!: Dexie.Table<AgentInfo, number>;
	dbinfo!: Dexie.Table<DbInfo, number>;
	logs!: Dexie.Table<LogMessage, number>;

	constructor() {
		this.initDatabase();
	}

	async removeRedundantMarketItems(): Promise<void> {
		const start = Date.now();
		// Fetch all items from the marketItems table and sort by timestamp
		const allItems = await this.marketItems.orderBy('timestamp').toArray();

		// Create a Map to store items based on marketSymbol and symbol
		const marketItemMap = new Map<string, UiMarketItem[]>();
		const itemsToKeep: UiMarketItem[] = [];

		// Iterate through the array and organize items into the map
		for (const item of allItems) {
			// Create a unique key based on marketSymbol and symbol
			const key = `${item.marketSymbol}-${item.symbol}`;

			// Check if the key already exists in the map
			if (marketItemMap.has(key)) {
				// If the key exists, append the item to the existing array
				marketItemMap.get(key)!.push(item);
			} else {
				// If the key doesn't exist, create a new array with the item and set it as the value
				marketItemMap.set(key, [item]);
			}
		}
		
		for (const items of marketItemMap.values()) {
			// Iterate through the items to find and remove redundancies
			for (let i = 1; i < items.length - 1; i++) {
				const currentItem = allItems[i];
	
				// Check if the current item is redundant
				if (!UiMarketItem.compare(currentItem, allItems[i - 1]) ||
				    !UiMarketItem.compare(currentItem, allItems[i + 1])) {
					// Add non-redundant item to the new array
					itemsToKeep.push(currentItem);
				}
			}
		}
		// Replace the contents of the marketItems table with the filtered array
		await this.marketItems.clear();
		await this.marketItems.bulkAdd(itemsToKeep);
		console.log(`cleanup took ${(Date.now() - start) / 1000}, started with ${allItems.length}, ended with ${itemsToKeep.length}`);
	}

	public async initDatabase(): Promise<void> {
		this.db = new Dexie('SpaceTraderDB');
		this.db.version(5).stores({
			systems: 'symbol, x, y',
			waypoints: 'symbol,systemSymbol',
			agent: 'symbol',
			jumplinks: 'fromSymbol',
			marketItems: '++,symbol,marketSymbol,[symbol+marketSymbol],timestamp',
			marketTransactions: '++,waypointSymbol,shipSymbol,tradeSymbol,type,timestamp',
			shipyards: 'symbol',
			jumpgates: 'symbol',
			agents: '++id',
			dbinfo: 'id',
			logs: '++id',
		});
		
		// Open the database and perform further actions when it's ready
		await this.db.open()
		console.log(`Dexie DB Version: ${this.db.verno}`);

		// Initialize the dbinfo table, creating an entry if it doesn't exist
		this.systems = this.db.table('systems');
		this.waypoints = this.db.table('waypoints');
		this.agent = this.db.table('agent');
		this.jumplinks = this.db.table('jumplinks');
		this.marketItems = this.db.table('marketItems');
		this.marketTransactions = this.db.table('marketTransactions');
		this.shipyards = this.db.table('shipyards');
		this.jumpgates = this.db.table('jumpgates');
		this.agents = this.db.table('agents');
		this.dbinfo = this.db.table('dbinfo');
		this.logs = this.db.table('logs');

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
	onServerReset() {
		this.clearDataBase();
		this.deleteDatabase();
		this.initDatabase();
		// clear files from C:\Users\paul_\AppData\Local\Google\Chrome\User Data\Default\IndexedDB
	}

	clearDataBase() {
		// Clear all data from the 'systems' table
		this.systems.clear();
		this.waypoints.clear();
		this.agent.clear();
		this.jumplinks.clear();
		this.marketItems.clear();
		this.marketTransactions.clear();
		this.shipyards.clear();
		this.jumpgates.clear();
		this.agents.clear();
		this.dbinfo.clear();
		this.logs.clear();
	}
	deleteDatabase() {
		// Open the database (this is needed to delete it)
		this.db.open().then(() => {
			// Delete the entire database
			this.db.delete();
		}).then(() => {
			console.log(`Database has been deleted.`);
		}).catch(error => {
			console.error(`Error deleting database: ${error}`);
		});
	}
	
	createSystem(system: System): Promise<string> {
		return this.systems.put(system, system.symbol);
	}
	deleteSystem(system: System) {
		this.systems.delete(system.symbol);
	}
	
	createWaypoint(waypoint: Waypoint) {
		this.waypoints.put(waypoint, waypoint.symbol)
			.then(() => {
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
	getAllMarketTransactions(): Promise<MarketTransaction[]> {
		return this.marketTransactions.toArray();
	}

	addMarketTransactions(marketTransactions: MarketTransaction[]) {
		for (const marketTransaction  of marketTransactions) {
			this.addMarketTransaction(marketTransaction);
		}
	}
	addMarketTransaction(marketTransaction: MarketTransaction) {
		this.marketTransactions.add(marketTransaction);
	}
	
	addMarketItems(marketItems: UiMarketItem[]) {
		for (const marketItem of marketItems) {
			this.addMarketItem(marketItem);
		}
	}
	async addMarketItem(item: UiMarketItem): Promise<void> {
		await this.db.transaction('rw', this.marketItems, async () => {
			const existingItems = await this.marketItems
				.where({
					symbol: item.symbol,
					marketSymbol: item.marketSymbol,
					})
				.sortBy('timestamp');
			let itemMatchedLastItem = false;
			if (existingItems && existingItems.length > 2) {
				const lastItem = existingItems[existingItems.length-1];
				const prevItem = existingItems[existingItems.length-2];
				if (UiMarketItem.compare(lastItem, item) &&
				    UiMarketItem.compare(prevItem, item)) {
					// Item matched the most recent item with all the same properties, update its timestamp:
					lastItem.timestamp = item.timestamp;
					this.marketItems.put(lastItem);
					itemMatchedLastItem = true;
				}
			}
			if (!itemMatchedLastItem) {
				// No matching item found, add a new one
				this.marketItems.put(item);
			}
		});
	}
	addShipyard(shipyard: Shipyard) {
		if (shipyard.ships == null || shipyard.ships.length == 0) {
			// Never store a shipyard that doesn't have price data:
			return;
		}
		this.shipyards.put(shipyard, shipyard.symbol)
			.then(() => {
				console.log(`updated shipyard: ${shipyard.symbol}`);
			})
			.catch((error) => {
				console.error('Error updating shipyard:', error);
			});
	}
	nextLogMessage = -1;
	//async 
	addLogMessage(message: LogMessage) {
		if (this.logs) {
			/*
			await this.db.transaction('rw', this.logs, async () => {
				if (this.nextLogMessage == -1) {
					// Query Dexie to get the highest ID
					const highestIdLog = await this.logs.orderBy('id').last();
					this.nextLogMessage = highestIdLog ? highestIdLog.id + 1 : 1;
				}
				message.id = this.nextLogMessage++;
				this.logs.add(message)
					.then(() => {
          			})
					.catch((error) => {
						console.error('Error adding log message:', error);
					});
			});
			*/
		}
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
		this.dbInfo.id = 0;
		this.dbinfo.put(this.dbInfo, 0)
			.then(() => {
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
	id = 0;
	galaxyPagesLoaded = 0;
}
export class DBMarketItem extends UiMarketItem {
	id: number = 0;
}
