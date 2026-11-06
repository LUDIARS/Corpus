/** Corpus-owned opaque sessions, bounded by the original live Cr grant.
 * Tokens and grants stay in process memory; every read asks Cr again.
 * @implements SPEC-HUB-BOUND-SERVICE-SESSION
 */
import { createHash, randomBytes } from 'node:crypto';
import type { CernereComposite } from '../lib/cernere/packages/composite/src/composite.js';
import type { BoundServiceSession, ResourceOperation, ServiceOperation } from '../lib/cernere/packages/composite/src/service-session.js';
import { CompositeAuthorityError } from '../lib/cernere/packages/composite/src/service-session.js';
import type { DelegationCredential, DelegationTarget, DelegatedHttpOperation } from '../lib/cernere/packages/composite/src/delegation.js';
import type { OwnOrganizationMembership, OwnFaceConsent, ScopedIdentitySession } from '../lib/cernere/packages/composite/src/service-identity.js';
import type { UploadHttpOperation, UploadCredential } from '../lib/cernere/packages/composite/src/upload.js';
import type { CapturedServiceOperation, CapturedResourceOperation } from '../lib/cernere/packages/composite/src/captured-operation.js';

type Authority = {
  exchange: CernereComposite['exchange'];
  sessions: Pick<CernereComposite['sessions'], 'bind' | 'check' | 'revoke' | 'run'> & Partial<Pick<CernereComposite['sessions'], 'runCaptured'>>;
  uploads?: Pick<CernereComposite['uploads'], 'issue'>;
  delegations: Pick<CernereComposite['delegations'], 'issue'>;
  identity: Pick<CernereComposite['identity'], 'organizations' | 'faceConsentStatus' | 'createFaceConsent' | 'revokeFaceConsent'>;
};
interface Entry { grant: BoundServiceSession; expiresAt: number }
export interface CreatedServiceSession {
  /** This is the only credential delivered to the browser/native host. */
  token: string;
  expiresAt: string;
}
export class ServiceSessionMissingError extends Error {
  constructor() { super('Service session missing or expired; sign in again'); }
}
export class ServiceSessionRotationError extends Error {
  constructor() { super('Previous session revocation was not confirmed; sign in again'); }
}

export class ServiceSessionStore {
  private readonly entries = new Map<string, Entry>();
  private closed = false;
  private pendingCreation = 0;
  constructor(
    private readonly authority: Authority,
    private readonly projectKey: string,
    private readonly now: () => number = Date.now,
    private readonly randomToken: () => string = () => randomBytes(32).toString('base64url'),
    private readonly capacity = 10_000,
  ) {
    if (!projectKey || !Number.isSafeInteger(capacity) || capacity <= 0) throw new Error('A project key and session capacity are required');
  }

  async create(code: string, verifier: string, previousToken?: string): Promise<CreatedServiceSession> {
    this.assertOpen();
    this.removeExpired();
    if (this.entries.size + this.pendingCreation >= this.capacity) throw new Error('Service session capacity exhausted');
    this.pendingCreation++;
    try {
      // Exchange and bind each execute once. An unknown outcome requires a new login.
      const exchange = await this.authority.exchange(code, verifier);
      this.assertOpen();
      const token = this.randomToken();
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid service session entropy source');
      const key = this.fingerprint(token);
      if (this.entries.has(key)) throw new Error('Service session collision');
      const grant = await this.authority.sessions.bind(exchange.projectToken, token);
      this.assertOpen();
      const expiresAt = Date.parse(grant.expiresAt);
      if (grant.projectKey !== this.projectKey || grant.user.id !== exchange.user.id
        || !Number.isFinite(expiresAt) || expiresAt <= this.now() || expiresAt > this.now() + 15 * 60_000) {
        throw new Error('Invalid bound service session');
      }
      // Do not overwrite another session, including an injected duplicate entropy result.
      if (this.entries.has(key)) throw new Error('Service session collision');
      const entry = { grant, expiresAt };
      this.entries.set(key, entry);
      if (previousToken) {
        try { await this.revoke(previousToken); }
        catch {
          // Neither old nor new local credentials survive an unknown rotation result.
          this.entries.delete(key);
          throw new ServiceSessionRotationError();
        }
      }
      this.assertCurrent(key, entry);
      return { token, expiresAt: grant.expiresAt };
    } finally { this.pendingCreation--; }
  }

