/**
 * Safe Shell Execution
 *
 * Only whitelisted commands are allowed. No arbitrary execution.
 * On the primary (Linux VPS), runs Docker and mysqldump commands.
 * On replicas (Windows), only runs local diagnostics.
 */

import { spawn, type ChildProcess } from "child_process";
import type { NodeRole } from "../bridge.config";

/** Commands allowed on the PRIMARY node (Linux VPS) */
const PRIMARY_WHITELIST = new Set([
  "docker",
  "mysqldump",
  "mysql",
  "docker-compose",
  "gzip",
  "gunzip",
  "curl",
  "ping",
]);

/** Commands allowed on REPLICA nodes (Windows VPS / GrudgeYonko) */
const REPLICA_WHITELIST = new Set([
  "ping",
  "curl",
  "mysqldump",
  "mysql",
  "powershell", // Only for Get-Process / diagnostics
]);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Execute a whitelisted command with arguments.
 * Rejects if the command binary is not in the whitelist.
 */
export function safeExec(
  command: string,
  args: string[],
  role: NodeRole,
  options?: { cwd?: string; timeout?: number; env?: Record<string, string> }
): Promise<ExecResult> {
  const whitelist = role === "primary" ? PRIMARY_WHITELIST : REPLICA_WHITELIST;

  // Extract the base command (handle paths like /usr/bin/docker)
  const baseCmd = command.split("/").pop()?.split("\\").pop() || command;

  if (!whitelist.has(baseCmd)) {
    return Promise.reject(
      new Error(
        `Command "${baseCmd}" not in ${role} whitelist. Allowed: ${[...whitelist].join(", ")}`
      )
    );
  }

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child: ChildProcess = spawn(command, args, {
      cwd: options?.cwd,
      timeout: options?.timeout || 300_000, // 5 min default
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk));

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 1,
        durationMs: Date.now() - start,
      });
    });
  });
}

/**
 * Run mysqldump via Docker exec (primary) or direct binary (replica).
 * Returns the raw SQL dump as a buffer.
 */
export async function mysqlDump(
  role: NodeRole,
  opts: {
    container?: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  }
): Promise<ExecResult> {
  if (role === "primary" && opts.container) {
    // Run mysqldump inside the Docker container
    return safeExec("docker", [
      "exec",
      opts.container,
      "mysqldump",
      `-u${opts.user}`,
      `-p${opts.password}`,
      "--single-transaction",
      "--routines",
      "--triggers",
      "--events",
      opts.database,
    ], role);
  }

  // Direct mysqldump (replica connecting over Radmin/ZeroTier)
  return safeExec("mysqldump", [
    `-h${opts.host}`,
    `-P${opts.port}`,
    `-u${opts.user}`,
    `-p${opts.password}`,
    "--single-transaction",
    "--routines",
    "--triggers",
    "--events",
    opts.database,
  ], role);
}

/**
 * Run a SQL command via Docker exec (primary) or direct mysql (replica).
 */
export async function mysqlExec(
  role: NodeRole,
  sql: string,
  opts: {
    container?: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  }
): Promise<ExecResult> {
  if (role === "primary" && opts.container) {
    return safeExec("docker", [
      "exec",
      opts.container,
      "mysql",
      `-u${opts.user}`,
      `-p${opts.password}`,
      opts.database,
      "-N",
      "-e",
      sql,
    ], role);
  }

  return safeExec("mysql", [
    `-h${opts.host}`,
    `-P${opts.port}`,
    `-u${opts.user}`,
    `-p${opts.password}`,
    opts.database,
    "-N",
    "-e",
    sql,
  ], role);
}
