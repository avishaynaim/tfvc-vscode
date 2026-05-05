import * as vscode from 'vscode';
import { TfvcRepository } from './tfvcRepository';
import { WorkspaceInfo } from './types';
import * as configuration from './configuration';

/**
 * Detects the TFS workspace that maps to the current VS Code folder.
 * If multiple workspaces match, shows a Quick Pick so the user can choose.
 * The selected workspace name is stored in settings for subsequent operations.
 */
export async function pickWorkspace(repo: TfvcRepository): Promise<WorkspaceInfo | undefined> {
  const cwd = configuration.getWorkspaceRoot();
  if (!cwd) {
    vscode.window.showWarningMessage('TFVC: Open a folder first.');
    return undefined;
  }

  let workspaces: WorkspaceInfo[];
  try {
    workspaces = await repo.getWorkspaces(cwd);
  } catch (err: unknown) {
    vscode.window.showErrorMessage(
      `TFVC: Could not list workspaces — ${err instanceof Error ? err.message : err}`
    );
    return undefined;
  }

  if (workspaces.length === 0) {
    vscode.window.showInformationMessage(
      'TFVC: No workspaces found on this machine for the configured server.'
    );
    return undefined;
  }

  // Filter to workspaces whose mappings include the current folder
  const matching = workspaces.filter((ws) =>
    ws.mappings.some((m) =>
      cwd.toLowerCase().startsWith(m.localPath.toLowerCase())
    )
  );

  const candidates = matching.length > 0 ? matching : workspaces;

  if (candidates.length === 1) {
    await saveWorkspace(candidates[0]);
    vscode.window.showInformationMessage(
      `TFVC: Using workspace "${candidates[0].name}" (${candidates[0].owner})`
    );
    return candidates[0];
  }

  // Multiple — ask the user
  const items = candidates.map((ws) => ({
    label: ws.name,
    description: ws.owner,
    detail: ws.mappings
      .map((m) => `${m.serverPath} → ${m.localPath}`)
      .join('  |  '),
    workspace: ws,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'TFVC: Select Workspace',
    placeHolder: 'Choose the workspace that maps to your current folder',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return undefined;
  }

  await saveWorkspace(picked.workspace);
  return picked.workspace;
}

async function saveWorkspace(ws: WorkspaceInfo): Promise<void> {
  await vscode.workspace
    .getConfiguration('tfvc')
    .update('workspace', ws.name, vscode.ConfigurationTarget.Workspace);
}

export function getStoredWorkspace(): string {
  return vscode.workspace.getConfiguration('tfvc').get<string>('workspace', '');
}
