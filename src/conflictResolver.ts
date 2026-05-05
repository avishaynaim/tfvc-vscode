import * as path from 'path';
import * as vscode from 'vscode';
import { TfvcRepository } from './tfvcRepository';
import { TfvcContentProvider } from './tfvcContentProvider';
import { TfvcScmProvider } from './tfvcScmProvider';
import * as configuration from './configuration';

type Resolution = 'AcceptTheirs' | 'AcceptYours' | 'AcceptMerge';

interface Conflict {
  localItem: string;
  serverItem: string;
  type: string;
}

export async function resolveConflicts(
  repo: TfvcRepository,
  scm: TfvcScmProvider
): Promise<void> {
  const cwd = configuration.getWorkspaceRoot();
  if (!cwd) {
    return;
  }

  let conflicts: Conflict[];
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'TFVC: Scanning for conflicts…' },
    async () => {
      conflicts = await repo.getConflicts(cwd);
    }
  );

  if (!conflicts!.length) {
    vscode.window.showInformationMessage('TFVC: No conflicts found.');
    return;
  }

  // Show conflict list with resolution choice per file
  const items = conflicts!.map((c) => ({
    label: `$(warning)  ${path.basename(c.localItem)}`,
    description: c.type,
    detail: c.localItem,
    conflict: c,
    picked: false,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: `TFVC: ${conflicts!.length} Conflict(s) — select files to resolve`,
    canPickMany: true,
    placeHolder: 'Select conflicts to resolve, then choose resolution strategy',
  });

  if (!selected || selected.length === 0) {
    return;
  }

  // Pick resolution
  const resolutionChoice = await vscode.window.showQuickPick(
    [
      {
        label: '$(server) Accept Server Version',
        description: 'Discard local changes — take what the server has (AcceptTheirs)',
        resolution: 'AcceptTheirs' as Resolution,
      },
      {
        label: '$(device-desktop) Keep Local Version',
        description: 'Discard server changes — keep your local version (AcceptYours)',
        resolution: 'AcceptYours' as Resolution,
      },
      {
        label: '$(diff) Open Diff — Decide per file',
        description: 'Open a diff editor for each conflict',
        resolution: null,
      },
    ],
    {
      title: 'TFVC: Choose Resolution Strategy',
      placeHolder: 'How should the selected conflicts be resolved?',
    }
  );

  if (!resolutionChoice) {
    return;
  }

  if (!resolutionChoice.resolution) {
    // Open diff for each selected conflict
    for (const item of selected) {
      const localUri = vscode.Uri.file(item.conflict.localItem);
      const serverUri = TfvcContentProvider.buildUri(item.conflict.localItem);
      await vscode.commands.executeCommand(
        'vscode.diff',
        serverUri,
        localUri,
        `CONFLICT: ${path.basename(item.conflict.localItem)} (Server ↔ Local)`
      );
    }
    return;
  }

  // Auto-resolve all selected files
  const filePaths = selected.map((s) => s.conflict.localItem);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `TFVC: Resolving ${filePaths.length} conflict(s)…`,
    },
    async () => {
      for (const fp of filePaths) {
        await repo.resolveConflict(fp, resolutionChoice.resolution as Resolution, cwd);
      }
    }
  );

  await scm.refresh();

  vscode.window.showInformationMessage(
    `TFVC: Resolved ${filePaths.length} conflict(s) with "${resolutionChoice.resolution}".`
  );
}
