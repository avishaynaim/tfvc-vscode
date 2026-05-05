import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TfExec } from './tfExec';
import { CredentialManager } from './credentials';
import * as configuration from './configuration';
import {
  ChangesetInfo,
  ChangesetItem,
  ChangeType,
  PendingChange,
  TfExecResult,
  WorkspaceInfo,
} from './types';

export class TfvcRepository {
  constructor(
    private readonly exec: TfExec,
    private readonly credentials: CredentialManager,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async buildExtraArgs(): Promise<string[]> {
    const args: string[] = [];
    const url = configuration.getServerUrl();
    if (url) {
      args.push(`/collection:${url}`);
    }
    const loginArgs = await this.credentials.buildLoginArgs();
    args.push(...loginArgs);
    return args;
  }

  private async run(
    args: string[],
    cwd?: string
  ): Promise<TfExecResult> {
    const extra = await this.buildExtraArgs();
    let result = await this.exec.exec(args, extra, cwd);

    if (TfExec.isAuthError(result)) {
      const newLoginArgs = await this.credentials.handleAuthFailure();
      if (newLoginArgs === undefined) {
        throw new Error('TFVC: Authentication cancelled.');
      }
      // Retry with new credentials
      const url = configuration.getServerUrl();
      const retryExtra = url ? [`/collection:${url}`, ...newLoginArgs] : [...newLoginArgs];
      result = await this.exec.exec(args, retryExtra, cwd);
      if (TfExec.isAuthError(result)) {
        throw new Error('TFVC: Authentication still failing after credential update.');
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /** Returns all pending changes for the given root path. */
  async getStatus(rootPath: string): Promise<PendingChange[]> {
    const result = await this.run(
      ['status', rootPath, '/recursive', '/format:xml'],
      rootPath
    );

    if (TfExec.isError(result)) {
      // If no workspace found, return empty rather than throw
      if (/TF400235|TF14044|no workspace/i.test(result.stderr + result.stdout)) {
        return [];
      }
      throw new Error(TfExec.extractError(result));
    }

    return parseStatusXml(result.stdout);
  }

  // -------------------------------------------------------------------------
  // Check out
  // -------------------------------------------------------------------------

  async checkout(filePaths: string[], cwd?: string): Promise<void> {
    if (filePaths.length === 0) {
      return;
    }
    const result = await this.run(
      ['checkout', '/lock:none', ...filePaths],
      cwd
    );
    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }
  }

  // -------------------------------------------------------------------------
  // Check in
  // -------------------------------------------------------------------------

  async checkin(
    filePaths: string[],
    comment: string,
    cwd?: string
  ): Promise<number | undefined> {
    if (filePaths.length === 0) {
      return undefined;
    }
    const args = [
      'checkin',
      `/comment:${comment || '*** no comment ***'}`,
      '/override:Policy Failure',
      '/noprompt',
      ...filePaths,
    ];
    const result = await this.run(args, cwd);
    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }
    // Parse "Changeset #12345 checked in." from stdout
    const m = result.stdout.match(/Changeset\s+#?(\d+)/i);
    return m ? parseInt(m[1], 10) : undefined;
  }

  // -------------------------------------------------------------------------
  // Undo
  // -------------------------------------------------------------------------

  async undo(filePaths: string[], cwd?: string): Promise<void> {
    if (filePaths.length === 0) {
      return;
    }
    const result = await this.run(
      ['undo', '/recursive', ...filePaths],
      cwd
    );
    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }
  }

  // -------------------------------------------------------------------------
  // Get latest
  // -------------------------------------------------------------------------

  async getLatest(filePaths: string[], cwd?: string): Promise<void> {
    const targets = filePaths.length > 0 ? filePaths : ['.'];
    const result = await this.run(
      ['get', '/version:T', '/recursive', ...targets],
      cwd
    );
    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }
  }

  // -------------------------------------------------------------------------
  // Add / Delete
  // -------------------------------------------------------------------------

  async add(filePaths: string[], cwd?: string): Promise<void> {
    if (filePaths.length === 0) {
      return;
    }
    const result = await this.run(['add', '/recursive', ...filePaths], cwd);
    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }
  }

  async delete(filePaths: string[], cwd?: string): Promise<void> {
    if (filePaths.length === 0) {
      return;
    }
    const result = await this.run(['delete', '/recursive', ...filePaths], cwd);
    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getHistory(
    filePath: string,
    maxCount = 50,
    cwd?: string
  ): Promise<ChangesetInfo[]> {
    const result = await this.run(
      [
        'history',
        filePath,
        '/recursive',
        `/stopafter:${maxCount}`,
        '/format:xml',
      ],
      cwd
    );
    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }
    return parseHistoryXml(result.stdout);
  }

  // -------------------------------------------------------------------------
  // File content at a version (for diff)
  // -------------------------------------------------------------------------

  /** Retrieves the server (latest tip) version of a file and writes it to a temp file. */
  async getServerContent(localPath: string, cwd?: string): Promise<string> {
    const tmpPath = path.join(
      os.tmpdir(),
      `tfvc_server_${Date.now()}_${path.basename(localPath)}`
    );

    const result = await this.run(
      ['view', localPath, '/version:T', `/output:${tmpPath}`],
      cwd
    );

    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }

