// C-1: only kind=service claims addressed to this hub and not yet expired become a principal.
type Principal = { readonly kind: string; readonly sub: string; readonly scope: readonly unknown[] } | null;

export default {
  post: (result: Principal, claims: Record<string, unknown>, audience: string, nowMs: number): true | string => {
    if (result === null) return true;
    if (result.kind !== 'service' || claims.kind !== 'service') return 'only kind=service claims may become a principal';
    if (!audience || claims.aud !== audience) return 'aud must equal the hub storage_slug';
    const exp = typeof claims.exp === 'string' ? Date.parse(claims.exp) : NaN;
    if (!(exp > nowMs)) return 'expired claims must not become a principal';
    if (result.sub !== claims.sub) return 'principal sub must come from the claims';
    return result.scope.every((s) => typeof s === 'string') || 'scope must be a string array';
  },
};
