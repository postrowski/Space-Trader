import { ContractDeliverGood } from "./ContractDeliverGood";
import { ContractPayment } from "./ContractPayment";

export class ContractTerms {
	deadline: string = "";
	payment: ContractPayment = new ContractPayment();
	deliver: ContractDeliverGood[] = [];

	public update(src: ContractTerms) {
		this.deadline = src.deadline;
		this.payment = src.payment;
		this.deliver = src.deliver;
	}

}
