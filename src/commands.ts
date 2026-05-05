import * as path from 'path';
import * as vscode from 'vscode';
import { TfvcRepository } from './tfvcRepository';
import { TfvcScmProvider } from './tfvcScmProvider';
import { TfvcContentProvider } from './tfvcContentProvider';
import * as configuration from './configuration';
import { ChangesetInfo, PendingChange } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getActiveFilePath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath;
}

function resolveTargetPaths(uris?: vscode.Uri[]): string[] {
  if (uris && uris.length > 0) {
    return uris.map((u) => u.fsPath);
  }
  const active = getActiveFilePath();
  return active ? [active] : [];
}

function cwdFor(filePaths: string[]): string | undefined {
  if (filePaths.length > 0) {
    return path.dirname(filePaths[0]);
  }
  return configuration.getWorkspaceRoot();
}

async function withProgress<T>(
  title: string,
  task: () => Promise<T>
): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title },
    task
  );
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export async function checkout(
  repo: TfvcRepository,
  scm: TfvcScmProvider,
  uris?: vscode.Uri[]
): Promise<void> {
  const filePaths = resolveTargetPaths(uris);
  if (filePaths.length === 0) {
    vscode.window.showWarningMessage('TFVC: No file selected for check out.');
    return;
  }

  await withProgress(`Checking out ${filePaths.length} file(s)…`, async () => {
    await repo.checkout(filePaths, cwdFor(filePaths));
    await scm.refresh();
  });

  vscode.window.showInformationMessage(
    `TFVC: Checked out ${filePaths.map((f) => path.basename(f)).join(', ')}`
  );
}

// ---------------------------------------------------------------------------
// Check in — with comment dialog
// ---------------------------------------------------------------------------

export async function checkin(
  repo: TfvcRepository,
  scm: TfvcScmProvider,
  uris?: vscode.Uri[]
): Promise<void> {
  const cwd = configuration.getWorkspaceRoot();
  const pending = scm.pendingChanges;

  // Decide which files to check in
  let targetFiles: string[];

  if (uris && uris.length > 0) {
    targetFiles = uris.map((u) => u.fsPath);
  } else if (pending.length > 0) {
    // Let user pick from the pending list (multi-select quick pick)
    const items = pending.map((c) => ({
      label: path.basename(c.localItem),
      description: c.changeType.toUpperCase(),
      detail: c.localItem,
      picked: true,
      change: c,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: 'TFVC: Select files to check in',
      canPickMany: true,
      placeHolder: 'Choose files to include in this check-in',
    });

    if (!selected || selected.length === 0) {
      return;
    }
    targetFiles = selected.map((s) => s.change.localItem);
  } else {
    vscode.window.showInformationMessage('TFVC: No pending changes to check in.');
    return;
  }

  // Get comment (prefer SCM input box, fall back to prompt)
  let comment = scm.inputBoxComment || configuration.getDefaultComment();

  comment = (await vscode.window.showInputBox({
    title: 'TFVC: Check In Comment',
    prompt: 'Enter a comment for this check-in',
    value: comment,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length === 0 ? 'A comment is required.' : null),
  })) ?? '';

  if (comment === undefined) {
    return; // cancelled
  }

  const changesetId = await withProgress(
    `Checking in ${targetFiles.length} file(s)…`,
    async () => repo.checkin(targetFiles, comment, cwd)
  );

  scm.clearInputBox();
  await scm.refresh();

  vscode.window.showInformationMessage(
    changesetId !== undefined
      ? `TFVC: Checked in as changeset #${changesetId}.`
      : 'TFVC: Check-in complete.'
  );
}

// ---------------------------------------------------------------------------
// Check in from the SCM input box (acceptInputCommand)
// ---------------------------------------------------------------------------

