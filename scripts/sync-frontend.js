import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const PUBLIC_DIR = path.join(ROOT, 'public');
const FILES = ['index.html', 'app.js', 'styles.css'];

function hashFile(filePath) {
  return createHash('sha256')
    .update(readFileSync(filePath))
    .digest('hex');
}

function syncFile(fileName) {
  const source = path.join(ROOT, fileName);
  const destination = path.join(PUBLIC_DIR, fileName);

  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`Required frontend file is missing: ${fileName}`);
  }

  if (
    existsSync(destination) &&
    statSync(destination).isFile() &&
    hashFile(source) === hashFile(destination)
  ) {
    console.log(`Unchanged: ${fileName}`);
    return;
  }

  const temporary = path.join(
    PUBLIC_DIR,
    `.${fileName}.${process.pid}.tmp`
  );

  try {
    copyFileSync(source, temporary);
    renameSync(temporary, destination);

    if (hashFile(source) !== hashFile(destination)) {
      throw new Error(`Verification failed: ${fileName}`);
    }

    console.log(`Synchronized: ${fileName}`);
  } finally {
    if (existsSync(temporary)) {
      rmSync(temporary, { force: true });
    }
  }
}

function main() {
  mkdirSync(PUBLIC_DIR, { recursive: true });

  for (const fileName of FILES) {
    syncFile(fileName);
  }

  console.log('SwiftQuote frontend synchronization complete.');
}

try {
  main();
} catch (error) {
  console.error('SwiftQuote frontend synchronization failed.');
  console.error(error.message);
  process.exitCode = 1;
}
