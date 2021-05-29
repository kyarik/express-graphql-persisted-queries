import os from 'os';
import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';

type Project = 'node' | 'typescript';

const TEST_TIMEOUT_MILLISECONDS = 60000;

function exec(command: string, options: Record<string, unknown> = {}): string | null {
  const result = childProcess.execSync(command, {
    encoding: 'utf-8',
    ...options,
  }) as string | null;

  return result != null ? result.trim() : null;
}

function setUpTmpDir(): string {
  const tmpDir = path.join(os.tmpdir(), 'express-graphql-persisted-queries-integration-tests');

  fs.rmSync(tmpDir, { force: true, recursive: true });
  fs.mkdirSync(tmpDir);

  const packOutput = exec(`npm --quiet pack ${process.cwd()}`, { cwd: tmpDir });

  if (packOutput == null) {
    throw new Error('Failed to run "npm pack".');
  }

  const tarballNameMatch = /express-graphql-persisted-queries-.+?\.tgz/.exec(packOutput);
  const tarballName = tarballNameMatch ? tarballNameMatch[0] : null;

  if (tarballName == null) {
    throw new Error('Failed to find tarball name in the output of "npm pack".');
  }

  fs.renameSync(
    path.join(tmpDir, tarballName),
    path.join(tmpDir, 'express-graphql-persisted-queries.tgz'),
  );

  return tmpDir;
}

function runTests(project: Project, tmpDir: string): void {
  exec(`cp -R ${path.join(__dirname, project)} ${tmpDir}`);

  const cwd = path.join(tmpDir, project);

  exec('npm --quiet install', { cwd, stdio: 'inherit' });
  exec('npm --quiet test', { cwd, stdio: 'inherit' });
}

describe('Node and TypeScript integration', () => {
  const tmpDir = setUpTmpDir();

  it(
    'runs on all supported Node versions',
    () => {
      runTests('node', tmpDir);
    },
    TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    'compiles with all supported TypeScript versions',
    () => {
      runTests('typescript', tmpDir);
    },
    TEST_TIMEOUT_MILLISECONDS,
  );
});
