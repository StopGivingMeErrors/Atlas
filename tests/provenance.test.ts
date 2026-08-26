import { describe, expect, it } from 'vitest'
import { canonicalizeSourceUrl, contentFingerprint, sha256Hex } from '../src/services/provenance'

describe('canonicalizeSourceUrl (conservative deduplication)', () => {
  it('drops URL fragments', () => {
    expect(canonicalizeSourceUrl('https://example.com/report#section-2')).toBe(
      'https://example.com/report',
    )
  })

  it('removes well-known tracking parameters only', () => {
    expect(
      canonicalizeSourceUrl('https://example.com/a?utm_source=x&utm_campaign=y&id=7'),
    ).toBe('https://example.com/a?id=7')
    expect(canonicalizeSourceUrl('https://example.com/a?fbclid=abc')).toBe('https://example.com/a')
    expect(canonicalizeSourceUrl('https://example.com/a?gclid=xyz&q=test')).toBe(
      'https://example.com/a?q=test',
    )
  })

  it('preserves non-tracking query parameters verbatim (order and casing)', () => {
    expect(canonicalizeSourceUrl('https://example.com/s?Q=Atlas&Page=2')).toBe(
      'https://example.com/s?Q=Atlas&Page=2',
    )
    expect(canonicalizeSourceUrl('https://example.com/s?page=2&q=x')).toBe(
      'https://example.com/s?page=2&q=x',
    )
  })

  it('lowercases scheme and host but never the path', () => {
    // Distinct paths stay distinct — case may be significant to the server.
    expect(canonicalizeSourceUrl('HTTPS://EXAMPLE.COM/Reports/Q3')).toBe(
      'https://example.com/Reports/Q3',
    )
    expect(canonicalizeSourceUrl('https://example.com/Reports/Q3')).not.toEqual(
      canonicalizeSourceUrl('https://example.com/reports/q3'),
    )
  })

  it('strips default ports but keeps non-default ones', () => {
    expect(canonicalizeSourceUrl('https://example.com:443/a')).toBe('https://example.com/a')
    expect(canonicalizeSourceUrl('http://example.com:80/a')).toBe('http://example.com/a')
    expect(canonicalizeSourceUrl('https://example.com:8443/a')).toBe('https://example.com:8443/a')
  })

  it('is conservative about trailing slashes beyond the root', () => {
    // /a/ and /a MAY be different resources; they are not merged.
    expect(canonicalizeSourceUrl('https://example.com/a/')).toBe('https://example.com/a/')
    expect(canonicalizeSourceUrl('https://example.com/a/')).not.toBe(
      canonicalizeSourceUrl('https://example.com/a'),
    )
    expect(canonicalizeSourceUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('produces identical canonical forms for equivalent duplicates', () => {
    const a = 'https://Example.com:443/story?utm_medium=social#top'
    const b = 'https://example.com/story'
    expect(canonicalizeSourceUrl(a)).toBe(canonicalizeSourceUrl(b))
  })

  it('never merges different subdomains — hosts that may differ stay distinct', () => {
    expect(canonicalizeSourceUrl('https://www.example.com/a')).not.toBe(
      canonicalizeSourceUrl('https://example.com/a'),
    )
  })

  it('never throws on unparseable input and returns it unchanged', () => {
    expect(canonicalizeSourceUrl('   not a url  ')).toBe('not a url')
    expect(canonicalizeSourceUrl('')).toBe('')
  })

  it('strips userinfo credentials from the canonical form', () => {
    expect(canonicalizeSourceUrl('https://user:secret@example.com/page')).toBe(
      'https://example.com/page',
    )
  })

  it('keeps unknown parameters that merely look similar to tracking ones', () => {
    expect(canonicalizeSourceUrl('https://example.com/r?ref=atlas-team')).toBe(
      'https://example.com/r?ref=atlas-team',
    )
  })
})

describe('sha256Hex / contentFingerprint (integrity detection)', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })

  it('same content always produces the same hash', () => {
    const content = '<html>Atlas retrieved source</html>'
    expect(contentFingerprint(content)).toBe(contentFingerprint(content))
  })

  it('changed content produces a different hash', () => {
    const original = 'Report states employment at Acme Corp.'
    const tampered = 'Report states employment at Acme Corp Ltd.'
    expect(contentFingerprint(original)).not.toBe(contentFingerprint(tampered))
  })

  it('detects single-character tampering in a persisted digest scenario', () => {
    const retrievedAt = '2026-08-23T10:00:00Z'
    const payload = JSON.stringify({ claim: 'CEO of Example Inc', retrievedAt })
    const persisted = contentFingerprint(payload)

    const mutated = JSON.parse(payload) as Record<string, string>
    mutated.claim = 'CFO of Example Inc'
    expect(contentFingerprint(JSON.stringify(mutated))).not.toBe(persisted)
    expect(contentFingerprint(JSON.stringify({ claim: 'CEO of Example Inc', retrievedAt }))).toBe(
      persisted,
    )
  })
})
