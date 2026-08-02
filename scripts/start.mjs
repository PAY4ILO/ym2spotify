/**
 * Запуск в одно действие: проверить окружение, доустановить и собрать что нужно,
 * поднять сервер и открыть браузер.
 *
 * Смысл в том, чтобы человеку не пришлось знать ни про npm, ни про порты.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4321;
const URL_TO_OPEN = `http://127.0.0.1:${PORT}`;

const MIN_NODE_MAJOR = 20;

function log(message) {
  console.log(`  ${message}`);
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** npm на Windows — это .cmd, напрямую как исполняемый файл он не запускается. */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    fail(
      `Нужен Node.js ${MIN_NODE_MAJOR} или новее, а установлен ${process.versions.node}.\n` +
        '  Скачать: https://nodejs.org',
    );
  }
}

/**
 * Занят ли порт.
 *
 * Проверяем именно подключением, а не пробной привязкой: сервер Next слушает
 * на `::` (IPv6 с dual-stack), и привязка к `127.0.0.1` такую занятость
 * не замечает — порт выглядит свободным, а через секунду прилетает EADDRINUSE.
 */
function portBusy() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };

    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(PORT, '127.0.0.1');
  });
}

/** Самая свежая правка среди исходников — по ней понимаем, устарела ли сборка. */
function newestSourceTime() {
  let newest = 0;
  const skip = new Set(['node_modules', '.next', '.git', 'data']);

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };

  walk(ROOT);
  return newest;
}

function buildIsStale() {
  const marker = path.join(ROOT, '.next', 'BUILD_ID');
  if (!existsSync(marker)) return true;
  try {
    return statSync(marker).mtimeMs < newestSourceTime();
  } catch {
    return true;
  }
}

function openBrowser(url) {
  const commands = {
    win32: ['cmd', ['/c', 'start', '""', url]],
    darwin: ['open', [url]],
  };
  const [command, args] = commands[process.platform] ?? ['xdg-open', [url]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Не беда: адрес всё равно напечатан ниже.
  }
}

async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${URL_TO_OPEN}/api/status`, { cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      // Сервер ещё поднимается.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function main() {
  const name = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name;
  console.log(`\n  ${name} — перенос музыки между Яндекс.Музыкой и Spotify\n`);

  checkNode();

  if (await portBusy()) {
    fail(
      `Порт ${PORT} уже занят.\n` +
        '  Скорее всего приложение уже запущено — открой ' +
        URL_TO_OPEN +
        '\n  Либо закрой то окно и попробуй снова.',
    );
  }

  if (!existsSync(path.join(ROOT, 'node_modules'))) {
    log('Первый запуск: устанавливаю зависимости, это займёт пару минут…');
    if (!run(NPM, ['install', '--no-audit', '--no-fund'])) fail('Не удалось установить зависимости.');
  }

  if (buildIsStale()) {
    log('Собираю приложение…');
    if (!run(NPM, ['run', 'build'])) fail('Сборка не удалась.');
  }

  log(`Запускаю на ${URL_TO_OPEN}`);

  const server = spawn(NPM, ['run', 'serve'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, PORT: String(PORT) },
  });

  server.on('exit', (code) => process.exit(code ?? 0));

  if (await waitForServer()) {
    log('Готово, открываю браузер. Чтобы остановить — закрой это окно или нажми Ctrl+C.\n');
    openBrowser(URL_TO_OPEN);
  } else {
    log(`Сервер долго не отвечает. Попробуй открыть ${URL_TO_OPEN} вручную.\n`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
