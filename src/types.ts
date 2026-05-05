export type ChangeType =
  | 'add'
  | 'edit'
  | 'delete'
  | 'rename'
  | 'branch'
  | 'merge'
  | 'lock'
  | 'undelete'
  | 'unknown';

export interface PendingChange {
  serverItem: string;
  localItem: string;
  changeType: ChangeType;
  version: string;
  sourceItem?: string;
  lock?: string;
  workspace?: string;
}

export interface ChangesetInfo {
  id: number;
  owner: string;
  date: string;
  comment: string;
  items: ChangesetItem[];
}

export interface ChangesetItem {
  changeType: string;
  serverItem: string;
}

export interface WorkspaceInfo {
  name: string;
  owner: string;
  computer: string;
  serverUrl: string;
  mappings: WorkspaceMapping[];
}

export interface WorkspaceMapping {
  serverPath: string;
  localPath: string;
}

export interface TfExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface StoredCredentials {
  username: string;
  domain: string;
  password: string;
}
