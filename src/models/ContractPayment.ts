export class ContractPayment {
  onAccepted: number = 0;
  onFulfilled: number = 0;
  
  public update(src: ContractPayment) {
	  this.onAccepted = src.onAccepted;
	  this.onFulfilled = src.onFulfilled;
  }
}