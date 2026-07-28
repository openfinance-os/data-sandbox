/** A generator domain a persona can declare. */
export type Domain = 'banking' | 'insurance' | 'atm';
/** Manifest label: single-domain personas carry their Domain; Phase 2.2
 * multi-domain personas (domains.length > 1) are labelled 'multi'. Use
 * PersonaInfo.domains for the real declared set. */
export type DomainLabel = Domain | 'multi';
export type LfiProfile = 'rich' | 'median' | 'sparse';

/** One slot in a multi-LFI / multi-insurer footprint. NG5/D-14: candidate
 * lists are plausibility sets only — no populate-rate claim binds to them. */
export interface FootprintSlot {
  /** Slot key (Phase 2.2 N-slot shape), e.g. 'salary', 'mortgage-lender'.
   * Absent on the legacy triad shape (the key is the property name). */
  key?: string;
  role: string;
  lfi_default?: string;
  plausible_lfi_candidates?: string[];
  [k: string]: unknown;
}
/** Legacy (pre-Phase-2.2) fixed triad footprint. */
export interface LegacyMultiLfiFootprint {
  primary?: FootprintSlot;
  secondary?: FootprintSlot;
  tertiary?: FootprintSlot;
}
/** Phase 2.2 N-slot footprint — slots[0] is the primary. */
export interface SlotsMultiLfiFootprint {
  slots: FootprintSlot[];
}
/** Both manifest shapes occur; normalizeFootprint() in lib/generator/
 * multi-lfi.js walks either. */
export type MultiLfiFootprint = LegacyMultiLfiFootprint | SlotsMultiLfiFootprint;

/** Phase 2.2 — insurance-carrier mirror of the banking footprint. */
export interface InsurerFootprintSlot {
  key?: string;
  role?: string;
  insurer_default?: string;
  plausible_insurer_candidates?: string[];
  [k: string]: unknown;
}
export interface MultiInsurerFootprint {
  slots: InsurerFootprintSlot[];
}

export interface PersonaInfo {
  name: string;
  archetype: string;
  default_seed: number;
  /** 'multi' for multi-domain personas — see `domains` for the real set. */
  domain: DomainLabel;
  /** Declared domain set. Multi-domain personas list every domain they
   * render under (e.g. ['banking', 'insurance']). */
  domains?: Domain[];
  stress_coverage: string[];
  /** D-14: legacy triad or Phase 2.2 slots[] shape; null when absent. */
  multi_lfi_footprint?: MultiLfiFootprint | null;
  /** Phase 2.2: insurance-carrier footprint; null when absent. */
  multi_insurer_footprint?: MultiInsurerFootprint | null;
  /** Phase R1.5 — seed-keyed relative paths of enrichment sidecars. */
  enrichmentFiles?: Record<string, string>;
  enrichmentRecordCount?: number;
}
export interface FixtureEntry {
  personaId: string;
  lfi: string;
  seed: number;
  domain: DomainLabel;
  domains?: Domain[];
  accountIds: string[];
  policyIds: string[];
  quoteId: string | null;
  consentIds?: string[];
  endpoints: Record<string, string>;
}
/** Phase D Slice 5 — a secondary/tertiary (or Phase 2.2 N-slot) role
 * bundle emitted for a persona with a multi_lfi_footprint. */
