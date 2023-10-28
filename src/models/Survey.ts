import { SurveyDeposit } from "./SurveyDeposit";

export class Survey {
  signature!: string;
  symbol!: string;
  deposits: SurveyDeposit[] = [];
  expiration!: string;
  size!: string;
}
