/**
 * Returns the server bind options for the selected authentication mode.
 *
 * No-auth mode supplies a fixed administrator identity and is for local
 * development only, so it must never listen on externally reachable interfaces.
 */
export function getListenOptions(port: number, noAuth: boolean): {
  port: number;
  hostname?: string;
} {
  return noAuth ? { port, hostname: '127.0.0.1' } : { port };
}
