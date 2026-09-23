import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

function defaultDestination(sourcePath) {
  const timestamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  return resolve(dirname(sourcePath), 'backups', `buleto-${timestamp}.sqlite`);
}

const sourcePath = resolve(process.argv[2] || process.env.DATABASE_PATH || './data/buleto.sqlite');
const destinationPath = resolve(process.argv[3] || defaultDestination(sourcePath));

if (!existsSync(sourcePath)) {
  throw new Error(`Исходная база не найдена: ${sourcePath}`);
}
if (existsSync(destinationPath)) {
  throw new Error(`Файл резервной копии уже существует: ${destinationPath}`);
}

mkdirSync(dirname(destinationPath), { recursive: true });

const source = new DatabaseSync(sourcePath);
try {
  source.exec(`VACUUM INTO '${sqlString(destinationPath)}'`);
} finally {
  source.close();
}

const backup = new DatabaseSync(destinationPath, { readOnly: true });
let integrity;
try {
  integrity = Object.values(backup.prepare('PRAGMA integrity_check').get())[0];
} finally {
  backup.close();
}

if (integrity !== 'ok') {
  throw new Error(`Проверка резервной копии завершилась с результатом: ${integrity}`);
}

console.info(JSON.stringify({
  source: sourcePath,
  backup: destinationPath,
  integrity,
}));