export interface RoleFixtureEntry {
  personaId: string;
  slot: string;
  role: string;
  lfi: string;
  seed: number;
  domain: string;
  accountIds: string[];
  endpoints: Record<string, string>;
}
export interface Manifest {
  package: string;
  version: string;
  specVersion: string;
  /** Per-domain spec versions (banking / insurance / atm are pinned
   * independently). */
  specVersions?: Record<string, string>;
  specSha: string;
  generatedAt: string;
  nowAnchor: string;
  domains: Domain[];
  fixtures: Record<string, FixtureEntry>;
  /** Keyed `<persona>|<slot>|<lfi>|<seed>`. */
  roleFixtures?: Record<string, RoleFixtureEntry>;
  personas: Record<string, PersonaInfo>;
}
export interface Journey {
  persona: string;
  lfi: LfiProfile;
  /** 'primary' for the historical primary bundle; otherwise the role-slot
   * key that was loaded (legacy 'secondary'/'tertiary' or a Phase 2.2
   * N-slot key — see listRoleBundles). */
  lfi_role: string;
  seed: number;
  domain: DomainLabel;
  accountIds: string[];
  policyIds: string[];
  quoteId: string | null;
  customerId: string | null;
  specVersion: string;
  specSha: string;
  version: string;
  endpoints: Record<string, unknown>;
}
export const manifest: Manifest;
/** List persona ids. With `domain`, filters on the persona's declared
 * domain set — multi-domain personas appear under BOTH 'banking' and
 * 'insurance' filters (Phase 2.2). */
export function listPersonas(opts?: { domain?: Domain }): string[];
export function getPersonaInfo(personaId: string): PersonaInfo | null;
export function listEndpoints(personaId: string, lfi?: 'rich' | 'median' | 'sparse'): string[];
export function loadFixture(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
  endpoint: string;
  /** D-14 / Phase D Slice 5: a non-primary role-slot key to read the
   * persona's multi-LFI footprint role bundle instead of the primary
   * fixture. Legacy personas use 'secondary' / 'tertiary'; Phase 2.2
   * N-slot personas use arbitrary keys (e.g. 'salary', 'mortgage-lender')
   * — see listRoleBundles for the emitted set. Omit (or pass 'primary')
   * for the historical primary path. */
  lfi_role?: string;
}): unknown;
/** Returns the role-slot keys that have an emitted role bundle for this
 * persona. Legacy personas return a subset of ['secondary','tertiary'];
 * Phase 2.2 N-slot personas return their declared slot keys. */
export function listRoleBundles(personaId: string): string[];

// Pagination — Open Finance v2.1 Links/Meta envelope. `loadFixturePage`
// loads the full fixture for the requested endpoint and returns a paginated
// view: the array under `Data` is sliced to `[offset, offset+limit)`, and
// Links.{Self,First,Last} + (when applicable) Links.{Next,Prev} +
// Meta.TotalPages are populated. A `_pagination` sidecar object exposes
// the resolved offset/limit/total-records/page-number to client code.
export interface PaginationOptions {
  offset?: number;
  limit?: number;
  /** Override the URL emitted in Links.*. Defaults to a synthetic
   *  sandbox:/fixtures/v1/... URL matching the persona/lfi/seed/endpoint. */
  requestUrl?: string;
}
export interface PaginatedMeta {
  TotalPages: number;
  [k: string]: unknown;
}
export interface PaginatedLinks {
  Self: string;
  First: string;
  Last: string;
  Next?: string;
  Prev?: string;
}
export interface PaginationSidecar {
  offset: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
  pageNumber: number;
  hasNext: boolean;
  hasPrevious: boolean;
}
export interface PaginatedEnvelope {
  Data: unknown;
  Links: PaginatedLinks;
  Meta: PaginatedMeta;
  _pagination: PaginationSidecar;
  [k: string]: unknown;
}
/** NOTE (CJS entry): under `require('@openfinance-os/sandbox-fixtures')`
 * this function is **async** — it dynamically imports the ESM pagination
 * engine and returns `Promise<PaginatedEnvelope>`; `await` the result.
 * The ESM entry (`import`) is synchronous as typed here. */
export function loadFixturePage(
  opts: {
    persona: string;
    endpoint: string;
    lfi?: 'rich' | 'median' | 'sparse';
    seed?: number;
    lfi_role?: string;
  } & PaginationOptions
): PaginatedEnvelope;

