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
		return Math.round(Math.sqrt(LocXY.getDistanceSquared(loc1, loc2)));
	}

	public static findShortestPath(currentLoc: LocXY, remainingLocs: Set<LocXY>)
	            : LocXY[] {
		const startTime = Date.now();
		const loop: LocXY[] = LocXY.findShortestPathLoop([...remainingLocs]);
		let minDist = Infinity;
		let path: LocXY[] = [];
		for (let index = 0; index < loop.length; index++) {
			const dist = LocXY.getDistanceSquared(loop[index], currentLoc);
			if (dist < minDist) {
				minDist = dist;
				const firstPart: LocXY[] = loop.slice(0, index); // Elements before index n
				const secondPart: LocXY[] = loop.slice(index); // Elements after index n
				path = [...secondPart, ...firstPart];
			}
		}
		let diag = `places to visit, starting from (${currentLoc.x}, ${currentLoc.y})\n `;
		for (let loc of remainingLocs) {
			diag += `(${loc.x}, ${loc.y}),`;
		}
		diag += ` \n results: `;
		for (let loc of remainingLocs) {
			diag += `(${loc.x}, ${loc.y})->`;
		}
		diag += ` \n took ${Date.now()-startTime} milliseconds to plot`;
		console.log(diag);
		return path;
	}
	
	public static findShortestPathLoop(locations: LocXY[]): LocXY[] {
		// use the the Held-Karp algorithm:
		const n = locations.length;

		// Calculate all possible subsets of locations
		const subsets = (1 << n) - 1;

		const dp: number[][] = Array(n).fill(null)
		                               .map(() => Array(subsets).fill(Number.POSITIVE_INFINITY));
		dp[0][0] = 0;

		for (let mask = 0; mask < subsets; mask++) {
			for (let u = 0; u < n; u++) {
				if (!(mask & (1 << u)))
					continue;

				for (let v = 0; v < n; v++) {
					if (u === v || !(mask & (1 << v)))
						continue;

					const prevMask = mask ^ (1 << v);
					dp[u][mask] = Math.min(dp[u][mask],
					                       dp[v][prevMask] + LocXY.getDistance(locations[u], locations[v]));
				}
			}
		}

		const path: number[] = [];
		let u = 0;
		let mask = subsets - 1;

		for (let v = 1; v < n; v++) {
			if (dp[u][mask] === dp[v][subsets - 1] + LocXY.getDistance(locations[u], locations[v])) {
				path.push(u);
				mask ^= (1 << u);
				u = v;
			}
		}

		path.push(u);
		return path.map(i => locations[i]);
	}
	
/*	public static findShortestPath(currentLoc: LocXY, remainingLocs: Set<LocXY>)
	            : { path: LocXY[]; distance: number } {
		if (remainingLocs.size === 0) {
			// Base case: All locations visited
			return { path: [currentLoc], distance: 0 };
		}

		let shortestPath: LocXY[] | undefined;
		let shortestDistance: number = Number.POSITIVE_INFINITY;

		for (const nextLoc of remainingLocs) {
			const remainingLocsCopy = new Set(remainingLocs);
			remainingLocsCopy.delete(nextLoc);

			const result = LocXY.findShortestPath(nextLoc, remainingLocsCopy);
			const distance = LocXY.getDistance(currentLoc, nextLoc) + result.distance;

			if (distance < shortestDistance) {
				shortestDistance = distance;
				shortestPath = [currentLoc, ...result.path];
			}
		}
		return { path: shortestPath || [], distance: shortestDistance };
	}
*/
}