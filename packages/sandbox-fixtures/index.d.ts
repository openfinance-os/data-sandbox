export interface PersonaInfo {
  name: string;
  archetype: string;
  default_seed: number;
  stress_coverage: string[];
}
export interface Manifest {
  package: string;
  version: string;
  specVersion: string;
  specSha: string;
  generatedAt: string;
  nowAnchor: string;
  fixtures: Record<string, { personaId: string; lfi: string; seed: number; accountIds: string[]; endpoints: Record<string, string> }>;
  personas: Record<string, PersonaInfo>;
}
export interface Journey {
  persona: string;
  lfi: 'rich' | 'median' | 'sparse';
  seed: number;
  accountIds: string[];
  customerId: string | null;
  specVersion: string;
  specSha: string;
  version: string;
  endpoints: Record<string, unknown>;
}
export const manifest: Manifest;
export function listPersonas(): string[];
export function getPersonaInfo(personaId: string): PersonaInfo | null;
export function listEndpoints(personaId: string, lfi?: 'rich' | 'median' | 'sparse'): string[];
export function loadFixture(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
  endpoint: string;
}): unknown;
export function loadJourney(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
}): Journey;
export function loadSpec(): unknown;
export function loadPersonaManifest(personaId: string): unknown;
