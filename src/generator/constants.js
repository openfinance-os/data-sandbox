// Shared generator constants.
//
// HISTORY_MONTHS is the single source of truth for the bundle's history
// window depth. The main transaction stream, the per-account statement
// history, and the cross-LFI mirror ledger MUST all walk the same number
// of calendar months — otherwise the mirror ledger desyncs from the
// transaction window and statements reference months that have no
// transactions. Previously this value was copy-pasted across
// transactions.js / statements.js / multi-lfi.js with "keep in lock-step"
// comments; importing it from here makes the lock-step structural.
//
// Bumped from 12 → 24 in Phase R1 so a TPP can pull a comparable two-year
// history across transactions, statements, and the cross-LFI ledger.
export const HISTORY_MONTHS = 24;
