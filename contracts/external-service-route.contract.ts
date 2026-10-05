// C-2: only /api/x/<enabled moduleId>/external(/...) is an external service route.
export default {
  post: (result: string | null, path: string, modules: ReadonlySet<string>): true | string => {
    if (result === null) return true;
    if (!modules.has(result)) return 'moduleId must be explicitly enabled';
    const prefix = `/api/x/${result}/external`;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return 'path must be under /api/x/<moduleId>/external';
    return true;
  },
};
