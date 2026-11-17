// Production discovery contract: the explorer remains deliberately noindex.
export const ORIGIN = 'https://data-sandbox.openfinance-os.org';
export const GUIDE_PATH = '/src/integrate.html';

export function discoveryFiles(guideHtml) {
  // Fail closed if the documentation's indexing policy changes.
  const metaTags = guideHtml.match(/<meta\b[^>]*>/gi) ?? [];
  if (
    metaTags.some(
      (tag) =>
        /name\s*=\s*["']robots["']/i.test(tag) && /content\s*=\s*["'][^"']*noindex/i.test(tag),
    )
  ) {
    throw new Error('Integration guide is noindex: review the sitemap contract.');
  }
  const redirect = (target, title, noindex = false) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>${title}</title>
${noindex ? '<meta name="robots" content="noindex"/>' : ''}
<meta http-equiv="refresh" content="0; url=${target.slice(1)}"/>
<link rel="canonical" href="${ORIGIN}${target}"/>
</head><body><p>Continue to <a href="${target.slice(1)}">${title}</a>.</p></body></html>
`;
  return {
    'index.html': redirect('/src/index.html', 'Open Finance Data Sandbox', true),
    'integrate.html': redirect(GUIDE_PATH, 'Integration guide'),
    'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${ORIGIN}${GUIDE_PATH}</loc></url>
</urlset>
`,
  };
}
