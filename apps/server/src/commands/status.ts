import { join } from 'node:path';
import { runDoctor } from '../ops/doctor.js';
import { recentProblems } from '../ops/problems.js';
import { macReport } from '../ops/report.js';
import { loadConfig, type Config } from '../system/config.js';
import { m, type Messages } from '../system/messages.js';
import { homeDir } from '../system/paths.js';
import { PACKAGE_ROOT, fail } from './common.js';
import { doctorDeps } from './doctor.js';

// What the menu bar app shows: the checks, the build, the releases and the recent problems, as JSON.
export async function status(args: string[]) {
  if (!args.includes('--json')) fail(m.cli.statusUsage);
  const home = homeDir();
  let config: Config | null = null;
  try {
    config = loadConfig(home);
  } catch {
    // not set up yet: the checks say so
  }
  const report = await macReport(
    { home, managed: false, startedAt: 0, buildRoot: PACKAGE_ROOT, doctor: (messages: Messages) => runDoctor({ ...doctorDeps(home), messages }), spawnOp: () => 0 },
    m,
  );
  const { managed: _managed, startedAt: _startedAt, ...rest } = report;
  console.log(
    JSON.stringify({
      ...rest,
      home,
      origin: config?.origin ?? null,
      port: config?.port ?? null,
      running: report.checks.some((c) => c.id === 'service' && c.ok),
      problems: recentProblems(join(home, 'logs/workoffdesk.log'), 20),
    }),
  );
}
