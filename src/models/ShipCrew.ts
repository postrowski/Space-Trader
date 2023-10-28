export class ShipCrew {
	current: number = 0;
	capacity: number = 0;
	required: number = 0;
	rotation: string = "";
	morale: number = 0;
	wages: number = 0;

  	public update(src: ShipCrew) {
		this.current = src.current;
		this.capacity = src.capacity;
		this.required = src.required;
		this.rotation = src.rotation;
		this.morale = src.morale;
		this.wages = src.wages;
	}
}

