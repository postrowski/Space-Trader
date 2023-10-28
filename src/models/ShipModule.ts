import { ShipRequirements } from "./ShipRequirements";

export class ShipModule {
  symbol!: string;
  name!: string;
  description!: string;
  capacity?: number;
  range?: number;
  requirements!: ShipRequirements;
}