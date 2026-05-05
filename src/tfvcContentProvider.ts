import * as vscode from 'vscode';
import { TfvcRepository } from './tfvcRepository';
import * as configuration from './configuration';

/**
 * Virtual document provider for the "tfvc-server" URI scheme.
 *
 * URI format:  tfvc-server:?path=<encoded-local-path>
 *
 * Used by the compare command to display the server version of a file in
 * VS Code's built-in diff editor.
 */
export class TfvcContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'tfvc-server';

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly repository: TfvcRepository) {}

  static buildUri(localPath: string): vscode.Uri {
    return vscode.Uri.parse(
      `${TfvcContentProvider.scheme}:?path=${encodeURIComponent(localPath)}`
    );
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const localPath = params.get('path');
    if (!localPath) {
      return '';
    }

    const cwd = configuration.getWorkspaceRoot();

    try {
      const bytes = await this.repository.getServerContentBuffer(localPath, cwd);
      return bytes.toString();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `// TFVC: Could not retrieve server version\n// ${msg}`;
    }
  }

  /** Call this after a get-latest to invalidate cached server content. */
  invalidate(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
