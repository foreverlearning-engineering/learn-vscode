// The extension's side of the key handoff (see protocol.ts): a private local pipe that gives the
// key only to a server that presents this activation's token.
import { randomBytes } from 'node:crypto';
import { chmodSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { encode, handoffAddress, LineReader, parseHello, tokensMatch, type HandoffConfig } from './protocol.ts';

export interface Handoff {
  readonly address: string;
  readonly token: string;
  // Sends the current settings and key to every connected server.
  push(config: HandoffConfig): void;
  connected(): number;
  close(): Promise<void>;
}

export interface HandoffOptions {
  getConfig: () => Promise<HandoffConfig>;
  // Called once for each server that proves the token.
  onServer?: () => void;
  platform?: NodeJS.Platform;
  tmp?: string;
  helloTimeoutMs?: number;
}

export async function startHandoff(options: HandoffOptions): Promise<Handoff> {
  const platform = options.platform ?? process.platform;
  const address = handoffAddress(randomBytes(10).toString('hex'), platform, options.tmp ?? tmpdir());
  const token = randomBytes(32).toString('hex');
  const servers = new Set<Socket>();

  const send = (socket: Socket, config: HandoffConfig) => {
    if (!socket.destroyed) socket.write(encode({ type: 'config', config }));
  };

  const listener: Server = createServer((socket) => {
    socket.setEncoding('utf8');
    const reader = new LineReader();
    let proven = false;
    const timer = setTimeout(() => socket.destroy(), options.helloTimeoutMs ?? 5000);
    socket.on('data', (chunk: string) => {
      let lines: string[];
      try {
        lines = reader.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const line of lines) {
        if (proven) continue; // a server sends nothing after its hello
        const hello = parseHello(line);
        if (!hello || !tokensMatch(hello.token, token)) {
          socket.destroy();
          return;
        }
        proven = true;
        clearTimeout(timer);
        servers.add(socket);
        options.getConfig().then((config) => send(socket, config), () => socket.destroy());
        options.onServer?.();
      }
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      clearTimeout(timer);
      servers.delete(socket);
    });
  });

  if (platform !== 'win32') rmSync(address, { force: true });
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(address, () => {
      listener.off('error', reject);
      resolve();
    });
  });
  if (platform !== 'win32') chmodSync(address, 0o600);

  return {
    address,
    token,
    push(config) {
      for (const socket of servers) send(socket, config);
    },
    connected: () => servers.size,
    close: () => new Promise<void>((resolve) => {
      for (const socket of servers) socket.destroy();
      servers.clear();
      listener.close(() => {
        if (platform !== 'win32') rmSync(address, { force: true });
        resolve();
      });
    }),
  };
}
