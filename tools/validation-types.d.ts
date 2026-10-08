export interface Validator {
  (value: unknown): boolean;
  errors?: unknown[] | null;
}
export function stripAnnotations(value: unknown): unknown;
export function createValidators(
  raw: string,
  opts?: { normalization?: boolean },
): {
  spec: Record<string, unknown>;
  hash: string;
  normalized: boolean;
  endpoints: Array<{ endpoint: string; regex: RegExp; validate: Validator }>;
  forEndpoint(endpoint: string): Validator;
  forSchema(name: string): Validator;
  forResponse(endpoint: string, status: number): Validator | null;
};
