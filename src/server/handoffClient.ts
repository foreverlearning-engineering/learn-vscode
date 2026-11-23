// The server's side of the key handoff (see ../protocol.ts). It connects to the address the
// extension put in its environment, presents the token, and applies every config it receives.
import { connect } from 'node:net';
import { encode, LineReader, parseConfig, type HandoffConfig } from '../protocol.ts';

// Resolves true once the first config has been applied, or false if the extension cannot be
// reached in time. The connection stays open (without keeping the process alive) for updates.
export function connectHandoff(address: string, token: string, onConfig: (config: HandoffConfig) => void, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const socket = connect(address);
    const timer = setTimeout(() => {
      socket.destroy();
      finish(false);
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.unref();
    const reader = new LineReader();
    socket.on('connect', () => socket.write(encode({ type: 'hello', token })));
    socket.on('data', (chunk: string) => {
      let lines: string[];
      try {
        lines = reader.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const line of lines) {
        const config = parseConfig(line);
        if (!config) continue;
        onConfig(config);
        finish(true);
      }
    });
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}
