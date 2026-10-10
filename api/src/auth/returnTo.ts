// After login we send the user back to where they were, e.g. the QR scan URL.
// That "where" comes from the query string (?returnTo=...), so an attacker
// could craft a login link like ?returnTo=https://evil.com and use our site
// to bounce victims to a phishing page (an "open redirect").
//
// So we only accept a path on our own site: it must start with exactly one "/".
//   "/c/abc.123.xyz"   ok
//   "https://evil.com" rejected (absolute URL)
//   "//evil.com"       rejected (browsers read "//host" as "https://host")
//   "/\evil.com"       rejected (some browsers treat "\" like "/")
export function safeReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0 || value.length > 2048) return undefined;
  if (!value.startsWith('/')) return undefined;
  if (value.startsWith('//') || value.startsWith('/\\')) return undefined;
  // Control characters (tabs, newlines) are stripped by browsers in URLs, so
  // "/\t/evil.com" would become "//evil.com". Refuse them outright.
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}