/** Pure pagination over an already-loaded envelope. */
export function paginateEnvelope(
  envelope: unknown,
  opts: { offset: number; limit: number; requested: boolean; requestUrl?: string }
): unknown;
export function parsePaginationParams(
  searchParams: URLSearchParams,
  opts?: { defaultLimit?: number; maxLimit?: number }
): { offset: number; limit: number; requested: boolean };
export function isPaginatableEnvelope(envelope: unknown): boolean;
export function findListKey(envelope: unknown): string | null;
export const PAGINATION_DEFAULTS: { readonly defaultLimit: number; readonly maxLimit: number };

export function loadJourney(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
  /** D-14 / Slice 8: load the persona's role-keyed bundle instead of the
   * primary. Only valid for personas with multi_lfi_footprint declaring
   * the slot AND a role bundle emitted (see listRoleBundles). Legacy
   * 'secondary'/'tertiary' or a Phase 2.2 N-slot key. */
  lfi_role?: string;
}): Journey;
export function loadSpec(opts?: { domain?: Domain }): unknown;
export function loadPersonaManifest(personaId: string): unknown;

// Phase R1.5 — per-(persona, seed) enrichment sidecar. The bundle stays as
// the v2.1 envelope a real UAE core would serve over Open Finance (the
// "raw" view); the enrichment payload is what a TPP's enrichment engine
// would produce after cleaning. Join by TransactionId.
export interface EnrichmentRecord {
  merchant: string | null;
  /** Corrected ISO 18245 MCC (the trustworthy taxonomy key). Sidecar
   *  carries this even when the wire-level MCC is misrouted. */
  mcc: string | null;
  category: string;
  subcategory: string;
  logoSlug: string | null;
  /** Phase R4 — direct logo URL matching the brand-registry path. The
   *  sidecar emits this deterministically from the slug so a TPP can
   *  render the logo straight off the enrichment record without a
   *  registry lookup. Same value the brand-registry entry carries. */
  logoUrl: string | null;
  /** Phase R4 — deterministic FNV-1a → HSL → hex brand colour. Matches
   *  the colour painted on the merchant's placeholder SVG (algorithmic
   *  parity is test-enforced). */
  primaryColor: string | null;
  /** Phase R2 — synthetic UAE family-conglomerate parent group id. */
  parentGroup: string | null;
  /** Phase R2 — short acronym used as a narrative prefix on the raw side. */
  parentGroupAcronym: string | null;
  /** Phase R3 — the wrong-but-plausible MCC the card scheme emitted on
   *  the wire, populated only when misrouting occurred. */
  mccRaw: string | null;
  /** Phase R3 — true when the wire MCC was misrouted. */
  mccMisrouted: boolean;
  /** Phase R3 — human-readable reason from the confusion table. */
  mccMisroutingReason: string | null;
}
export interface EnrichmentSidecar {
  schema: string;
  personaId: string;
  seed: number;
  generatedAt: string;
  records: Record<string, EnrichmentRecord>;
}
export function loadEnrichment(opts: { persona: string; seed?: number }): EnrichmentSidecar;

// Phase R4 — brand registry. Slug-keyed map (the logoSlug field on an
// EnrichmentRecord joins here). Same shape a Brandfetch / Clearbit
// integration would return. Logos are algorithmically-generated
// placeholders (initials in a coloured circle, OF-OS visual style) —
// no real brand marks are reproduced.
export interface BrandRegistryEntry {
  merchantName: string;
  logoUrl: string;
  primaryColor: string;
  website: string;
  parentGroup: string | null;
  parentGroupAcronym: string | null;
  displayVariants: string[];
  displayVariantsAr: string[];
  mcc: string | null;
  initials: string;
}
export interface BrandRegistry {
  schema: string;
  generatedAt: string;
  merchantCount: number;
  records: Record<string, BrandRegistryEntry>;
}
export function loadBrandRegistry(): BrandRegistry;

