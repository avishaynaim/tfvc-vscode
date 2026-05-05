import * as vscode from 'vscode';
import { TfExec } from './tfExec';
import { TfvcRepository } from './tfvcRepository';
import { TfvcScmProvider } from './tfvcScmProvider';
import { TfvcContentProvider } from './tfvcContentProvider';
import { TfvcTreeProvider } from './tfvcTreeProvider';
import { TfvcStatusBar } from './statusBar';
import { OfflineMonitor } from './offlineMode';
import { AutoCheckout } from './autoCheckout';
import { CredentialManager } from './credentials';
import * as configuration from './configuration';
import * as commands from './commands';
import { PendingChange } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('TFVC');
  context.subscriptions.push(outputChannel);

  // -------------------------------------------------------------------------
  // Bootstrap core components
  // -------------------------------------------------------------------------

  const tfPath = configuration.findTfExe() ?? 'tf.exe';
  const tfExec      = new TfExec(tfPath, outputChannel);
  const credMgr     = new CredentialManager(context.secrets);
  const repo        = new TfvcRepository(tfExec, credMgr, outputChannel);
  const statusBar   = new TfvcStatusBar();
  const offline     = new OfflineMonitor();
  const scmProvider = new TfvcScmProvider(repo, context);
  const contentProvider = new TfvcContentProvider(repo);
  const treeProvider    = new TfvcTreeProvider();
  const autoCheckout    = new AutoCheckout(repo, scmProvider, offline);

  // Link tree provider and status bar so they update on every SCM refresh
  scmProvider.setTreeProvider(treeProvider);
  scmProvider.setStatusBar(statusBar);
  scmProvider.setOfflineMonitor(offline);

  context.subscriptions.push(scmProvider, contentProvider, treeProvider, statusBar, offline);

  // Activity bar sidebar tree view
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('tfvc.explorer', treeProvider)
  );

  // Virtual document provider — serves server file content for diff editor
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      TfvcContentProvider.scheme,
      contentProvider
    )
  );

  // Auto-checkout on save / file open
  autoCheckout.register(context);

  // Refresh tree + tf.exe path when relevant config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tfvc')) {
        treeProvider.refresh();
        offline.invalidate();
      }
      if (
        e.affectsConfiguration('tfvc.tfExePath') ||
        e.affectsConfiguration('tfvc.autoDetectTfPath')
      ) {
        tfExec.updateTfPath(configuration.findTfExe() ?? 'tf.exe');
      }
    })
  );

  // Warn if tf.exe was not found on startup
  if (!configuration.findTfExe()) {
    vscode.window
      .showWarningMessage(
        'TFVC: tf.exe was not found. Please configure the path.',
        'Set TF.exe Path…'
      )
      .then((choice) => {
        if (choice) { vscode.commands.executeCommand('tfvc.setTfPath'); }
      });
  }

  // Initial status load (also pings server for offline state)
  scmProvider.refresh();

  // -------------------------------------------------------------------------
  // Register commands
  // -------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = (cmd: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));

  // ── File operations ───────────────────────────────────────────────────────

  reg('tfvc.checkout', (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) =>
    runSafe(outputChannel, () =>
      commands.checkout(repo, scmProvider, resolveUris(uri, uris))
    )
  );

  reg('tfvc.checkin', (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) =>
    runSafe(outputChannel, () =>
      commands.checkin(repo, scmProvider, resolveUris(uri, uris))
    )
  );

  reg('tfvc.checkinFromScm', () =>
    runSafe(outputChannel, () => commands.checkinFromScm(repo, scmProvider))
  );

  reg('tfvc.undo', (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) =>
    runSafe(outputChannel, () =>
      commands.undo(repo, scmProvider, resolveUris(uri, uris))
    )
  );

  reg('tfvc.getLatest', (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) =>
    runSafe(outputChannel, () =>
      commands.getLatest(repo, scmProvider, resolveUris(uri, uris))
    )
  );

  reg('tfvc.compare', (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) =>
    runSafe(outputChannel, () =>
      commands.compare(repo, resolveUris(uri, uris))
    )
  );

  reg('tfvc.compareFromScm', (change: PendingChange) =>
    runSafe(outputChannel, () => commands.compareFromScm(repo, change))
  );

  reg('tfvc.history', (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) =>
    runSafe(outputChannel, () =>
      commands.showHistory(repo, resolveUris(uri, uris))
    )
  );

  reg('tfvc.add', (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) =>
    runSafe(outputChannel, () =>
      commands.add(repo, scmProvider, resolveUris(uri, uris))
    )
  );

  reg('tfvc.delete', (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) =>
    runSafe(outputChannel, () =>
      commands.deleteFromTfvc(repo, scmProvider, resolveUris(uri, uris))
    )
  );

  reg('tfvc.shelve',   () => runSafe(outputChannel, () => commands.shelve(repo, scmProvider)));
  reg('tfvc.unshelve', () => runSafe(outputChannel, () => commands.unshelve(repo, scmProvider)));

  reg('tfvc.refresh', () => runSafe(outputChannel, () => scmProvider.refresh()));

  // ── New feature commands ──────────────────────────────────────────────────

  reg('tfvc.resolveConflicts', () =>
    runSafe(outputChannel, () => commands.resolveConflictsCmd(repo, scmProvider))
  );

  reg('tfvc.getAtLabel', () =>
    runSafe(outputChannel, () => commands.getAtLabelCmd(repo, scmProvider))
  );

  reg('tfvc.pickWorkspace', () =>
    runSafe(outputChannel, () => commands.pickWorkspaceCmd(repo))
  );

  // ── Configuration commands ────────────────────────────────────────────────

  reg('tfvc.configure', () =>
    runSafe(outputChannel, () => commands.configure(outputChannel))
  );

  reg('tfvc.setServer', () =>
    runSafe(outputChannel, () => commands.setServerUrl())
  );

  reg('tfvc.setTfPath', () =>
    runSafe(outputChannel, () => commands.setTfPath())
  );

  reg('tfvc.setCredentials', () =>
    runSafe(outputChannel, async () => {
      await configuration.setUseWindowsAuth(false);
      const existing = await credMgr.getStored();
      const creds = await credMgr.promptAndStore(existing);
      if (creds) {
        vscode.window.showInformationMessage(
          `TFVC: Credentials saved for user "${creds.domain ? creds.domain + '\\' : ''}${creds.username}".`
        );
      }
    })
  );

  reg('tfvc.clearCredentials', () =>
    runSafe(outputChannel, async () => {
      await credMgr.clear();
      vscode.window.showInformationMessage('TFVC: Saved credentials cleared.');
    })
  );

  reg('tfvc.showOutput', () => outputChannel.show());
}

export function deactivate(): void { /* VS Code disposes subscriptions */ }

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function resolveUris(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] | undefined {
  if (uris && uris.length > 0) { return uris; }
  if (uri) { return [uri]; }
  return undefined;
}

async function runSafe(
  outputChannel: vscode.OutputChannel,
  fn: () => Promise<unknown>
): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`ERROR: ${msg}`);
    if (vscode.workspace.getConfiguration('tfvc').get<boolean>('showOutputOnError', true)) {
      outputChannel.show(true);
    }
    vscode.window.showErrorMessage(`TFVC: ${msg}`);
  }
}