export async function checkinFromScm(
  repo: TfvcRepository,
  scm: TfvcScmProvider
): Promise<void> {
  const comment = scm.inputBoxComment;
  const pending = scm.pendingChanges;

  if (pending.length === 0) {
    vscode.window.showInformationMessage('TFVC: No pending changes to check in.');
    return;
  }

  if (!comment) {
    vscode.window.showWarningMessage('TFVC: Please enter a check-in comment.');
    return;
  }

  const cwd = configuration.getWorkspaceRoot();
  const filePaths = pending.map((c) => c.localItem);

  const changesetId = await withProgress(
    `Checking in ${filePaths.length} file(s)…`,
    async () => repo.checkin(filePaths, comment, cwd)
  );

  scm.clearInputBox();
  await scm.refresh();

  vscode.window.showInformationMessage(
    changesetId !== undefined
      ? `TFVC: Checked in as changeset #${changesetId}.`
      : 'TFVC: Check-in complete.'
  );
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export async function undo(
  repo: TfvcRepository,
  scm: TfvcScmProvider,
  uris?: vscode.Uri[]
): Promise<void> {
  const filePaths = resolveTargetPaths(uris);
  if (filePaths.length === 0) {
    vscode.window.showWarningMessage('TFVC: No file selected to undo.');
    return;
  }

  if (configuration.confirmUndo()) {
    const answer = await vscode.window.showWarningMessage(
      `TFVC: Undo changes in ${filePaths.length} file(s)?  Local changes will be lost.`,
      { modal: true },
      'Undo'
    );
    if (answer !== 'Undo') {
      return;
    }
  }

  await withProgress('Undoing changes…', async () => {
    await repo.undo(filePaths, cwdFor(filePaths));
    await scm.refresh();
  });

  vscode.window.showInformationMessage(
    `TFVC: Undone changes in ${filePaths.map((f) => path.basename(f)).join(', ')}`
  );
}

// ---------------------------------------------------------------------------
// Get latest
// ---------------------------------------------------------------------------

export async function getLatest(
  repo: TfvcRepository,
  scm: TfvcScmProvider,
  uris?: vscode.Uri[]
): Promise<void> {
  const cwd = configuration.getWorkspaceRoot();
  const filePaths = uris && uris.length > 0 ? uris.map((u) => u.fsPath) : [];

  await withProgress('Getting latest version…', async () => {
    await repo.getLatest(filePaths, cwd);
    await scm.refresh();
  });

  vscode.window.showInformationMessage('TFVC: Get latest complete.');
}

// ---------------------------------------------------------------------------
// Compare with server version
// ---------------------------------------------------------------------------

export async function compare(
  repo: TfvcRepository,
  uris?: vscode.Uri[],
  pendingChange?: PendingChange
): Promise<void> {
  let localPath: string | undefined;

  if (pendingChange) {
    localPath = pendingChange.localItem;
  } else {
    localPath = resolveTargetPaths(uris)[0];
  }

  if (!localPath) {
    vscode.window.showWarningMessage('TFVC: No file selected to compare.');
    return;
  }

  const serverUri = TfvcContentProvider.buildUri(localPath);
  const localUri = vscode.Uri.file(localPath);
  const title = `${path.basename(localPath)} (Server ↔ Local)`;

  await vscode.commands.executeCommand('vscode.diff', serverUri, localUri, title);
}

// ---------------------------------------------------------------------------
// Compare from SCM resource click
// ---------------------------------------------------------------------------

export async function compareFromScm(
  repo: TfvcRepository,
  change: PendingChange
): Promise<void> {
  await compare(repo, undefined, change);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export async function showHistory(
  repo: TfvcRepository,
  uris?: vscode.Uri[]
): Promise<void> {
  const cwd = configuration.getWorkspaceRoot();
  const filePath = resolveTargetPaths(uris)[0] ?? cwd;

  if (!filePath) {
    vscode.window.showWarningMessage('TFVC: No file or folder selected for history.');
    return;
  }

  let history: ChangesetInfo[];
  await withProgress('Loading history…', async () => {
    history = await repo.getHistory(filePath, 50, cwd);
  });

  if (!history! || history.length === 0) {
    vscode.window.showInformationMessage('TFVC: No history found.');
    return;
  }

  const items = history.map((cs) => ({
    label:       `#${cs.id} — ${cs.comment || '(no comment)'}`,
    description: cs.owner,
    detail:      formatDate(cs.date) + (cs.items.length > 0 ? `  •  ${cs.items.length} item(s)` : ''),
    changeset:   cs,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: `TFVC History — ${path.basename(filePath)}`,
    placeHolder: 'Select a changeset to view details',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selected) {
    return;
  }

  // Show changeset detail in output channel
  const cs = selected.changeset;
  const channel = vscode.window.createOutputChannel(`TFVC History #${cs.id}`);
  channel.appendLine(`Changeset:  #${cs.id}`);
  channel.appendLine(`Owner:      ${cs.owner}`);
  channel.appendLine(`Date:       ${formatDate(cs.date)}`);
  channel.appendLine(`Comment:    ${cs.comment || '(none)'}`);
  channel.appendLine(`\nChanged items (${cs.items.length}):`);
  for (const item of cs.items) {
    channel.appendLine(`  [${item.changeType.toUpperCase().padEnd(6)}] ${item.serverItem}`);
  }
  channel.show();
}

// ---------------------------------------------------------------------------
// Add / Delete
// ---------------------------------------------------------------------------

export async function add(
  repo: TfvcRepository,
  scm: TfvcScmProvider,
  uris?: vscode.Uri[]
): Promise<void> {
  const filePaths = resolveTargetPaths(uris);
  if (filePaths.length === 0) {
    vscode.window.showWarningMessage('TFVC: No file selected to add.');
    return;
  }

  await withProgress(`Adding ${filePaths.length} item(s)…`, async () => {
    await repo.add(filePaths, cwdFor(filePaths));
    await scm.refresh();
  });

  vscode.window.showInformationMessage(
    `TFVC: Added ${filePaths.map((f) => path.basename(f)).join(', ')}`
  );
}

export async function deleteFromTfvc(
  repo: TfvcRepository,
  scm: TfvcScmProvider,
  uris?: vscode.Uri[]
): Promise<void> {
  const filePaths = resolveTargetPaths(uris);
  if (filePaths.length === 0) {
    vscode.window.showWarningMessage('TFVC: No file selected to delete.');
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    `TFVC: Mark ${filePaths.length} item(s) for deletion from source control?`,
    { modal: true },
    'Delete'
  );
  if (answer !== 'Delete') {
    return;
  }

  await withProgress(`Deleting ${filePaths.length} item(s)…`, async () => {
    await repo.delete(filePaths, cwdFor(filePaths));
    await scm.refresh();
  });
}

// ---------------------------------------------------------------------------
// Shelve / Unshelve
// ---------------------------------------------------------------------------

export async function shelve(
  repo: TfvcRepository,
  scm: TfvcScmProvider
): Promise<void> {
  const pending = scm.pendingChanges;
  if (pending.length === 0) {
    vscode.window.showInformationMessage('TFVC: No pending changes to shelve.');
    return;
  }

  const shelvesetName = await vscode.window.showInputBox({
    title: 'TFVC: Shelve Changes',
    prompt: 'Enter a shelveset name',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length === 0 ? 'Shelveset name required.' : null),
  });
  if (!shelvesetName) {
    return;
  }

  const comment = await vscode.window.showInputBox({
    title: 'TFVC: Shelve Comment',
    prompt: 'Enter an optional comment',
    ignoreFocusOut: true,
  });
  if (comment === undefined) {
    return;
  }

  const cwd = configuration.getWorkspaceRoot();
  const filePaths = pending.map((c) => c.localItem);

  await withProgress('Shelving changes…', async () => {
    await repo.shelve(shelvesetName, comment, filePaths, cwd);
    await scm.refresh();
  });

  vscode.window.showInformationMessage(`TFVC: Shelved as "${shelvesetName}".`);
}

export async function unshelve(
  repo: TfvcRepository,
  scm: TfvcScmProvider
): Promise<void> {
  const shelvesetName = await vscode.window.showInputBox({
    title: 'TFVC: Unshelve',
    prompt: 'Enter the shelveset name to restore',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length === 0 ? 'Shelveset name required.' : null),
  });
  if (!shelvesetName) {
    return;
  }

  const cwd = configuration.getWorkspaceRoot();

  await withProgress('Unshelving…', async () => {
    await repo.unshelve(shelvesetName, cwd);
    await scm.refresh();
  });

  vscode.window.showInformationMessage(`TFVC: Unshelved "${shelvesetName}".`);
}

// ---------------------------------------------------------------------------
// Configuration commands
// ---------------------------------------------------------------------------

export async function configure(outputChannel: vscode.OutputChannel): Promise<void> {
  const options = [
    '$(server) Set Server URL…',
    '$(file-binary) Set TF.exe Path…',
    '$(key) Set Login Credentials…',
    '$(person) Switch to Windows Authentication',
    '$(trash) Clear Saved Credentials',
    '$(output) Show Output Log',
    '$(gear) Open Settings',
  ];

  const choice = await vscode.window.showQuickPick(options, {
    title: 'TFVC: Configure Extension',
    placeHolder: 'Select a configuration action',
  });

  if (!choice) {
    return;
  }

  if (choice.includes('Server URL')) {
    await setServerUrl();
  } else if (choice.includes('TF.exe Path')) {
    await setTfPath();
  } else if (choice.includes('Login Credentials')) {
    await vscode.commands.executeCommand('tfvc.setCredentials');
  } else if (choice.includes('Windows Authentication')) {
    await configuration.setUseWindowsAuth(true);
    vscode.window.showInformationMessage('TFVC: Switched to Windows Authentication.');
  } else if (choice.includes('Clear Saved')) {
    await vscode.commands.executeCommand('tfvc.clearCredentials');
  } else if (choice.includes('Output Log')) {
    outputChannel.show();
  } else if (choice.includes('Settings')) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'tfvc');
  }
}

