import { Transaction } from "./Transaction";

export class JumpTransaction extends Transaction{
	pricePerUnit!: number;
	units!: number;
	type!: string;
}