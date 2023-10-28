export class ShipFuel {
	current: number = 0;
	capacity: number = 0;
	consumed: {
		amount: number;
		timestamp: string;
	} = {amount: 0, timestamp: ""};

	public update(src: ShipFuel) {
		this.current = src.current;
		this.capacity = src.capacity;
		this.consumed.amount = src.consumed.amount;
		this.consumed.timestamp = src.consumed.timestamp;
	}
}