    return tmpPath;
  }

  /** Returns the raw server content as a string buffer (used by the content provider). */
  async getServerContentBuffer(localPath: string, cwd?: string): Promise<Uint8Array> {
    const tmpPath = await this.getServerContent(localPath, cwd);
    try {
      return fs.readFileSync(tmpPath);
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shelve / Unshelve
  // -------------------------------------------------------------------------

  async shelve(
    shelvesetName: string,
    comment: string,
    filePaths: string[],
    cwd?: string
  ): Promise<void> {
    const args = [
      'shelve',
      `/comment:${comment || 'Shelved changes'}`,
      '/replace',
      shelvesetName,
      ...filePaths,
    ];
    const result = await this.run(args, cwd);
    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }
  }

  async unshelve(shelvesetName: string, cwd?: string): Promise<void> {
    const result = await this.run(['unshelve', shelvesetName], cwd);
    if (TfExec.isError(result)) {
      throw new Error(TfExec.extractError(result));
    }
  }

  // -------------------------------------------------------------------------
  // Workspace info
  // -------------------------------------------------------------------------

  async getWorkspaceInfo(localPath: string): Promise<WorkspaceInfo | undefined> {
    try {
      const result = await this.run(
        ['workfold', '/format:xml', localPath],
        localPath
      );
      if (TfExec.isError(result)) {
        return undefined;
      }
      return parseWorkspaceXml(result.stdout);
    } catch {
      return undefined;
    }
  }

  /** Quick check: does this path belong to a TFVC workspace? */
  async isInWorkspace(localPath: string): Promise<boolean> {
    try {
      const result = await this.run(
        ['workfold', localPath],
        localPath
      );
      return result.exitCode === 0 && /\$\//i.test(result.stdout);
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// XML parsers
// ---------------------------------------------------------------------------

function attrVal(attrs: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`, 'i');
  const m = attrs.match(re);
  return m ? decodeXmlEntities(m[1]) : '';
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseChangeType(raw: string): ChangeType {
  const lower = raw.toLowerCase();
  if (lower.includes('add'))      { return 'add'; }
  if (lower.includes('delete'))   { return 'delete'; }
  if (lower.includes('rename'))   { return 'rename'; }
  if (lower.includes('branch'))   { return 'branch'; }
  if (lower.includes('merge'))    { return 'merge'; }
  if (lower.includes('lock'))     { return 'lock'; }
  if (lower.includes('undelete')) { return 'undelete'; }
  if (lower.includes('edit'))     { return 'edit'; }
  return 'unknown';
}

function parseStatusXml(xml: string): PendingChange[] {
  const changes: PendingChange[] = [];
  // Match both self-closing and non-self-closing tags
  const tagRe = /<pending-change\s+([^>]+?)(?:\/>|>)/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const attrs = m[1];
    changes.push({
      serverItem:  attrVal(attrs, 'server-item'),
      localItem:   attrVal(attrs, 'local-item'),
      changeType:  parseChangeType(attrVal(attrs, 'change-type')),
      version:     attrVal(attrs, 'version'),
      sourceItem:  attrVal(attrs, 'source-item') || undefined,
      lock:        attrVal(attrs, 'lock') || undefined,
      workspace:   attrVal(attrs, 'workspace') || undefined,
    });
  }
  return changes;
}

function parseHistoryXml(xml: string): ChangesetInfo[] {
  const sets: ChangesetInfo[] = [];
  const setRe = /<changeset\s+([^>]+?)>([\s\S]*?)<\/changeset>/gi;
  const itemRe = /<item\s+([^>]+?)(?:\/>|>)/gi;

  let m: RegExpExecArray | null;
  while ((m = setRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const items: ChangesetItem[] = [];

    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(body)) !== null) {
      items.push({
        changeType: attrVal(im[1], 'change-type'),
        serverItem: attrVal(im[1], 'server-item'),
      });
    }
    itemRe.lastIndex = 0;

    sets.push({
      id:      parseInt(attrVal(attrs, 'id'), 10),
      owner:   attrVal(attrs, 'owner'),
      date:    attrVal(attrs, 'date'),
      comment: attrVal(attrs, 'comment'),
      items,
    });
  }
  return sets;
}

function parseWorkspaceXml(xml: string): WorkspaceInfo | undefined {
  const wsRe = /<workspace\s+([^>]+?)>/i;
  const wsMatch = xml.match(wsRe);
  if (!wsMatch) {
    return undefined;
  }
  const wsAttrs = wsMatch[1];
  const mappings: WorkspaceInfo['mappings'] = [];
  const mapRe = /<map\s+([^>]+?)(?:\/>|>)/gi;
  let mm: RegExpExecArray | null;
  while ((mm = mapRe.exec(xml)) !== null) {
    mappings.push({
      serverPath: attrVal(mm[1], 'server-item'),
      localPath:  attrVal(mm[1], 'local-item'),
    });
  }
  return {
    name:      attrVal(wsAttrs, 'name'),
    owner:     attrVal(wsAttrs, 'owner'),
    computer:  attrVal(wsAttrs, 'computer'),
    serverUrl: attrVal(wsAttrs, 'server'),
    mappings,
  };
}