export async function setServerUrl(): Promise<void> {
  const current = configuration.getServerUrl();
  const url = await vscode.window.showInputBox({
    title: 'TFVC: Server URL',
    prompt: 'Enter the TFVC collection URL',
    placeHolder: 'http://myserver:8080/tfs/DefaultCollection',
    value: current,
    ignoreFocusOut: true,
    validateInput: (v) => {
      if (!v.trim()) {
        return null; // empty clears the setting
      }
      try {
        new URL(v);
        return null;
      } catch {
        return 'Enter a valid URL (http://server:port/path)';
      }
    },
  });
  if (url === undefined) {
    return;
  }
  await configuration.setServerUrl(url.trim());
  vscode.window.showInformationMessage(`TFVC: Server URL set to "${url.trim()}"`);
}

export async function setTfPath(): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    ['$(search) Auto-detect from Visual Studio', '$(folder-opened) Browse for TF.exe…'],
    { title: 'TFVC: Set TF.exe Location' }
  );

  if (!choice) {
    return;
  }

  if (choice.includes('Auto-detect')) {
    const found = configuration.findTfExe();
    if (found) {
      await configuration.setTfExePath(found);
      vscode.window.showInformationMessage(`TFVC: Found tf.exe at "${found}"`);
    } else {
      vscode.window.showErrorMessage(
        'TFVC: Could not find tf.exe. Is Visual Studio installed? Use "Browse" to locate it manually.'
      );
    }
  } else {
    const found = await configuration.browseTfExe();
    if (found) {
      vscode.window.showInformationMessage(`TFVC: tf.exe set to "${found}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function formatDate(raw: string): string {
  if (!raw) {
    return '';
  }
  try {
    return new Date(raw).toLocaleString();
  } catch {
    return raw;
  }
}