  async resolve(token: string): Promise<BoundServiceSession> {
    return (await this.resolveEntry(token)).grant;
  }
  async delegate(token: string, target: DelegationTarget, operation: DelegatedHttpOperation): Promise<DelegationCredential> {
    const { key, entry, grant } = await this.resolveEntry(token);
    const credential = await this.authority.delegations.issue(grant, target, operation);
    this.assertCurrent(key, entry);
    return credential;
  }
  async delegateUpload(token: string, target: DelegationTarget, operation: UploadHttpOperation, signal?: AbortSignal): Promise<UploadCredential> {
    if (!this.authority.uploads) throw new Error('Upload delegation is not configured');
    const { key, entry, grant } = await this.resolveEntry(token);
    const result = await this.authority.uploads.issue(grant, target, operation, { risk: 'important', signal,
      isCurrent: () => { this.assertCurrent(key, entry); return true; } });
    this.assertCurrent(key, entry); return result;
  }
  async runCaptured<T>(token: string, operation: CapturedServiceOperation, resource: CapturedResourceOperation<T>): Promise<T> {
    if (!this.authority.sessions.runCaptured) throw new Error('Captured operation authority is not configured');
    const { key, entry, grant } = await this.resolveEntry(token);
    return this.authority.sessions.runCaptured(grant, operation, { ...resource,
      isCurrent: () => { this.assertCurrent(key, entry); return resource.isCurrent(); },
      authorizeResource: async decision => { this.assertCurrent(key, entry); return resource.authorizeResource(decision); },
      execute: (body, decision) => { this.assertCurrent(key, entry); return resource.execute(body, decision); },
    });
  }

  organizations(token: string): Promise<OwnOrganizationMembership[]> {
    return this.withIdentity(token, grant => this.authority.identity.organizations(grant));
  }
  faceConsentStatus(token: string): Promise<OwnFaceConsent[]> {
    return this.withIdentity(token, grant => this.authority.identity.faceConsentStatus(grant));
  }
  createFaceConsent(token: string, facilityId: string, policyVersion: string): Promise<void> {
    return this.withIdentity(token, grant => this.authority.identity.createFaceConsent(grant, facilityId, policyVersion));
  }
  revokeFaceConsent(token: string, facilityId?: string): Promise<void> {
    return this.withIdentity(token, grant => this.authority.identity.revokeFaceConsent(grant, facilityId));
  }

  private async withIdentity<T>(token: string, operation: (session: ScopedIdentitySession) => Promise<T>): Promise<T> {
    const { key, entry, grant } = await this.resolveEntry(token);
    const result = await operation({ grant, isCurrent: () => { this.assertCurrent(key, entry); return true; } });
    // An explicit logout/expiry during the authority call cannot revive the
    // local session or deliver subsequently cached positive authorization.
    this.assertCurrent(key, entry);
    return result;
  }

  async run<T>(token: string, operation: ServiceOperation, resource: ResourceOperation<T>): Promise<T> {
    if (typeof resource.authorizeResource !== 'function' || typeof resource.execute !== 'function') throw new Error('Current resource authorization is required');
    const { key, entry, grant } = await this.resolveEntry(token);
    return this.authority.sessions.run(grant, operation, {
      risk: resource.risk,
      authorizeResource: async decision => {
        this.assertCurrent(key, entry);
        return resource.authorizeResource(decision);
      },
      execute: () => {
        this.assertCurrent(key, entry);
        return resource.execute();
      },
    });
  }

  async revoke(token: string): Promise<void> {
    this.assertOpen();
    const key = this.fingerprint(token);
    const entry = this.entries.get(key);
    // Local logout is final even if remote revocation cannot be confirmed.
    this.entries.delete(key);
    if (entry && entry.expiresAt > this.now()) await this.authority.sessions.revoke(entry.grant);
  }

  close(): void { this.closed = true; this.entries.clear(); }

  private async resolveEntry(token: string): Promise<{ key: string; entry: Entry; grant: BoundServiceSession }> {
    this.assertOpen();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ServiceSessionMissingError();
    const key = this.fingerprint(token);
    const entry = this.entries.get(key);
    if (!entry) throw new ServiceSessionMissingError();
    this.assertCurrent(key, entry);
    // Never fall back to entry.grant when Cr denies, times out or returns malformed data.
    let grant: BoundServiceSession;
    try { grant = await this.authority.sessions.check(entry.grant); }
    catch (error) {
      if (error instanceof CompositeAuthorityError && [401, 403].includes(error.status)) this.entries.delete(key);
      throw error;
    }
    this.assertCurrent(key, entry);
    const expiresAt = Date.parse(grant.expiresAt);
    if (grant.projectKey !== this.projectKey || grant.user.id !== entry.grant.user.id
      || grant.user.role !== entry.grant.user.role || !Number.isFinite(expiresAt) || expiresAt > entry.expiresAt || expiresAt <= this.now()) {
      this.entries.delete(key);
      throw new ServiceSessionMissingError();
    }
    // A shorter authority lifetime is permanent; it can never extend locally later.
    entry.expiresAt = expiresAt;
    entry.grant = grant;
    return { key, entry, grant };
  }

  private assertCurrent(key: string, entry: Entry): void {
    this.assertOpen();
    if (this.entries.get(key) !== entry || entry.expiresAt <= this.now()) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw new ServiceSessionMissingError();
    }
  }
  private assertOpen(): void { if (this.closed) throw new Error('Service session store is closed'); }
  private fingerprint(token: string): string { return createHash('sha256').update(token, 'utf8').digest('base64url'); }
  private removeExpired(): void {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(key);
  }
}
