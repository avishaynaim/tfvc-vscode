import * as path from 'path';
import * as vscode from 'vscode';
import * as configuration from './configuration';
import { ChangeType, PendingChange } from './types';

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

export class SectionItem extends vscode.TreeItem {
  constructor(
    public readonly sectionId: string,
    label: string,
    state: vscode.TreeItemCollapsibleState
  ) {
    super(label, state);
    this.contextValue = `tfvc-section-${sectionId}`;
  }
}

export class ConfigItem extends vscode.TreeItem {
  constructor(
    label: string,
    detail: string,
    public readonly configKey: string,
    command: string,
    iconId: string,
    commandArgs?: unknown[]
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = detail;
    this.tooltip = `${label}: ${detail}\nClick to change`;
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.contextValue = `tfvc-config-${configKey}`;
    this.command = {
      command,
      title: label,
      arguments: commandArgs,
    };
  }
}

export class PendingChangeItem extends vscode.TreeItem {
  constructor(
    public readonly change: PendingChange,
    placeholder = false
  ) {
    super(
      placeholder ? '(no pending changes)' : path.basename(change.localItem),
      vscode.TreeItemCollapsibleState.None
    );

    if (placeholder) {
      this.contextValue = 'tfvc-no-changes';
      this.iconPath = new vscode.ThemeIcon('check');
      return;
    }

    const { letter, iconId, color } = changeDecorations(change.changeType);
    this.description = `[${letter}]  ${shortenPath(change.localItem)}`;
    this.tooltip = `${change.changeType.toUpperCase()}  ${change.serverItem}\n${change.localItem}`;
    this.iconPath = new vscode.ThemeIcon(iconId, color);
    this.contextValue =
      change.changeType === 'add' ? 'tfvc-pending-add' : 'tfvc-pending-change';
    this.resourceUri = vscode.Uri.file(change.localItem);

    // Click a pending change → open diff vs server
    this.command = {
      command: 'tfvc.compareFromScm',
      title: 'Compare with Server',
      arguments: [change],
    };
  }
}

export type TfvcTreeItem = SectionItem | ConfigItem | PendingChangeItem;

// ---------------------------------------------------------------------------
// Tree data provider
// ---------------------------------------------------------------------------

export class TfvcTreeProvider
  implements vscode.TreeDataProvider<TfvcTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<TfvcTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _pendingChanges: PendingChange[] = [];

  /** Called by TfvcScmProvider after every refresh so both panels stay in sync. */
  update(pendingChanges: PendingChange[]): void {
    this._pendingChanges = pendingChanges;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Force a UI refresh without changing the change list (e.g. after config update). */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TfvcTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TfvcTreeItem): TfvcTreeItem[] {
    if (!element) {
      return [
        new SectionItem(
          'config',
          'Configuration',
          vscode.TreeItemCollapsibleState.Expanded
        ),
        new SectionItem(
          'pending',
          `Pending Changes${
            this._pendingChanges.length > 0
              ? ` (${this._pendingChanges.length})`
              : ''
          }`,
          vscode.TreeItemCollapsibleState.Expanded
        ),
      ];
    }

    if (element instanceof SectionItem) {
      if (element.sectionId === 'config') {
        return this.buildConfigItems();
      }
      if (element.sectionId === 'pending') {
        return this.buildPendingItems();
      }
    }

    return [];
  }

  // -------------------------------------------------------------------------
  // Section builders
  // -------------------------------------------------------------------------

  private buildConfigItems(): ConfigItem[] {
    const serverUrl = configuration.getServerUrl();
    const tfPath = configuration.findTfExe();
    const useWinAuth = configuration.useWindowsAuth();
    const poll = configuration.getPollingInterval();

    return [
      new ConfigItem(
        'Server URL',
        serverUrl || '⚠  not configured — click to set',
        'serverUrl',
        'tfvc.setServer',
        serverUrl ? 'server' : 'warning'
      ),
      new ConfigItem(
        'Authentication',
        useWinAuth ? 'Windows (current user)' : 'Manual credentials',
        'auth',
        'tfvc.setCredentials',
        'key'
      ),
      new ConfigItem(
        'TF.exe',
        tfPath ? path.basename(tfPath) : '⚠  not found — click to set',
        'tfExe',
        'tfvc.setTfPath',
        tfPath ? 'file-binary' : 'error'
      ),
      new ConfigItem(
        'Auto-refresh',
        poll > 0 ? `every ${poll}s` : 'disabled',
        'polling',
        'workbench.action.openSettings',
        'watch',
        ['tfvc.pollingIntervalSeconds']
      ),
      new ConfigItem(
        'All Settings',
        'Open settings.json / UI',
        'openSettings',
        'workbench.action.openSettings',
        'gear',
        ['@ext:tfvc-manager.tfvc-manager']
      ),
    ];
  }

  private buildPendingItems(): PendingChangeItem[] {
    if (this._pendingChanges.length === 0) {
      return [new PendingChangeItem({} as PendingChange, true)];
    }
    return this._pendingChanges.map((c) => new PendingChangeItem(c));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function changeDecorations(
  ct: ChangeType
): { letter: string; iconId: string; color: vscode.ThemeColor } {
  const map: Record<
    ChangeType,
    { letter: string; iconId: string; colorToken: string }
  > = {
    add:      { letter: 'A', iconId: 'diff-added',    colorToken: 'gitDecoration.addedResourceForeground' },
    edit:     { letter: 'M', iconId: 'diff-modified', colorToken: 'gitDecoration.modifiedResourceForeground' },
    delete:   { letter: 'D', iconId: 'diff-removed',  colorToken: 'gitDecoration.deletedResourceForeground' },
    rename:   { letter: 'R', iconId: 'arrow-right',   colorToken: 'gitDecoration.renamedResourceForeground' },
    branch:   { letter: 'B', iconId: 'git-branch',    colorToken: 'gitDecoration.addedResourceForeground' },
    merge:    { letter: 'G', iconId: 'git-merge',     colorToken: 'gitDecoration.modifiedResourceForeground' },
    lock:     { letter: 'L', iconId: 'lock',          colorToken: 'gitDecoration.modifiedResourceForeground' },
    undelete: { letter: 'U', iconId: 'history',       colorToken: 'gitDecoration.addedResourceForeground' },
    unknown:  { letter: '?', iconId: 'question',      colorToken: 'disabledForeground' },
  };
  const d = map[ct] ?? map.unknown;
  return { letter: d.letter, iconId: d.iconId, color: new vscode.ThemeColor(d.colorToken) };
}

function shortenPath(fsPath: string): string {
  const root = configuration.getWorkspaceRoot();
  if (root && fsPath.startsWith(root)) {
    return fsPath.substring(root.length).replace(/^[/\\]/, '');
  }
  return fsPath;
}
