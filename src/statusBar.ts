import * as vscode from 'vscode';

export class TfvcStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      10
    );
    this.setDisconnected();
    this.item.show();
  }

  setDisconnected(): void {
    this.item.text = '$(source-control) TFVC';
    this.item.tooltip = 'TFVC: Not configured — click to set server URL';
    this.item.command = 'tfvc.configure';
    this.item.backgroundColor = undefined;
    this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
  }

  setOffline(): void {
    this.item.text = '$(source-control) TFVC Offline';
    this.item.tooltip = 'TFVC: Server unreachable — working in offline mode';
    this.item.command = 'tfvc.showOutput';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.item.color = undefined;
  }

  setConnected(pendingCount: number): void {
    const icon = pendingCount > 0 ? '$(source-control)' : '$(check)';
    this.item.text = `${icon} TFVC ${pendingCount > 0 ? pendingCount + ' pending' : 'up to date'}`;
    this.item.tooltip =
      pendingCount > 0
        ? `TFVC: ${pendingCount} pending change(s) — click to refresh`
        : 'TFVC: No pending changes — click to refresh';
    this.item.command = 'tfvc.refresh';
    this.item.backgroundColor =
      pendingCount > 0
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
    this.item.color = undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
