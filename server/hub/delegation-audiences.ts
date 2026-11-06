/** Administrator expectations, never a replacement for Cr's registered hub_url.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
const SETTING = 'CORPUS_DELEGATION_AUDIENCES';
// Matches the Cr managed-project definition key syntax; preserve exact case.
const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_-]{1,62}$/;

export class DelegationAudiences {
  private readonly origins: ReadonlyMap<string, string>;

  constructor(value: string | undefined) {
    if (typeof value !== 'string' || value.length > 64 * 1024 || !value.trim()) throw new Error(`${SETTING} requires an explicit bounded JSON project map`);
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { throw new Error(`${SETTING} must be valid JSON`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${SETTING} must be a JSON project map`);
    const origins = new Map<string, string>();
    for (const [projectKey, origin] of Object.entries(parsed)) {
      if (!PROJECT_KEY.test(projectKey) || typeof origin !== 'string') throw new Error(`${SETTING} has an invalid project or origin type`);
      let url: URL;
      try { url = new URL(origin); }
      catch { throw new Error(`${SETTING} has an invalid origin`); }
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
        throw new Error(`${SETTING} requires canonical HTTP(S) origins without credentials, paths, queries or fragments`);
      }
      origins.set(projectKey, origin);
    }
    // Keys and canonical origins above contain no literal JSON whitespace.
    // A standard parse/stringify roundtrip therefore rejects duplicate keys and
    // noncanonical escapes without a second JSON parser. Pretty whitespace is OK.
    if (JSON.stringify(parsed) !== value.replace(/[ \t\r\n]/g, '')) {
      throw new Error(`${SETTING} requires unique keys and canonical JSON string encoding`);
    }
    this.origins = origins;
  }

  forProject(projectKey: string): string | undefined { return this.origins.get(projectKey); }
}
