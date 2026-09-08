import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { CleanupScope } from './lifecycle.ts';

/** listen失敗を起動Promiseへ返し、HTTP/SSE/upgraded接続をcloseで解放する。 */
export function ownHttpServer(server: Server, scope: CleanupScope): Promise<void> {
  const sockets = new Set<Socket>();
  const onConnection = (socket: Socket): void => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  server.on('connection', onConnection);
  scope.defer(() => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      server.off('connection', onConnection);
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
    for (const socket of sockets) socket.destroy();
  }));
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => { server.off('listening', onListening); reject(error); };
    const onListening = (): void => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
  });
}
