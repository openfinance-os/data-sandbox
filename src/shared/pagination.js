// Pagination — Open Finance v2.1 Links/Meta envelope.
//
// Spec-faithful by default: a client without query parameters keeps the
// historical "everything in one page" envelope (Meta.TotalPages = 1).
// Pagination engages when the client passes `?offset=` or `?limit=` —
// the sandbox extension that lets a TPP drive page size from the URL.
// In both modes the response carries spec-correct Links.Self/First/Last,
// and Links.Next / Links.Previous when those pages exist, so client code
// written against the real Open Finance contract (follow Links.Next until
// it is absent) works against the sandbox unchanged.

export const PAGINATION_DEFAULTS = Object.freeze({
  defaultLimit: 25,
  maxLimit: 500,
});

// The single array-valued child of Data on each paginatable listing endpoint.
// Detection picks the first present key in this list, so the order matters
// only when a payload happens to carry more than one (none do in v2.1).
const PAGINATABLE_DATA_KEYS = Object.freeze([
  'Transaction',
  'StandingOrder',
  'DirectDebit',
  'Beneficiary',
  'ScheduledPayment',
  'Statements',
  'Policies',
  'Account',
  'Balance',
  'Product',
  'Party',
]);

const ROOT_ARRAY_SENTINEL = '__root__';

export function findListKey(envelope) {
  if (!envelope || typeof envelope !== 'object') return null;
  const data = envelope.Data;
  if (Array.isArray(data)) return ROOT_ARRAY_SENTINEL;
  if (!data || typeof data !== 'object') return null;
  for (const key of PAGINATABLE_DATA_KEYS) {
    if (Array.isArray(data[key])) return key;
  }
  return null;
}

export function isPaginatableEnvelope(envelope) {
  return findListKey(envelope) !== null;
}

export function parsePaginationParams(searchParams, opts = {}) {
  const defaultLimit = opts.defaultLimit ?? PAGINATION_DEFAULTS.defaultLimit;
  const maxLimit = opts.maxLimit ?? PAGINATION_DEFAULTS.maxLimit;
  if (!searchParams || typeof searchParams.get !== 'function') {
    return { offset: 0, limit: Infinity, requested: false };
  }
  const offsetRaw = searchParams.get('offset');
  const limitRaw = searchParams.get('limit');
  if (offsetRaw === null && limitRaw === null) {
    return { offset: 0, limit: Infinity, requested: false };
  }
  const offset = Math.max(0, toInt(offsetRaw, 0));
  const limit =
    limitRaw === null
      ? defaultLimit
      : Math.min(maxLimit, Math.max(1, toInt(limitRaw, defaultLimit)));
  return { offset, limit, requested: true };
}

function toInt(s, fallback) {
  if (s == null) return fallback;
  const n = parseInt(String(s), 10);
  return Number.isFinite(n) ? n : fallback;
}

// Paginate a v2.1 envelope. When `requested` is false, returns a shallow
// copy with Links.Self refreshed to `requestUrl` (so static fixtures pulled
// over the SW still report the real URL the client asked for) and the
// envelope is otherwise untouched. When `requested` is true, the array
// under Data is sliced and Links.First/Last/Next/Previous + Meta.TotalPages
// are populated.
export function paginateEnvelope(envelope, { offset, limit, requested, requestUrl }) {
  if (!envelope || typeof envelope !== 'object') return envelope;
  const key = findListKey(envelope);
  if (!requested || key === null) {
    if (!requestUrl) return envelope;
    return {
      ...envelope,
      Links: { ...(envelope.Links || {}), Self: String(requestUrl) },
    };
  }
  const arr = key === ROOT_ARRAY_SENTINEL ? envelope.Data : envelope.Data[key];
  const total = arr.length;
  const off = total === 0 ? 0 : Math.max(0, offset);
  const lim = Math.max(1, limit);
  const slice = arr.slice(off, off + lim);
  const newData = key === ROOT_ARRAY_SENTINEL ? slice : { ...envelope.Data, [key]: slice };
  const totalPages = total === 0 ? 1 : Math.ceil(total / lim);

  const links = buildLinks(String(requestUrl || envelope.Links?.Self || ''), {
    offset: off,
    limit: lim,
    total,
  });

  return {
    ...envelope,
    Data: newData,
    Links: links,
    Meta: {
      ...(envelope.Meta || {}),
      TotalPages: totalPages,
    },
    _pagination: {
      offset: off,
      limit: lim,
      totalRecords: total,
      totalPages,
      pageNumber: Math.floor(off / lim) + 1,
      hasNext: off + lim < total,
      hasPrevious: off > 0,
    },
  };
}

function buildLinks(baseUrlStr, { offset, limit, total }) {
  // baseUrlStr may already carry offset/limit — strip and rewrite cleanly.
  // URL parser needs an absolute URL; if we were given a path-only string
  // (test harness with relative URLs), synthesise a placeholder origin and
  // emit the path+query back unchanged at the end.
  let synthetic = false;
  let url;
  try {
    url = new URL(baseUrlStr);
  } catch {
    synthetic = true;
    url = new URL(baseUrlStr, 'http://localhost');
  }
  url.searchParams.delete('offset');
  url.searchParams.delete('limit');

  const withParams = (off, lim) => {
    const u = new URL(url);
    u.searchParams.set('offset', String(off));
    u.searchParams.set('limit', String(lim));
    return synthetic ? `${u.pathname}${u.search}` : u.toString();
  };

  const links = { Self: withParams(offset, limit) };
  links.First = withParams(0, limit);
  const lastOffset = total === 0 ? 0 : Math.max(0, Math.floor((total - 1) / limit) * limit);
  links.Last = withParams(lastOffset, limit);
  if (offset + limit < total) {
    links.Next = withParams(offset + limit, limit);
  }
  if (offset > 0) {
    links.Prev = withParams(Math.max(0, offset - limit), limit);
  }
  return links;
}
