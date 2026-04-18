/**
 * Open-redirect defence — Wave 5.
 *
 * Purpose: any time we pipe a user-controlled string into a redirect
 * (login `?next=`, auth callback `?next=`, logout `?return=`) we MUST
 * funnel it through these helpers so an attacker cannot coerce the
 * user's browser into landing on an external site that looks like ours.
 *
 * The two canonical attacks we block:
 *   1. Absolute-URL smuggling:   `?next=https://evil.com/foo`
 *      Concatenating `${origin}${next}` happens to sanitise the scheme
 *      because a leading `https://` is re-interpreted as path — but we
 *      still refuse it to stop confused-deputy bugs in future refactors.
 *   2. Protocol-relative escape: `?next=//evil.com/foo` or `?next=/\evil.com`
 *      Browsers interpret `//host` as `current-scheme://host` when they
 *      see it in the Location header — classic open-redirect.
 *
 * API is intentionally stupid: feed raw string in, get safe path out.
 * No throwing on bad input — silently falls back so a malicious URL
 * never becomes a 500.
 *
 * @module lib/security/safe-redirect
 */

const DEFAULT_FALLBACK = '/dashboard'

/**
 * Coerce a user-provided `next`/`return` value into a same-origin path.
 *
 * Returns a value guaranteed to satisfy ALL of the following:
 *   - starts with exactly ONE `/`;
 *   - does not start with `//` or `/\`;
 *   - contains no control characters, CR/LF (header injection);
 *   - length ≤ 1024.
 *
 * Anything else is replaced by `fallback`.
 */
export function safeNextPath(raw: unknown, fallback: string = DEFAULT_FALLBACK): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) {
    return fallback
  }

  // Reject control chars / CR / LF to prevent header-splitting.

  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return fallback
  }

  // Must start with `/`.
  if (raw[0] !== '/') return fallback

  // Must NOT start with `//` (protocol-relative) or `/\` (some browsers
  // silently flip backslashes to forward slashes — CVE-2015-8858 et al.).
  if (raw[1] === '/' || raw[1] === '\\') return fallback

  // Absolute URL with scheme somehow smuggled after the leading slash?
  // e.g. `/https://evil.com` is fine (browsers treat it as path), but we
  // refuse any raw whitespace in paths as belt-and-braces.
  if (/\s/.test(raw)) return fallback

  return raw
}

/**
 * Parse a raw string as a *same-origin* URL and return the resulting
 * pathname + search + hash, or `fallback` if the URL isn't same-origin.
 *
 * Accepts both absolute (`https://foo.com/x?y=1`) and relative forms.
 * Used when the caller is comfortable that the string may legitimately
 * be a fully-qualified URL (e.g. the app domain echoed back by a third
 * party) but still wants to strip host before redirecting.
 */
export function safeSameOriginUrl(
  raw: unknown,
  currentOrigin: string,
  fallback: string = DEFAULT_FALLBACK
): string {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    const u = new URL(raw, currentOrigin)
    if (u.origin !== currentOrigin) return fallback
    return safeNextPath(u.pathname + u.search + u.hash, fallback)
  } catch {
    return fallback
  }
}
