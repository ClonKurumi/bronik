// Режим разработки: `npm run dev`.
// Собирает проект, затем следит за src/: при изменениях пересобирает TypeScript
// и перезапускает сервер. Ctrl+C останавливает всё.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
const node = process.execPath;

// 1. Первая сборка — чтобы сервер стартовал с готовым кодом.
for (const cfg of ['tsconfig.server.json', 'tsconfig.client.json']) {
  const r = spawnSync(node, [tsc, '-p', cfg], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) console.warn(`\n⚠ Ошибки типов в ${cfg} — сервер всё равно запускается.\n`);
}

// 2. Пересборка при изменениях + сервер, который перезапускается при новой сборке.
const procs = [
  spawn(node, [tsc, '-p', 'tsconfig.server.json', '--watch', '--preserveWatchOutput'], { cwd: root, stdio: 'inherit' }),
  spawn(node, [tsc, '-p', 'tsconfig.client.json', '--watch', '--preserveWatchOutput'], { cwd: root, stdio: 'inherit' }),
  spawn(node, ['--watch-path=dist', 'dist/server/server.js'], { cwd: root, stdio: 'inherit' }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
