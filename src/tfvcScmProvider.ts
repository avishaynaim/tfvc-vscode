import * as vscode from 'vscode';
import { TfvcRepository } from './tfvcRepository';
import * as configuration from './configuration';
import { ChangeType, PendingChange } from './types';

// Letter badge + color per change type, consistent with standard SCM conventions
const CHANGE_DECORATIONS: Record<
  ChangeType,
  { letter: string; tooltip: string; color?: vscode.ThemeColor; strike?: boolean }
> = {
  add:      { letter: 'A', tooltip: 'Added',    color: new vscode.ThemeColor('gitDecoration.addedResourceForeground') },
  edit:     { letter: 'M', tooltip: 'Modified', color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground') },
  delete:   { letter: 'D', tooltip: 'Deleted',  color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'), strike: true },
  rename:   { letter: 'R', tooltip: 'Renamed',  color: new vscode.ThemeColor('gitDecoration.renamedResourceForeground') },
  branch:   { letter: 'B', tooltip: 'Branched', color: new vscode.ThemeColor('gitDecoration.addedResourceForeground') },
  merge:    { letter: 'G', tooltip: 'Merged',   color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground') },
  lock:     { letter: 'L', tooltip: 'Locked',   color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground') },
  undelete: { letter: 'U', tooltip: 'Undeleted',color: new vscode.ThemeColor('gitDecoration.addedResourceForeground') },
  unknown:  { letter: '?', tooltip: 'Unknown' },
};

export class TfvcScmProvider implements vscode.Disposable {
  private readonly scm: vscode.SourceControl;
  private readonly pendingGroup: vscode.SourceControlResourceGroup;

  private readonly _disposables: vscode.Disposable[] = [];
  private _pollingTimer: ReturnType<typeof setInterval> | undefined;

  /** Last known pending changes (kept so commands can inspect them). */
  pendingChanges: PendingChange[] = [];

  constructor(
    private readonly repository: TfvcRepository,
    private readonly context: vscode.ExtensionContext
  ) {
    const rootUri = getRootUri();
    this.scm = vscode.scm.createSourceControl('tfvc', 'TFVC', rootUri);
    this.scm.acceptInputCommand = {
      command: 'tfvc.checkinFromScm',
      title: 'Check In',
    };
    this.scm.quickDiffProvider = this.buildQuickDiffProvider();
    this.scm.statusBarCommands = [
      {
        command: 'tfvc.refresh',
        title: '$(sync) TFVC',
        tooltip: 'TFVC: Refresh pending changes',
      },
    ];

    this.pendingGroup = this.scm.createResourceGroup('pending', 'Pending Changes');
    this.pendingGroup.hideWhenEmpty = true;

    this._disposables.push(this.scm, this.pendingGroup);

    // Re-scan when config changes (e.g., server URL updated)
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tfvc')) {
          this.refresh();
        }
      })
    );

    // Re-scan on file save so the pending list stays current
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument(() => {
        this.refresh();
      })
    );

    this.startPolling();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async refresh(): Promise<void> {
    const rootPath = configuration.getWorkspaceRoot();
    if (!rootPath) {
      return;
    }

    try {
      this.pendingChanges = await this.repository.getStatus(rootPath);
    } catch {
      // getStatus already logs; don't surface noise on every poll
      this.pendingChanges = [];
    }

    this.pendingGroup.resourceStates = this.pendingChanges.map((c) =>
      this.buildResourceState(c)
    );

    this.scm.count = this.pendingChanges.length;
  }

  /** The text currently in the SCM input box (used as default check-in comment). */
  get inputBoxComment(): string {
    return this.scm.inputBox.value.trim();
  }

  clearInputBox(): void {
    this.scm.inputBox.value = '';
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private buildResourceState(change: PendingChange): vscode.SourceControlResourceState {
    const dec = CHANGE_DECORATIONS[change.changeType];
    const localUri = vscode.Uri.file(change.localItem);

    const state: vscode.SourceControlResourceState = {
      resourceUri: localUri,
      contextValue: `tfvc-change-${change.changeType}`,
      command: {
        command: 'tfvc.compareFromScm',
        title: 'Open Diff',
        arguments: [change],
      },
      decorations: {
        strikeThrough: dec.strike ?? false,
        faded: change.changeType === 'delete',
        tooltip: `TFVC: ${dec.tooltip} — ${change.serverItem}`,
        light: {
          iconPath: this.changeTypeIcon(change.changeType),
        },
        dark: {
          iconPath: this.changeTypeIcon(change.changeType),
        },
      },
    };

    return state;
  }

  private changeTypeIcon(ct: ChangeType): vscode.ThemeIcon {
    const iconMap: Partial<Record<ChangeType, string>> = {
      add:      'diff-added',
      edit:     'diff-modified',
      delete:   'diff-removed',
      rename:   'arrow-right',
      branch:   'git-branch',
      merge:    'git-merge',
      lock:     'lock',
      undelete: 'history',
      unknown:  'question',
    };
    return new vscode.ThemeIcon(
      iconMap[ct] ?? 'circle-outline',
      CHANGE_DECORATIONS[ct].color
    );
  }

  private buildQuickDiffProvider(): vscode.QuickDiffProvider {
    const repo = this.repository;
    const rootPath = configuration.getWorkspaceRoot();

    return {
      provideOriginalResource(uri: vscode.Uri): vscode.ProviderResult<vscode.Uri> {
        if (uri.scheme !== 'file') {
          return undefined;
        }
        // Return a tfvc-server: URI so VS Code can show inline gutter diffs
        const { TfvcContentProvider } = require('./tfvcContentProvider') as typeof import('./tfvcContentProvider');
        return TfvcContentProvider.buildUri(uri.fsPath);
      },
    };
  }

  private startPolling(): void {
    this.stopPolling();
    const interval = configuration.getPollingInterval();
    if (interval > 0) {
      this._pollingTimer = setInterval(() => this.refresh(), interval * 1000);
    }
  }

  private stopPolling(): void {
    if (this._pollingTimer !== undefined) {
      clearInterval(this._pollingTimer);
      this._pollingTimer = undefined;
    }
  }

  dispose(): void {
    this.stopPolling();
    this._disposables.forEach((d) => d.dispose());
  }
}

function getRootUri(): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri : undefined;
}
