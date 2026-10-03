#!/usr/bin/env node
// Compatibility launcher only. All CLI/backend behavior lives in Python.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.env.NAVOCODE_PYTHON || 'python3', [fileURLToPath(new URL('./navocode.py', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) { process.stderr.write('NavoCode requires Python 3.10+: ' + result.error.message + '\n'); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
