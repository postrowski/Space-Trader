// Create TypeScript classes to represent the API response structure
import { Agent } from '../models/Agent';
import { Contract } from '../models/Contract';
import { Faction } from '../models/Faction';
import { Ship } from '../models/Ship';

export class TokenResponse {
  token!: string;
  agent!: Agent;
  contract!: Contract;
  faction!: Faction;
  ship!: Ship;
}
