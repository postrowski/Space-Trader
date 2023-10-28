export class ShipRequirements {
  crew?: number;
  power?: number;
  slots?: number;
  
  public update(src: ShipRequirements) {
	  this.crew = src.crew;
	  this.power = src.power;
	  this.slots = src.slots;
  }
}