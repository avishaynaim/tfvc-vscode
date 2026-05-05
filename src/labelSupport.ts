import * as vscode from 'vscode';
import { TfvcRepository } from './tfvcRepository';
import { TfvcScmProvider } from './tfvcScmProvider';
import * as configuration from './configuration';

interface TfsLabel {
  name: string;
  owner: string;
  date: string;
  comment: string;
  scope: string;
}

/**
 * Shows a Quick Pick of all TFS labels on the server, then gets the workspace
 * at the selected label version.
 */
export async function getAtLabel(
  repo: TfvcRepository,
  scm: TfvcScmProvider
): Promise<void> {
  const cwd = configuration.getWorkspaceRoot();
  if (!cwd) {
    return;
  }

  let labels: TfsLabel[];
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'TFVC: Loading labels…' },
    async () => {
      labels = await repo.getLabels(cwd);
    }
  );

  if (!labels!.length) {
    vscode.window.showInformationMessage('TFVC: No labels found on this server.');
    return;
  }

  const items = labels!.map((l) => ({
    label: `$(tag)  ${l.name}`,
    description: l.owner,
    detail: `${formatDate(l.date)}${l.comment ? '   ' + l.comment : ''}`,
    tfLabel: l,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'TFVC: Get at Label',
    placeHolder: `${labels!.length} label(s) — select one to get your workspace at that version`,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Get workspace at label "${picked.tfLabel.name}"? This will overwrite local files that differ.`,
    { modal: true },
    'Get at Label'
  );
  if (confirmed !== 'Get at Label') {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `TFVC: Getting at label "${picked.tfLabel.name}"…`,
    },
    async () => {
      await repo.getAtLabel(picked.tfLabel.name, cwd);
    }
  );

  await scm.refresh();
  vscode.window.showInformationMessage(
    `TFVC: Workspace updated to label "${picked.tfLabel.name}".`
  );
}

function formatDate(raw: string): string {
  if (!raw) { return ''; }
  try { return new Date(raw).toLocaleString(); } catch { return raw; }
}
