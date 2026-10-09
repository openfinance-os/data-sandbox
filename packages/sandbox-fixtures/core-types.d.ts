export interface Scenario {
  corpusVersion: string;
  generatorVersion: string;
  personaId: string;
  recipeHash: string | null;
  role: string;
  lfi: 'rich' | 'median' | 'sparse';
  seed: number;
  referenceDate: string;
  specProvenance: Record<
    string,
    { version: string; commit: string; sha256: string; retrievedAt: string }
  > | null;
}
export const CORPUS_VERSION: string;
export const REFERENCE_DATE: string;
export function scenarioDescriptor(
  input: Pick<Scenario, 'personaId' | 'lfi' | 'seed'> & Partial<Scenario>,
): Scenario;
export function minorUnits(amount: string, currency?: string): number;
export function formatMinor(amount: number, currency?: string): string;
export interface Transaction {
  TransactionId: string;
  BookingDateTime: string;
  Status: string;
  CreditDebitIndicator: 'Credit' | 'Debit';
  Amount: { Amount: string; Currency: string };
  AccountId?: string;
  _accountId?: string;
  MerchantDetails?: { MerchantCategoryCode?: string };
  TransactionInformation?: string;
}
export interface TransactionOptions {
  since?: string;
  until?: string;
  minAmount?: number;
  maxAmount?: number;
  category?: string;
  currency?: string;
  status?: string;
  cursor?: string;
  summary?: boolean;
  limit?: number;
  scenario?: Scenario;
  referenceDate?: string;
}
export interface TransactionSummary {
  count: number;
  omitted: number;
  complete: boolean;
  scope: { status: string; referenceDate: string | null; currenciesCombined: boolean };
  earliest: string | null;
  latest: string | null;
  byCurrencyAndStatus: Array<{
    currency: string;
    status: string;
    count: number;
    credit: string;
    debit: string;
    net: string;
    sourceIds: string[];
  }>;
}
export function summarizeTransactions(
  rows: Transaction[],
  opts?: { status?: string; referenceDate?: string },
): TransactionSummary;
export function queryTransactions(
  envelope: {
    Data: { Transaction: Transaction[] };
    _scenario?: Scenario;
    Links?: { Self?: string };
  },
  opts?: TransactionOptions,
): {
  Data: { Transaction: Transaction[] };
  _filter: Record<string, unknown>;
  _summary?: TransactionSummary;
};
export function postedTransactions(
  rows: Transaction[],
  opts: { accountId?: string; currency?: string; now: string | Date },
): Transaction[];
export function movement(rows: Transaction[]): number;
