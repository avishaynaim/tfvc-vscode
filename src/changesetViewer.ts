import * as path from 'path';
import * as vscode from 'vscode';
import { TfvcRepository } from './tfvcRepository';
import { TfvcContentProvider } from './tfvcContentProvider';
import { ChangesetInfo } from './types';
import * as configuration from './configuration';

/**
 * Opens an interactive changeset viewer.
 * Lists all files touched by a changeset and lets the user open per-file diffs.
 */
export async function viewChangeset(
  repo: TfvcRepository,
  changeset: ChangesetInfo
): Promise<void> {
  if (changeset.items.length === 0) {
    vscode.window.showInformationMessage(
      `TFVC: Changeset #${changeset.id} has no file details available.`
    );
    return;
  }

  const cwd = configuration.getWorkspaceRoot();

  const items = changeset.items.map((item) => ({
    label: `$(${changeTypeIcon(item.changeType)})  ${path.basename(item.serverItem)}`,
    description: item.changeType.toUpperCase(),
    detail: item.serverItem,
    serverItem: item.serverItem,
    changeType: item.changeType,
  }));

  const header = `Changeset #${changeset.id} by ${changeset.owner} — ${formatDate(changeset.date)}`;
  const subHeader = changeset.comment ? `"${changeset.comment}"` : '(no comment)';

  const picked = await vscode.window.showQuickPick(items, {
    title: `${header} — ${subHeader}`,
    placeHolder: `${changeset.items.length} file(s) changed — select one to view diff`,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return;
  }

  if (picked.changeType.toLowerCase().includes('delete')) {
    vscode.window.showInformationMessage(
      `TFVC: "${path.basename(picked.serverItem)}" was deleted in this changeset.`
    );
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'TFVC: Loading changeset diff…' },
    async () => {
      // Left = version before this changeset (C<id-1> is not always right,
      // so we use the changeset's previous version via C<id>~1 — TFS syntax is C<id-1>)
      const prevVersion = `C${changeset.id - 1}`;
      const thisVersion = `C${changeset.id}`;

      const beforeUri = TfvcContentProvider.buildVersionedUri(
        picked.serverItem,
        prevVersion,
        true
      );
      const afterUri = TfvcContentProvider.buildVersionedUri(
        picked.serverItem,
        thisVersion,
        true
      );

      const title = `${path.basename(picked.serverItem)} (#${changeset.id - 1} → #${changeset.id})`;
      await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title);
    }
  );
}

/**
 * Summarise all changesets in the TFVC output channel — enhanced version
 * that adds a "View Files" action button per changeset.
 */
export async function showHistoryWithViewer(
  repo: TfvcRepository,
  filePath: string
): Promise<void> {
  const cwd = configuration.getWorkspaceRoot();

  let history: ChangesetInfo[] = [];
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title: 'Loading history…' },
    async () => {
      history = await repo.getHistory(filePath, 100, cwd);
    }
  );

  if (history.length === 0) {
    vscode.window.showInformationMessage('TFVC: No history found.');
    return;
  }

  const items = history.map((cs) => ({
    label: `$(git-commit)  #${cs.id}`,
    description: cs.owner,
    detail: `${formatDate(cs.date)}   ${cs.comment || '(no comment)'}   [${cs.items.length} file(s)]`,
    changeset: cs,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `TFVC History — ${path.basename(filePath)}`,
    placeHolder: 'Select a changeset to view its files and diffs',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (picked) {
    await viewChangeset(repo, picked.changeset);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function changeTypeIcon(changeType: string): string {
  const lower = changeType.toLowerCase();
  if (lower.includes('add'))    { return 'diff-added'; }
  if (lower.includes('delete')) { return 'diff-removed'; }
  if (lower.includes('rename')) { return 'arrow-right'; }
  return 'diff-modified';
}

function formatDate(raw: string): string {
  if (!raw) { return ''; }
  try { return new Date(raw).toLocaleString(); } catch { return raw; }
}
