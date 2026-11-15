import * as fs from 'node:fs';
import * as path from 'node:path';
import Mocha from 'mocha';

/** Run the E2E suite with mocha (TDD ui) inside the host. */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
  const testsRoot = __dirname;

  const files = (fs.readdirSync(testsRoot, { recursive: true }) as string[])
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.e2e.js'));

  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} test(s) failed.`));
      else resolve();
    });
  });
}
