import { ContractTerms } from 'src/models/ContractTerms';

export class Contract {
	id: string = "";
	factionSymbol: string = "";
	type: string = "";
	terms: ContractTerms = new ContractTerms();
	accepted: boolean = false;
	fulfilled: boolean = false;
	expiration: string = "";
	deadlineToAccept?: string;

	public update(src: Contract) {
		this.id = src.id;
		this.factionSymbol = src.factionSymbol;
		this.type = src.type;
		this.terms = src.terms;
		this.accepted = src.accepted;
		this.fulfilled = src.fulfilled;
		this.expiration = src.expiration;
		this.deadlineToAccept = src.deadlineToAccept;
	}
}
