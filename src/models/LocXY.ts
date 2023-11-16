export class LocXY {
	x: number = 0;
	y: number = 0;

	public constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
	}
	
	public update(src: LocXY) {
		this.x = src.x;
		this.y = src.y;
	}
	
	public static getDistanceSquared(s1: LocXY, s2: LocXY) : number {
		let x = s2.x - s1.x;
		let y = s2.y - s1.y;
		return x*x + y*y;
	}	
	public static getDistance(loc1: LocXY, loc2: LocXY) {
		return Math.ceil(Math.sqrt(LocXY.getDistanceSquared(loc1, loc2)));
	}

	static testRun = false;
	public static test() {
		if (!LocXY.testRun) {
			LocXY.testRun = true;
			const places: LocXY[] = [
				new LocXY(288, -190),
				new LocXY(-168, -416),
				new LocXY(15, 22),
			];
			//places to visit, starting from (15, 22)
			const testResults = LocXY.findShortestPath(new LocXY(15, 22), new Set<LocXY>(places));
			//results: (-15, 43)->(-4, 86)->
			console.log(testResults);
		}
	}

	public static findShortestPath(currentLoc: LocXY, remainingLocs: Set<LocXY>): LocXY[] {
		const startTime = Date.now();
		const solver = new TSPSolver();
		const loop: LocXY[] = solver.findPath(remainingLocs, currentLoc);
		let diag = `places to visit, starting from (${currentLoc.x}, ${currentLoc.y})\n`;
		for (let loc of remainingLocs) {
			diag += `(${loc.x}, ${loc.y}),`;
		}
		diag += `\nresults: `;
		for (let loc of loop) {
			diag += `(${loc.x}, ${loc.y})->`;
		}
		diag += `\ntook ${Date.now()-startTime} milliseconds to plot`;
		console.log(diag);
		return loop;
	}
}

export class TSPSolver {
	private memo: Map<string, { cost: number, path: LocXY[] }> = new Map();

	findPath(locations: Set<LocXY>, startEndPoint: LocXY): LocXY[] {
		const locationsArray = Array.from(locations);
		const startIndex = locationsArray.findIndex(loc => loc.x === startEndPoint.x && loc.y === startEndPoint.y);

		if (startIndex === -1) {
			// Handle the case where startEndPoint is not in the set
			// You may want to add custom logic or throw an error
			console.error("Start point not found in locations set.");
			return [];
		}

		const result = this.solve(startIndex, locationsArray);
		return result.path;		
	}

	// use the the Held-Karp algorithm:
	private solve(currIndex: number, remainingLocations: LocXY[]): { cost: number, path: LocXY[] } {
		if (remainingLocations.length === 0) {
			// Base case: All locations visited
			return { cost: 0, path: [] };
		}
		if (remainingLocations.length === 1) {
			// Base case: One path to take
			return { cost: 0, path: remainingLocations };
		}

		const memoKey = `${currIndex}_${remainingLocations.join(',')}`;
		if (this.memo.has(memoKey)) {
			return this.memo.get(memoKey)!;
		}

		let minCost = Number.POSITIVE_INFINITY;
		let minPath: LocXY[] = [];

		for (let i = 0; i < remainingLocations.length; i++) {
			if (i !== currIndex) {
				const nextIndex = remainingLocations.indexOf(remainingLocations[i]);
				const rest = [...remainingLocations.slice(0, i), ...remainingLocations.slice(i + 1)];
				const subproblem = this.solve(nextIndex, rest);
				const distance = LocXY.getDistance(remainingLocations[currIndex], remainingLocations[i]);

				const totalCost = distance + subproblem.cost;

				if (totalCost < minCost) {
					minCost = totalCost;
					minPath = [remainingLocations[i], ...subproblem.path];
				}
			}
		}

		const result = { cost: minCost, path: minPath };
		this.memo.set(memoKey, result);
		return result;
	}
}