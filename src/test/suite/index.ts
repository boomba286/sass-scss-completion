import * as fs from 'node:fs';
import * as path from 'node:path';
import Mocha from 'mocha';

/** 호스트 안에서 mocha(TDD ui) 로 E2E 스위트를 구동한다. */
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