// Workstream C plug-point 2 — runtime engine for custom personas.
export interface IndexedPools {
  namesByPoolId: Record<string, unknown>;
  employersByPoolId: Record<string, unknown>;
  merchantsByCategory: Record<string, unknown>;
  counterpartyBanksByCategory: Record<string, unknown>;
  ibansByCategory: Record<string, unknown>;
  organisationsByPoolId: Record<string, unknown>;
  counterpartiesByPoolId: Record<string, unknown>;
}
export interface CustomRecipe {
  segment?: 'Retail' | 'SME' | 'Corporate';
  name_pool?: string;
  age_band?: string;
  emirate?: string;
  income_band?: string;
  flag_payroll?: boolean;
  employer_pool?: string;
  products?: string[];
  card_limit?: 'low' | 'mid' | 'high';
  spend_intensity?: 'low' | 'med' | 'high';
  fx_activity?: boolean;
  cash_deposit?: boolean;
  distress?: 'none' | 'occasional' | 'frequent';
  legal_name_pool?: string;
  signatory_pool?: string;
  signatory_account_role?: string;
  signatory_party_type?: 'Sole' | 'Joint' | 'Delegate';
  cash_flow_intensity?: 'low' | 'med' | 'high';
  customer_inflow_pool?: string;
  supplier_outflow_pool?: string;
  invoice_cadence?: 'weekly' | 'biweekly' | 'monthly' | 'irregular';
  stress_tags?: string[];
}
export const RECIPE_DEFAULTS: Required<CustomRecipe>;
export function encodeRecipe(recipe: CustomRecipe): string;
export function decodeRecipe(encoded: string): CustomRecipe;
export function recipeHash(recipe: CustomRecipe): string;
export function validateRecipe(recipe: CustomRecipe, pools: IndexedPools): { ok: true } | { ok: false; errors: string[] };
export function getPools(): IndexedPools;
export function expandRecipe(recipe: CustomRecipe, pools: IndexedPools): unknown;
export function buildBundle(opts: { persona: unknown; lfi: 'rich' | 'median' | 'sparse'; seed: number; pools: IndexedPools; now?: Date }): unknown;
export function envelopesFromBundle(bundle: unknown, ctx: { personaId: string; lfi: 'rich' | 'median' | 'sparse'; seed: number; specVersion?: string; specSha?: string; retrievedAt: string }): Record<string, unknown>;

// ---------------------------------------------------------------------------
// CJS-only async accessors. The CommonJS entry (index.cjs) cannot re-export
// the ESM runtime engine synchronously, so it exposes these two accessors
// instead of the direct named exports above (buildBundle, expandRecipe, the
// recipe codec, envelopesFromBundle, and the pagination helpers are
// ESM-entry-only). They are NOT present on the ESM entry — under `import`,
// use the direct named exports.
// ---------------------------------------------------------------------------
export interface Engine {
  buildBundle: typeof buildBundle;
  expandRecipe: typeof expandRecipe;
  RECIPE_DEFAULTS: Required<CustomRecipe>;
  encodeRecipe: typeof encodeRecipe;
  decodeRecipe: typeof decodeRecipe;
  recipeHash: typeof recipeHash;
  validateRecipe: typeof validateRecipe;
  envelopesFromBundle: typeof envelopesFromBundle;
}
/** CJS entry only — resolves the runtime engine (generator + recipe codec +
 * envelope wrapper) via dynamic import. */
export function getEngine(): Promise<Engine>;
/** CJS entry only — resolves the pagination helper module
 * (paginateEnvelope, parsePaginationParams, isPaginatableEnvelope,
 * findListKey, PAGINATION_DEFAULTS) via dynamic import. */
export function getPagination(): Promise<{
  paginateEnvelope: typeof paginateEnvelope;
  parsePaginationParams: typeof parsePaginationParams;
  isPaginatableEnvelope: typeof isPaginatableEnvelope;
  findListKey: typeof findListKey;
  PAGINATION_DEFAULTS: { readonly defaultLimit: number; readonly maxLimit: number };
}>;
