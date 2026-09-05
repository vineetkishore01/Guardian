import { FullDashboardState, Problem, Severity } from './types.js';

/*
 * One authoritative list of everything currently wrong.
 *
 * This exists because the dashboard's alerts were scattered across roughly ten
 * independent, self-hiding surfaces: a red border here, an amber figure there, a
 * count line in one card. Nothing said "CPU is pegged and /mnt/nas is nearly
 * full" in one place, so noticing a problem required scrolling to the right
 * section and reading its colour.
 *
 * Deriving it on the server rather than in the client is what lets the same list
 * drive both the on-screen strip and the outbound webhook. Two implementations
 * of "what counts as a problem" would drift within a month, and the version that
 * pages you at 3am is the one that must not be wrong.
 *
 * Every problem carries a stable `id`, because the alerter diffs these between
 * samples to decide what is new and what has recovered. An id that changes as
 * its value changes -- `cpu-91` then `cpu-93` -- would fire a fresh alert on
 * every sample, so ids are keyed on the *subject*, never the reading.
 */

function pct(value: number): string {
  return `${value.toFixed(0)}%`;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** `>= critAt` is crit, `>= warnAt` is warn, otherwise not a problem. */
function level(value: number, warnAt: number, critAt: number): Severity | null {
  if (value >= critAt) return 'crit';
  if (value >= warnAt) return 'warn';
  return null;
}

export function deriveProblems(state: FullDashboardState): Problem[] {
  const problems: Problem[] = [];
  const push = (
    id: string,
    severity: Severity,
    scope: Problem['scope'],
    label: string,
    detail: string
  ) => {
    problems.push({ id, severity, scope, label, detail });
  };

  const host = state.host;

  /* ------------------------------- host ------------------------------- */

  if (host) {
    const cpu = level(host.cpu.usagePercent, 75, 90);
    if (cpu) {
      push('host:cpu', cpu, 'host', `CPU ${pct(host.cpu.usagePercent)}`, `Host CPU at ${pct(host.cpu.usagePercent)}.`);
    }

    const mem = level(host.memory.usedPercent, 80, 92);
    if (mem) {
      push(
        'host:memory',
        mem,
        'host',
        `Memory ${pct(host.memory.usedPercent)}`,
        `${formatBytes(host.memory.availableBytes)} available of ${formatBytes(host.memory.totalBytes)}.`
      );
    }

    if (host.memory.swapTotalBytes > 0) {
      const swap = level(host.memory.swapPercent, 40, 70);
      if (swap) {
        push(
          'host:swap',
          swap,
          'host',
          `Swap ${pct(host.memory.swapPercent)}`,
          `${formatBytes(host.memory.swapUsedBytes)} of ${formatBytes(host.memory.swapTotalBytes)} swap in use.`
        );
      }
    }

    /*
     * Thrashing is a different failure from merely having swapped. Paging in
     * and out at the same time, continuously, is the host spending its disk
     * bandwidth shuffling memory instead of doing work.
     */
    const swapIn = host.memory.swapInBytesPerSec ?? 0;
    const swapOut = host.memory.swapOutBytesPerSec ?? 0;
    if (swapIn > 1024 * 1024 && swapOut > 1024 * 1024) {
      push(
        'host:swap-thrash',
        'crit',
        'host',
        'Swap thrashing',
        `Paging in ${formatBytes(swapIn)}/s and out ${formatBytes(swapOut)}/s simultaneously.`
      );
    }

    const thermal =
      host.thermals.find((t) => /pkg|package|cpu|tctl|core/i.test(t.label)) ?? host.thermals[0];
    if (thermal) {
      const temp = level(thermal.tempC, 75, 85);
      if (temp) {
        push('host:temp', temp, 'host', `${thermal.tempC.toFixed(0)}°C`, `${thermal.label} at ${thermal.tempC.toFixed(1)}°C.`);
      }
    }

    if (host.throttle?.throttlingNow) {
      push(
        'host:throttle',
        'warn',
        'host',
        'CPU throttling',
        'The CPU dropped clocks between samples — it is thermally or power limited.'
      );
    }

    if (host.battery?.present && !host.battery.onMains) {
      push(
        'host:battery',
        'crit',
        'host',
        'On battery',
        `Running on battery${host.battery.chargePercent !== undefined ? ` at ${host.battery.chargePercent}%` : ''}.`
      );
    }

    /*
     * Pressure is reported only when it is severe. Mild io pressure is normal
     * on a box that is actually doing something, and alerting on it would
     * make the whole strip noise.
     */
    const io = host.pressure?.io?.some60 ?? 0;
    if (io >= 25) {
      push(
        'host:pressure-io',
        io >= 50 ? 'crit' : 'warn',
        'host',
        `I/O stalled ${pct(io)}`,
        `Tasks were blocked on storage ${pct(io)} of the last minute.`
      );
    }

    const memPressure = host.pressure?.memory?.some60 ?? 0;
    if (memPressure >= 10) {
      push(
        'host:pressure-memory',
        memPressure >= 30 ? 'crit' : 'warn',
        'host',
        `Memory stalled ${pct(memPressure)}`,
        `Tasks were blocked reclaiming memory ${pct(memPressure)} of the last minute.`
      );
    }
  }

  /* ------------------------------- disks ------------------------------- */

  for (const disk of host?.disks ?? []) {
    if (/^\/(boot|efi)(\/|$)/i.test(disk.mountPoint)) continue;

    const usage = level(disk.usedPercent, 80, 90);
    if (usage) {
      push(
        `disk:${disk.mountPoint}`,
        usage,
        'disk',
        `${disk.mountPoint} ${pct(disk.usedPercent)}`,
        `${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}.`
      );
    }
  }

  /*
   * A volume filling fast is worth saying even while it still looks fine --
   * that is the entire point of having a projection. Kept separate from the
   * usage problem so a disk that is both nearly full and filling fast reports
   * both facts rather than one overwriting the other.
   */
  for (const trend of state.diskTrends ?? []) {
    if (trend.daysUntilFull === undefined) continue;
    if (trend.daysUntilFull > 14) continue;

    push(
      `disk-trend:${trend.mountPoint}`,
      trend.daysUntilFull <= 7 ? 'crit' : 'warn',
      'disk',
      `${trend.mountPoint} full in ~${Math.round(trend.daysUntilFull)}d`,
      `Filling at ${formatBytes(trend.bytesPerDay)}/day; projected full in about ${Math.round(trend.daysUntilFull)} days.`
    );
  }

  /* ----------------------------- containers ----------------------------- */

  for (const c of state.containers ?? []) {
    if (c.hidden) continue;
    const name = c.displayName || c.name;

    if (c.oomKilled) {
      push(`container:${c.name}:oom`, 'crit', 'container', `${name} OOM killed`, 'The kernel killed it for exceeding its memory limit.');
    }
    if (c.health === 'unhealthy') {
      const last = c.healthLog?.[c.healthLog.length - 1];
      push(
        `container:${c.name}:unhealthy`,
        'crit',
        'container',
        `${name} unhealthy`,
        last?.output ? `Healthcheck failing: ${last.output.slice(0, 160)}` : 'Healthcheck is failing.'
      );
    }
    if (c.state === 'restarting') {
      push(`container:${c.name}:restarting`, 'crit', 'container', `${name} restarting`, 'Container is restarting now.');
    }
    if (c.state === 'dead') {
      push(`container:${c.name}:dead`, 'crit', 'container', `${name} dead`, 'Container is in a dead state.');
    }
    if (c.state === 'exited' && (c.exitCode ?? 0) !== 0) {
      push(
        `container:${c.name}:exited`,
        'warn',
        'container',
        `${name} exited ${c.exitCode}`,
        c.stateError || `Exited with code ${c.exitCode}.`
      );
    }
    if (c.cpuThrottlingNow) {
      push(
        `container:${c.name}:throttled`,
        'warn',
        'container',
        `${name} CPU throttled`,
        c.cpuLimitCores
          ? `Held at its ${c.cpuLimitCores} CPU cap.`
          : 'Being throttled against its CPU quota.'
      );
    }
    if (
      c.memoryLimitIsExplicit &&
      c.memoryLimitBytes &&
      c.memoryBytes &&
      c.memoryBytes / c.memoryLimitBytes >= 0.9
    ) {
      const share = (c.memoryBytes / c.memoryLimitBytes) * 100;
      push(
        `container:${c.name}:mem`,
        'warn',
        'container',
        `${name} ${pct(share)} of memory cap`,
        `Using ${formatBytes(c.memoryBytes)} of its ${formatBytes(c.memoryLimitBytes)} limit.`
      );
    }
  }

  /* --------------------------- service health --------------------------- */

  /*
   * These applications triage their own problems, so an entry here has already
   * been judged worth reporting by something that understands the domain far
   * better than a generic dashboard does. Passing them through unedited is more
   * useful than trying to re-rank them.
   */
  for (const svc of state.serviceHealth ?? []) {
    if (svc.unreachable) {
      push(
        `service:${svc.name}:unreachable`,
        'warn',
        'container',
        `${svc.name} API unreachable`,
        `Could not query the ${svc.service} API: ${svc.unreachable}`
      );
      continue;
    }

    for (const issue of svc.issues) {
      push(
        `service:${svc.name}:${issue.source}`,
        issue.type === 'error' ? 'crit' : 'warn',
        'container',
        `${svc.name}: ${issue.source}`,
        issue.message
      );
    }

    /*
     * Deliberately a high bar. Some failures are routine -- an indexer times
     * out, a release turns out to be fake -- and alerting on a handful a day
     * would bury the health entries above, which are the ones that mean
     * something is actually misconfigured.
     */
    if ((svc.recentFailures ?? 0) >= 10) {
      push(
        `service:${svc.name}:failures`,
        'warn',
        'container',
        `${svc.name}: ${svc.recentFailures} failures`,
        `${svc.recentFailures} failed operations in the last ${svc.failureWindowHours}h.`
      );
    }
  }

  /* ------------------------------- probes ------------------------------- */

  for (const probe of state.probes ?? []) {
    if (probe.status !== 'down') continue;
    push(
      `probe:${probe.port}`,
      'warn',
      'probe',
      `${probe.name} unreachable`,
      `No usable response on port ${probe.port}${probe.notes ? ` (${probe.notes})` : ''}.`
    );
  }

  // Worst first, so the strip and the webhook lead with what matters.
  const rank: Record<Severity, number> = { crit: 0, warn: 1, ok: 2 };
  return problems.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
