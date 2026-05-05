import * as vscode from 'vscode';
import { TfExec } from './tfExec';
import { TfvcRepository } from './tfvcRepository';
import { TfvcScmProvider } from './tfvcScmProvider';
import { TfvcContentProvider } from './tfvcContentProvider';
import { TfvcTreeProvider } from './tfvcTreeProvider';
import { CredentialManager } from './credentials';
import * as configuration from './configuration';
import * as commands from './commands';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('TFVC');
  context.subscriptions.push(outputChannel);

  // -------------------------------------------------------------------------
  // Bootstrap core components
  // -------------------------------------------------------------------------

  const tfPath = configuration.findTfExe() ?? 'tf.exe';
  const tfExec = new TfExec(tfPath, outputChannel);
  const credMgr = new CredentialManager(context.secrets);
  const repo = new TfvcRepository(tfExec, credMgr, outputChannel);
  const scmProvider = new TfvcScmProvider(repo, context);
  const contentProvider = new TfvcContentProvider(repo);
  const treeProvider = new TfvcTreeProvider();

  // Link tree provider so it refreshes whenever the SCM panel refreshes
  scmProvider.setTreeProvider(treeProvider);

  context.subscriptions.push(scmProvider);
  context.subscriptions.push(contentProvider);
  context.subscriptions.push(treeProvider);

  // Activity bar sidebar tree view
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('tfvc.explorer', treeProvider)
  );

  // Register virtual document provider for diff editor (server versions of files)
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      TfvcContentProvider.scheme,
      contentProvider
    )
  );

  // Refresh tree when config changes (server URL, tf.exe path, auth)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tfvc')) {
        treeProvider.refresh();
      }
    })
  );

  // Warn if tf.exe was not found
  if (!configuration.findTfExe()) {
    vscode.window
      .showWarningMessage(
        'TFVC: tf.exe was not found. Please configure the path.',
        'Set TF.exe Path…'
      )
      .then((choice) => {
        if (choice) {
          vscode.commands.executeCommand('tfvc.setTfPath');
        }
      });
  }

  // Initial status load
  scmProvider.refresh();

  // Re-detect tf.exe when the user updates the setting
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tfvc.tfExePath') || e.affectsConfiguration('tfvc.autoDetectTfPath')) {
        const newPath = configuration.findTfExe() ?? 'tf.exe';
        tfExec.updateTfPath(newPath);
      }
    })
  );

  // -------------------------------------------------------------------------
  // Register commands
  // -------------------------------------------------------------------------

  // VS Code command dispatch is dynamically typed — use any for handler signatures
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = (cmd: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));

  // File operations — accept URI array from explorer/editor context menus
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
    runSafe(outputChannel, () =>
      commands.checkinFromScm(repo, scmProvider)
    )
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

  // Called when user clicks a resource in the SCM panel
  reg('tfvc.compareFromScm', (change: import('./types').PendingChange) =>
    runSafe(outputChannel, () =>
      commands.compareFromScm(repo, change)
    )
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

  reg('tfvc.shelve', () =>
    runSafe(outputChannel, () =>
      commands.shelve(repo, scmProvider)
    )
  );

  reg('tfvc.unshelve', () =>
    runSafe(outputChannel, () =>
      commands.unshelve(repo, scmProvider)
    )
  );

  reg('tfvc.refresh', () =>
    runSafe(outputChannel, () =>
      scmProvider.refresh()
    )
  );

  // Configuration commands
  reg('tfvc.configure', () =>
    runSafe(outputChannel, () =>
      commands.configure(outputChannel)
    )
  );

  reg('tfvc.setServer', () =>
    runSafe(outputChannel, () =>
      commands.setServerUrl()
    )
  );

  reg('tfvc.setTfPath', () =>
    runSafe(outputChannel, () =>
      commands.setTfPath()
    )
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

  reg('tfvc.showOutput', () => {
    outputChannel.show();
  });
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically; nothing extra needed
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Merge single + multi-select URI arguments from VS Code context menus. */
function resolveUris(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] | undefined {
  if (uris && uris.length > 0) {
    return uris;
  }
  if (uri) {
    return [uri];
  }
  return undefined;
}

/**
 * Wraps a command handler so errors are shown to the user and logged to the
 * output channel rather than silently dropped.
 */
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
