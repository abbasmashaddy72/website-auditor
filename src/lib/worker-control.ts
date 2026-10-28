import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redactText } from './redact';
const execute = promisify(execFile);
const UNIT = 'website-auditor-worker.service';
const TIMEOUT_MS = 12000;
function sanitizeLog(text: string) {
  return redactText(text)
    .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/(https?:\/\/)[^@\s/]+:[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|password|secret|session|auth|key|signature|code)=)[^\s&]+/gi, '$1[REDACTED]');
}
export function workerControlEnabled(): boolean {
  return process.env.AUDITOR_WORKER_CONTROL === 'systemd' && process.platform === 'linux';
}
export async function workerService(operation: 'start' | 'stop' | 'restart' | 'status' | 'logs') {
  if (operation !== 'status' && operation !== 'logs' && !workerControlEnabled())
    throw Error('Worker process control is disabled; use the host supervisor');
  const program = operation === 'logs' ? 'journalctl' : 'systemctl';
  const args =
    operation === 'logs'
      ? ['--user', '-u', UNIT, '-n', '100', '--no-pager', '--output=short-iso']
      : operation === 'status'
        ? ['--user', 'show', UNIT, '--property=ActiveState,SubState,MainPID,ExecMainStatus']
        : ['--user', operation, UNIT];
  try {
    const { stdout, stderr } = await execute(program, args, { timeout: TIMEOUT_MS, maxBuffer: 512 * 1024 });
    return sanitizeLog(`${stdout}\n${stderr}`).slice(0, 50000);
  } catch (error) {
    const value = error as Error & { stdout?: string; stderr?: string };
    throw Error(sanitizeLog(value.stderr || value.message || 'Worker supervisor unavailable').slice(0, 500));
  }
}
