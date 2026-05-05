import * as net from 'net';
import * as vscode from 'vscode';
import { TfvcStatusBar } from './statusBar';
import * as configuration from './configuration';

const PING_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 30_000;

export class OfflineMonitor implements vscode.Disposable {
  private _offline = false;
  private _lastCheck = 0;
  private readonly _onDidChange = new vscode.EventEmitter<boolean>();

  /** Fires with `true` when going offline, `false` when coming back online. */
  readonly onDidChange = this._onDidChange.event;

  get isOffline(): boolean {
    return this._offline;
  }

  /** Returns true when offline. Uses a 30-second cached result. */
  async check(): Promise<boolean> {
    const serverUrl = configuration.getServerUrl();
    if (!serverUrl) {
      return false; // not configured — not "offline", just unconfigured
    }

    const now = Date.now();
    if (now - this._lastCheck < CACHE_TTL_MS) {
      return this._offline;
    }
    this._lastCheck = now;

    let host: string;
    let port: number;
    try {
      const parsed = new URL(serverUrl);
      host = parsed.hostname;
      port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
    } catch {
      return false;
    }

    const wasOffline = this._offline;
    try {
      await tcpPing(host, port, PING_TIMEOUT_MS);
      this._offline = false;
    } catch {
      this._offline = true;
    }

    if (this._offline !== wasOffline) {
      this._onDidChange.fire(this._offline);
      if (this._offline) {
        vscode.window.showWarningMessage(
          `TFVC: Server at ${host} is unreachable. Switching to offline mode.`
        );
      } else {
        vscode.window.showInformationMessage('TFVC: Server connection restored.');
      }
    }

    return this._offline;
  }

  /** Force-reset the cache so the next check actually pings. */
  invalidate(): void {
    this._lastCheck = 0;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

function tcpPing(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.connect(port, host, () => {
      socket.destroy();
      resolve();
    });
    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('TCP ping timeout'));
    });
  });
}
