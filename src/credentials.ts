import * as vscode from 'vscode';
import * as configuration from './configuration';
import { StoredCredentials } from './types';

const SECRET_KEY = 'tfvc.credentials';

export class CredentialManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getStored(): Promise<StoredCredentials | undefined> {
    const raw = await this.secrets.get(SECRET_KEY);
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as StoredCredentials;
    } catch {
      return undefined;
    }
  }

  async store(creds: StoredCredentials): Promise<void> {
    await this.secrets.store(SECRET_KEY, JSON.stringify(creds));
  }

  async clear(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }

  /**
   * Prompt the user for username (DOMAIN\user or user@domain) and password,
   * optionally pre-filling from previously stored credentials.
   */
  async promptAndStore(existing?: StoredCredentials): Promise<StoredCredentials | undefined> {
    const usernameInput = await vscode.window.showInputBox({
      title: 'TFVC Login — Username',
      prompt: 'Enter your Windows username (e.g. DOMAIN\\user or user@corp.com)',
      value: existing ? `${existing.domain ? existing.domain + '\\' : ''}${existing.username}` : '',
      ignoreFocusOut: true
    });
    if (usernameInput === undefined) {
      return undefined; // user cancelled
    }

    const passwordInput = await vscode.window.showInputBox({
      title: 'TFVC Login — Password',
      prompt: 'Enter your password',
      password: true,
      ignoreFocusOut: true
    });
    if (passwordInput === undefined) {
      return undefined;
    }

    const { domain, username } = parseUsername(usernameInput);
    const creds: StoredCredentials = { domain, username, password: passwordInput };
    await this.store(creds);
    return creds;
  }

  /**
   * Build the /login: argument string for tf.exe.
   * Returns an empty array when Windows auth should be used (no /login needed).
   */
  async buildLoginArgs(): Promise<string[]> {
    if (configuration.useWindowsAuth()) {
      return [];
    }

    let creds = await this.getStored();
    if (!creds) {
      vscode.window.showInformationMessage(
        'TFVC: No credentials stored. Please enter your login details.'
      );
      creds = await this.promptAndStore();
      if (!creds) {
        throw new Error('TFVC: Authentication cancelled by user.');
      }
    }

    const userArg = creds.domain
      ? `${creds.domain}\\${creds.username}`
      : creds.username;

    return [`/login:${userArg},${creds.password}`];
  }

  /**
   * Called when tf.exe returns an authentication error.
   * Clears stored creds and asks the user to re-enter them.
   */
  async handleAuthFailure(): Promise<string[] | undefined> {
    const choice = await vscode.window.showErrorMessage(
      'TFVC: Authentication failed. Would you like to enter new credentials?',
      'Enter Credentials',
      'Switch to Windows Auth',
      'Cancel'
    );

    if (choice === 'Enter Credentials') {
      await configuration.setUseWindowsAuth(false);
      const existing = await this.getStored();
      const creds = await this.promptAndStore(existing);
      if (!creds) {
        return undefined;
      }
      const userArg = creds.domain
        ? `${creds.domain}\\${creds.username}`
        : creds.username;
      return [`/login:${userArg},${creds.password}`];
    }

    if (choice === 'Switch to Windows Auth') {
      await configuration.setUseWindowsAuth(true);
      await this.clear();
      return [];
    }

    return undefined;
  }
}

function parseUsername(raw: string): { domain: string; username: string } {
  // Handles DOMAIN\user or user@domain formats
  const backslash = raw.indexOf('\\');
  if (backslash !== -1) {
    return { domain: raw.substring(0, backslash), username: raw.substring(backslash + 1) };
  }
  const at = raw.indexOf('@');
  if (at !== -1) {
    return { domain: raw.substring(at + 1), username: raw.substring(0, at) };
  }
  return { domain: '', username: raw };
}
