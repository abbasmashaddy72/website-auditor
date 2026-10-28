#!/usr/bin/env node
/** Optional interactive wrapper; no shell command injection, fixed supported actions. */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';
const actions = Object.freeze({
  1: ['run', 'npm', ['run', 'worker:run']],
  2: ['status', 'fish', ['scripts/auditor.fish', 'status']],
  3: ['logs', 'fish', ['scripts/auditor.fish', 'logs']],
  4: ['start', 'fish', ['scripts/auditor.fish', 'start']],
  5: ['stop', 'fish', ['scripts/auditor.fish', 'stop']],
  6: ['restart', 'fish', ['scripts/auditor.fish', 'restart']],
  7: ['doctor', 'fish', ['scripts/auditor.fish', 'doctor']],
});
const choice = process.argv[2];
if (choice && choice !== '0' && !Object.keys(actions).includes(choice)) {
  console.error('Usage: npm run worker -- [1..7]');
  process.exit(2);
}
if (!choice && !stdin.isTTY) {
  console.error(
    'Interactive terminal required. For systemd use npm run worker:run. For automation choose npm run worker -- 1.',
  );
  process.exit(2);
}
const prompt = createInterface({ input: stdin, output: stdout });
let selected = choice;
if (!selected) {
  stdout.write(
    'Website Auditor worker management\n 1) Run foreground worker\n 2) View status\n 3) Follow logs\n 4) Start service\n 5) Stop service\n 6) Restart service\n 7) Diagnose\n 0) Exit\n',
  );
  selected = (await prompt.question('Choose [0]: ')).trim() || '0';
}
if (selected === '0' || !Object.hasOwn(actions, selected)) {
  prompt.close();
  process.exit(selected === '0' ? 0 : 2);
}
if (['5', '6'].includes(selected)) {
  if (!stdin.isTTY) {
    console.error('Stop/restart requires an interactive terminal.');
    process.exit(2);
  }
  const answer = (await prompt.question(`Confirm ${actions[selected][0]} worker service? (yes/no) [no]: `))
    .trim()
    .toLowerCase();
  if (answer !== 'yes') {
    prompt.close();
    process.exit(0);
  }
}
prompt.close();
const [, executable, args] = actions[selected];
const child = spawn(executable, args, { stdio: 'inherit', shell: false });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('error', (err) => {
  console.error('Cannot start worker command:', err.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
