import * as fs from 'fs';
import * as vscode from 'vscode';
import { TfvcRepository } from './tfvcRepository';
import { TfvcScmProvider } from './tfvcScmProvider';
import { OfflineMonitor } from './offlineMode';
import * as configuration from './configuration';

/**
 * Watches for document saves and automatically checks out TFVC-managed files
 * that are still read-only (not yet checked out).
 *
 * Also offers checkout when the user opens a read-only file that is inside
 * the workspace mapping.
 */
export class AutoCheckout implements vscode.Disposable {
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _inProgress = new Set<string>();

  constructor(
    private readonly repo: TfvcRepository,
    private readonly scm: TfvcScmProvider,
    private readonly offline: OfflineMonitor
  ) {}

  register(context: vscode.ExtensionContext): void {
    // ── 1. Checkout before save ──────────────────────────────────────────────
    this._disposables.push(
      vscode.workspace.onWillSaveTextDocument((e) => {
        if (!this.isEnabled() || this.offline.isOffline) {
          return;
        }
        if (e.document.uri.scheme !== 'file') {
          return;
        }

        const fsPath = e.document.uri.fsPath;
        if (this.isAlreadyPending(fsPath) || this._inProgress.has(fsPath)) {
          return;
        }
        if (!isReadOnly(fsPath)) {
          return;
        }

        this._inProgress.add(fsPath);
        e.waitUntil(
          this.repo
            .checkout([fsPath], configuration.getWorkspaceRoot())
            .catch((err: Error) => {
              vscode.window.showErrorMessage(`TFVC Auto-checkout failed: ${err.message}`);
            })
            .finally(() => {
              this._inProgress.delete(fsPath);
              this.scm.refresh();
            })
        );
      })
    );

    // ── 2. Notify when read-only file is opened ──────────────────────────────
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (!this.isEnabled() || this.offline.isOffline || !editor) {
          return;
        }
        if (editor.document.uri.scheme !== 'file') {
          return;
        }

        const fsPath = editor.document.uri.fsPath;
        if (this.isAlreadyPending(fsPath) || !isReadOnly(fsPath)) {
          return;
        }
        if (!this.isInsideWorkspace(fsPath)) {
          return;
        }

        const choice = await vscode.window.showInformationMessage(
          `TFVC: "${editor.document.fileName.split(/[/\\]/).pop()}" is read-only. Check it out to edit?`,
          'Check Out',
          'Not Now'
        );
        if (choice === 'Check Out') {
          try {
            await this.repo.checkout([fsPath], configuration.getWorkspaceRoot());
            await this.scm.refresh();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`TFVC: Checkout failed — ${msg}`);
          }
        }
      })
    );

    context.subscriptions.push(...this._disposables);
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('tfvc')
      .get<boolean>('autoCheckout', true);
  }

  private isAlreadyPending(fsPath: string): boolean {
    return this.scm.pendingChanges.some(
      (c) => c.localItem.toLowerCase() === fsPath.toLowerCase()
    );
  }

  private isInsideWorkspace(fsPath: string): boolean {
    const root = configuration.getWorkspaceRoot();
    return !!root && fsPath.toLowerCase().startsWith(root.toLowerCase());
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
  }
}

function isReadOnly(fsPath: string): boolean {
  try {
    fs.accessSync(fsPath, fs.constants.W_OK);
    return false;
  } catch {
    return true;
  }
}
