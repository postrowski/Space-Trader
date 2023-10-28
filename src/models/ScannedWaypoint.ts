import { Chart } from "./Chart";
import { WaypointBase } from "./WaypointBase";

export class ScannedWaypoint extends WaypointBase{
  systemSymbol!: string;
  faction!: {
    symbol: string;
  };
  chart!: Chart;
}