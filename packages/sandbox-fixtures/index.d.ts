export type Domain = 'banking' | 'insurance';
export interface PersonaInfo {
  name: string;
  archetype: string;
  default_seed: number;
  domain: Domain;
  stress_coverage: string[];
}
export interface FixtureEntry {
  personaId: string;
  lfi: string;
  seed: number;
  domain: Domain;
  accountIds: string[];
  policyIds: string[];
  quoteId: string | null;
  endpoints: Record<string, string>;
}
export interface Manifest {
  package: string;
  version: string;
  specVersion: string;
  specSha: string;
  generatedAt: string;
  nowAnchor: string;
  domains: Domain[];
  fixtures: Record<string, FixtureEntry>;
  personas: Record<string, PersonaInfo>;
}
export interface Journey {
  persona: string;
  lfi: 'rich' | 'median' | 'sparse';
  seed: number;
  domain: Domain;
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
export function listPersonas(opts?: { domain?: Domain }): string[];
export function getPersonaInfo(personaId: string): PersonaInfo | null;
export function listEndpoints(personaId: string, lfi?: 'rich' | 'median' | 'sparse'): string[];
export function loadFixture(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
  endpoint: string;
  /** D-14 / Phase D Slice 5: 'secondary' or 'tertiary' to read the
   * persona's multi-LFI footprint role bundle instead of the primary
   * fixture. Omit (or pass 'primary') for the historical primary path. */
  lfi_role?: 'primary' | 'secondary' | 'tertiary';
}): unknown;
export function listRoleBundles(personaId: string): Array<'secondary' | 'tertiary'>;
export function loadJourney(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
  /** D-14 / Slice 8: load the persona's role-keyed bundle instead of the
   * primary. Only valid for personas with multi_lfi_footprint declaring
   * the slot AND a role bundle emitted (see listRoleBundles). */
  lfi_role?: 'primary' | 'secondary' | 'tertiary';
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
