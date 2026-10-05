// C-3: disabled by default; when enabled the audience is required and header names are lower-cased.
type Config = { readonly modules: ReadonlySet<string>; readonly headerNames: readonly string[]; readonly audience: string } | null;

export default {
  post: (result: Config, env: Record<string, string | undefined>): true | string => {
    const modules = (env.CORPUS_EXTERNAL_SERVICE_AUTH_MODULES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (result === null) return modules.length === 0 || 'enabled modules must yield a config';
    if (result.modules.size === 0) return 'config must list at least one module';
    if (!result.audience) return 'audience (storage_slug) is required when enabled';
    return result.headerNames.every((h) => h === h.toLowerCase()) || 'header names must be lower-cased';
  },
};
