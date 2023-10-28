export class Cooldown {
	shipSymbol: string = "";
	totalSeconds: number = 0;
	remainingSeconds: number = 0;
	expiration: string = "";
	
	public update(src: Cooldown) {
		this.shipSymbol = src.shipSymbol;
		this.totalSeconds = src.totalSeconds;
		this.remainingSeconds = src.remainingSeconds;
		this.expiration = src.expiration;
	}
};