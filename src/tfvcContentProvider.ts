import * as vscode from 'vscode';
import { TfvcRepository } from './tfvcRepository';
import * as configuration from './configuration';

/**
 * Virtual document provider for the "tfvc-server" URI scheme.
 *
 * URI formats:
 *   tfvc-server:?path=<encoded-local-path>               ← server tip (T)
 *   tfvc-server:?path=<encoded-path>&version=C12345      ← specific changeset
 *   tfvc-server:?serverItem=<encoded-$/path>&version=C1  ← by server item path
 */
export class TfvcContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'tfvc-server';

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly repository: TfvcRepository) {}

  /** Build a URI for the server-tip version of a local file. */
  static buildUri(localPath: string): vscode.Uri {
    return vscode.Uri.parse(
      `${TfvcContentProvider.scheme}:?path=${encodeURIComponent(localPath)}`
    );
  }

  /**
   * Build a URI for a specific version of a file.
   * @param itemPath  Local path OR server item path ($/…)
   * @param version   TFS version spec, e.g. "C12345", "T", "W"
   * @param isServer  Set true when itemPath is a server item ($/…)
   */
  static buildVersionedUri(
    itemPath: string,
    version: string,
    isServer = false
  ): vscode.Uri {
    const key = isServer ? 'serverItem' : 'path';
    return vscode.Uri.parse(
      `${TfvcContentProvider.scheme}:?${key}=${encodeURIComponent(itemPath)}&version=${encodeURIComponent(version)}`
    );
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const localPath  = params.get('path');
    const serverItem = params.get('serverItem');
    const version    = params.get('version') ?? 'T';
    const cwd = configuration.getWorkspaceRoot();

    const target = localPath ?? serverItem;
    if (!target) {
      return '';
    }

    try {
      const bytes = await this.repository.getFileAtVersion(target, version, cwd);
      return bytes.toString();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `// TFVC: Could not retrieve version "${version}"\n// ${msg}`;
    }
  }

  invalidate(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
