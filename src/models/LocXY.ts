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

}