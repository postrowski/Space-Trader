export class ShipRegistration {
	name: string = "";
	factionSymbol: string = "";
	role: string = "";
	
  public update(src: ShipRegistration) {
	  this.name = src.name;
	  this.factionSymbol = src.factionSymbol
	  this.role = src.role
  }

};