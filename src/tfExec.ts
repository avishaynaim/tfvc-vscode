import * as cp from 'child_process';
import * as vscode from 'vscode';
import { TfExecResult } from './types';

const AUTH_ERROR_PATTERNS = [
  /TF30063/i,           // You are not authorized
  /401\s*unauthorized/i,
  /access denied/i,
  /authentication failed/i,
  /could not authenticate/i,
];

export class TfExec {
  constructor(
    private tfPath: string,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  updateTfPath(newPath: string): void {
    this.tfPath = newPath;
  }

  /**
   * Execute tf.exe with the given arguments.
   *
   * @param args       Core tf.exe arguments (e.g. ['status', '/recursive'])
   * @param extraArgs  Additional arguments appended after core args (login, collection)
   * @param cwd        Working directory for the process
   */
  async exec(
    args: string[],
    extraArgs: string[] = [],
    cwd?: string
  ): Promise<TfExecResult> {
    const allArgs = [...args, ...extraArgs, '/noprompt'];
    const cmdDisplay = `"${this.tfPath}" ${allArgs.join(' ')}`;
    this.outputChannel.appendLine(`\n> ${cmdDisplay}`);

    return new Promise((resolve, reject) => {
      const proc = cp.spawn(this.tfPath, allArgs, {
        cwd,
        env: process.env,
        windowsHide: true,
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdout += text;
        this.outputChannel.append(text);
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderr += text;
        this.outputChannel.append(text);
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              `tf.exe not found at "${this.tfPath}". ` +
              `Use TFVC: Set TF.exe Path… to configure it.`
            )
          );
        } else {
          reject(new Error(`Failed to launch tf.exe: ${err.message}`));
        }
      });

      proc.on('close', (code: number | null) => {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });
    });
  }

  /**
   * Returns true when the result indicates an authentication / authorization problem.
   */
  static isAuthError(result: TfExecResult): boolean {
    const combined = result.stdout + result.stderr;
    return AUTH_ERROR_PATTERNS.some((re) => re.test(combined));
  }

  /**
   * Returns true when the result indicates a general failure (not just a warning).
   */
  static isError(result: TfExecResult): boolean {
    return result.exitCode >= 100;
  }

  /**
   * Extract error message lines from tf.exe output.
   */
  static extractError(result: TfExecResult): string {
    const combined = (result.stderr || result.stdout).trim();
    // tf.exe prefixes errors with "TF" codes, e.g. "TF14044: ..."
    const lines = combined
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(0, 5);
    return lines.join('\n') || `tf.exe exited with code ${result.exitCode}`;
  }
}
