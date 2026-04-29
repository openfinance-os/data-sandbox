import { buildBundle } from '../src/generator/index.js';
import { loadAllPersonas, loadAllPools } from './load-fixtures.mjs';

const personas = loadAllPersonas();
const pools = loadAllPools();

console.log('=== AUDIT — does the synthetic data look like real bank-core output? ===\n');

const targetPersonas = ['salaried_expat_mid', 'sme_cash_heavy', 'hnw_multicurrency', 'nsf_distressed'];
for (const pid of targetPersonas) {
  const persona = personas[pid];
  const bundle = buildBundle({ persona, lfi: 'rich', seed: 4729, pools });
  console.log(`--- ${pid} ---`);
  console.log(`accounts: ${bundle.accounts.length} | transactions: ${bundle.transactions.length}`);
  // Show 4 representative rows (salary, direct debit, POS, FX/cash if applicable)
  const sample = [
    bundle.transactions.find((t) => t.SubTransactionType === 'Deposit' && t.Flags?.includes('Payroll')),
    bundle.transactions.find((t) => t.TransactionType === 'BillPayments'),
    bundle.transactions.find((t) => t.TransactionType === 'POS'),
    bundle.transactions.find((t) => t.TransactionType === 'InternationalTransfer'),
    bundle.transactions.find((t) => t.TransactionType === 'Teller' && t.SubTransactionType === 'Deposit'),
    bundle.transactions.find((t) => t.Status === 'Rejected'),
  ].filter(Boolean);
  for (const t of sample) {
    console.log(`  [${t.TransactionType}/${t.SubTransactionType}] ${t.Status}`);
    console.log(`    Ref: "${t.TransactionReference}"`);
    console.log(`    Info: "${t.TransactionInformation || '(none)'}"`);
    console.log(`    Booking: ${t.BookingDateTime}  Value: ${t.ValueDateTime || '(missing)'}  TxDate: ${t.TransactionDateTime}`);
    console.log(`    Amount: ${t.Amount.Amount} ${t.Amount.Currency} ${t.CreditDebitIndicator}`);
    if (t.MerchantDetails) console.log(`    Merchant: "${t.MerchantDetails.MerchantName}" MCC=${t.MerchantDetails.MerchantCategoryCode}`);
    if (t.CurrencyExchange) console.log(`    FX: ${t.CurrencyExchange.SourceCurrency}->${t.CurrencyExchange.TargetCurrency} @ ${t.CurrencyExchange.ExchangeRate}`);
    if (t.Flags) console.log(`    Flags: ${JSON.stringify(t.Flags)}`);
  }
  // Distribution check
  const dayOfWeek = bundle.transactions.map((t) => new Date(t.BookingDateTime).getUTCDay());
  const fridayCount = dayOfWeek.filter((d) => d === 5).length;
  const totalCount = dayOfWeek.length;
  const statuses = [...new Set(bundle.transactions.map((t) => t.Status))];
  console.log(`  status distribution: ${statuses.join(', ')}`);
  console.log(`  Fridays: ${fridayCount}/${totalCount} (${(fridayCount/totalCount*100).toFixed(1)}%) — UAE weekend; real cores typically have ~0% on Fridays for retail flows`);
  console.log(`  ValueDateTime != BookingDateTime: ${bundle.transactions.filter(t => t.ValueDateTime && t.ValueDateTime !== t.BookingDateTime).length}/${totalCount}`);
  console.log('');
}
