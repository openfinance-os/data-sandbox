# Export and share outcomes

Issue [#117](https://github.com/openfinance-os/data-sandbox/issues/117), EXP-19/21/22.

The existing `share` and `export` event/property allowlists remain unchanged.
Outcome results are local return values; they are never sent as analytics
properties. No additional identity, host, URL, referrer, storage or session
tracking is introduced.

| Outcome | Evidence | Analytics |
| --- | --- | --- |
| Attempted | A user invokes Copy or Download; the action may still be pending. | No export/share event. |
| Confirmed clipboard success | `navigator.clipboard.writeText` resolves, or `execCommand('copy')` returns exactly `true`. Result: `confirmed-success`. | Existing `share { kind }` or `export { format }`, once per completed action. |
| Download initiated | A nonempty fixture is prepared, its Blob/object URL created, and the download anchor clicked without throwing. Result: `download-initiated`. | Existing `export { format }`. This establishes initiation, not saving or use. |
| Manual copy pending | Clipboard write is denied/unavailable and `execCommand` returns false or throws. Result: `manual-copy-pending`, with a local reason distinguishing these cases. | No event. Visible, selected text and even a subsequent DOM `copy` event do not prove clipboard completion. |
| Failed/unavailable | No snippet/bundle/endpoint exists, a fallback's dialog was dismissed, or generation/download initiation fails. | No event and no successful-copy message. |

The popover captures the tab at click time before awaiting the clipboard, so
switching tabs during a pending copy cannot mislabel the eventual event. Empty
JSON/CSV snippets disable Copy/Download. Unsupported CSV endpoints no longer
silently export the unrelated accounts resource. Valid empty resources remain
exportable with their synthetic watermark.

For existing dashboards, `share` now counts confirmed programmatic copies.
`export` counts confirmed snippet copies **or** download initiation, depending
on the chosen tab/action. The unchanged schema does not distinguish these two
outcomes for JSON/CSV. Neither event measures a saved file, fixture consumption,
successful integration, manual copying, or an attempt-to-success conversion
rate. Counts before and after this change have different completion semantics.
Do not divide these event counts by incompatible session/funnel denominators.

## Validation boundary

Unit tests exercise success, fallback, false/throw/manual selection, pending
completion, tab changes, unavailable resources and download errors. Browser
tests use a fake PostHog module and key; they assert capture payloads and
watermarked browser downloads without sending real ingestion requests.

Production ingestion still needs separate, owner-authorized evidence: a
controlled capture checked in the receiving PostHog project, with test traffic
isolated from organic counts. Agree how to identify/exclude controlled traffic
without expanding the allowlists (for example a separate test project), and
provide authorized ingestion evidence. Do not solve this by adding identity or
URL/host/referrer properties, or changing production credentials/settings.
