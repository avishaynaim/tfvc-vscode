import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// All known tf.exe locations across Visual Studio editions and versions
const TF_SEARCH_PATHS: string[] = [
  // VS 2022 — 64-bit Program Files
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  // VS 2019 — 32-bit Program Files
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  // VS 2017
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Enterprise\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Professional\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\BuildTools\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe',
  // VS 2015
  'C:\\Program Files (x86)\\Microsoft Visual Studio 14.0\\Common7\\IDE\\TF.exe',
  // VS 2013
  'C:\\Program Files (x86)\\Microsoft Visual Studio 12.0\\Common7\\IDE\\TF.exe',
  // VS 2012
  'C:\\Program Files (x86)\\Microsoft Visual Studio 11.0\\Common7\\IDE\\TF.exe',
  // VS 2010
  'C:\\Program Files (x86)\\Microsoft Visual Studio 10.0\\Common7\\IDE\\TF.exe',
  // Team Explorer Everywhere (cross-platform, needs Java — 'tf' on PATH)
  'tf',
];

export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('tfvc');
}

export function getServerUrl(): string {
  return getConfig().get<string>('serverUrl', '').trim();
}

export function getCustomTfPath(): string {
  return getConfig().get<string>('tfExePath', '').trim();
}

export function isAutoDetect(): boolean {
  return getConfig().get<boolean>('autoDetectTfPath', true);
}

export function useWindowsAuth(): boolean {
  return getConfig().get<boolean>('useWindowsAuth', true);
}

export function getDefaultComment(): string {
  return getConfig().get<string>('defaultCheckinComment', '');
}

export function getPollingInterval(): number {
  return getConfig().get<number>('pollingIntervalSeconds', 0);
}

export function confirmUndo(): boolean {
  return getConfig().get<boolean>('confirmUndo', true);
}

export async function setServerUrl(url: string): Promise<void> {
  await getConfig().update('serverUrl', url, vscode.ConfigurationTarget.Global);
}

export async function setTfExePath(tfPath: string): Promise<void> {
  await getConfig().update('tfExePath', tfPath, vscode.ConfigurationTarget.Global);
  await getConfig().update('autoDetectTfPath', false, vscode.ConfigurationTarget.Global);
}

export async function setUseWindowsAuth(value: boolean): Promise<void> {
  await getConfig().update('useWindowsAuth', value, vscode.ConfigurationTarget.Global);
}

/**
 * Resolves the tf.exe path: checks the user-configured path first, then
 * walks the known Visual Studio installation paths.
 */
export function findTfExe(): string | undefined {
  const custom = getCustomTfPath();
  if (custom) {
    if (fs.existsSync(custom)) {
      return custom;
    }
    // Config is set but file missing — report problem but still try auto-detect
    vscode.window.showWarningMessage(
      `TFVC: Configured tf.exe not found at "${custom}". Falling back to auto-detection.`
    );
  }

  if (!isAutoDetect()) {
    return undefined;
  }

  for (const candidate of TF_SEARCH_PATHS) {
    if (candidate === 'tf') {
      // Check whether 'tf' is on PATH (TEE / cross-platform)
      continue; // handled separately — do not call fs.existsSync('tf')
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Check if TEE 'tf' is on PATH (cross-platform fallback)
  try {
    const { execSync } = require('child_process');
    execSync('tf help', { stdio: 'ignore', timeout: 3000 });
    return 'tf';
  } catch {
    // not on PATH
  }

  return undefined;
}

/**
 * Interactively search for tf.exe across common directories using a glob
 * pattern for cases where VS is installed under a non-standard root.
 */
export async function browseTfExe(): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'Executable': ['exe'] },
    title: 'Select TF.exe from Visual Studio installation',
    openLabel: 'Select TF.exe'
  });
  if (uris && uris.length > 0) {
    const selected = uris[0].fsPath;
    await setTfExePath(selected);
    return selected;
  }
  return undefined;
}

/** Return the workspace root directory (first folder in the workspace). */
export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return undefined;
}

/** Derive the workspace path for a resource URI. */
export function getWorkspaceFolderPath(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder?.uri.fsPath ?? getWorkspaceRoot();
}

/** Build a safe display path for UI messages (trims long paths). */
export function displayPath(fsPath: string): string {
  const root = getWorkspaceRoot();
  if (root && fsPath.startsWith(root)) {
    return fsPath.substring(root.length).replace(/^[/\\]/, '');
  }
  return path.basename(fsPath);
}
