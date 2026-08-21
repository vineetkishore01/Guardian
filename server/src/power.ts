import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from './logger.js';
import { isDockerLive, executeHostPowerViaDocker } from './collectors/docker.js';
import { PowerAction, PowerCapability } from './types.js';

/*
 * Host power control.
 *
 * This is the only endpoint in Guardian that can take the machine down, so it
 * is deliberately hard to trigger by accident:
 *
 *   1. Off unless ENABLE_POWER_CONTROLS=true is set explicitly.
 *   2. The caller must echo back the exact hostname as a typed confirmation,
 *      so a stray click or a curl against a memorised URL cannot fire it.
 *   3. Every attempt -- allowed or refused -- is logged.
 *
 * Mechanism is auto-detected:
 *   - Custom command via GUARDIAN_POWER_COMMAND
 *   - In Docker: host init via Docker socket helper container
 *   - Host: systemd via systemctl or SysV shutdown
 */

const ENABLED = process.env.ENABLE_POWER_CONTROLS === 'true';

/** Custom command template. `{action}` expands to `poweroff` or `reboot`. */
const CUSTOM_COMMAND = process.env.GUARDIAN_POWER_COMMAND?.trim() || '';

/** Grace period so the HTTP response reaches the browser before we go down. */
const EXECUTE_DELAY_MS = 1500;

interface Mechanism {
  id: string;
  description: string;
  build?: (action: PowerAction) => { file: string; args: string[] };
  execute?: (action: PowerAction) => Promise<void>;
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Resolves the real host hostname if running in Docker with /host mounted, or falls back to os.hostname() */
function resolveHostHostname(): string {
  const hostEtc = process.env.HOST_ETC || '/host/etc';
  for (const hostFile of [path.join(hostEtc, 'hostname'), '/host/etc/hostname', '/etc/hostname']) {
    if (exists(hostFile)) {
      try {
        const name = fs.readFileSync(hostFile, 'utf-8').trim();
        if (name) return name;
      } catch {
        // Continue fallback
      }
    }
  }
  return os.hostname();
}

/** True when this process looks like it is inside a container. */
function inContainer(): boolean {
  if (exists('/.dockerenv')) return true;
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf-8');
    return /docker|containerd|kubepods|lxc/.test(cgroup);
  } catch {
    return false;
  }
}

function detectMechanism(): Mechanism | null {
  if (CUSTOM_COMMAND) {
    return {
      id: 'custom',
      description: 'Operator-supplied command (GUARDIAN_POWER_COMMAND)',
      build: (action) => {
        const parts = CUSTOM_COMMAND.split(/\s+/).map((part) =>
          part.replace(/\{action\}/g, action === 'shutdown' ? 'poweroff' : 'reboot')
        );
        return { file: parts[0], args: parts.slice(1) };
      },
    };
  }

  const contained = inContainer();

  // If inside container and Docker socket is live, execute via Docker host helper
  if (contained && isDockerLive()) {
    return {
      id: 'docker-daemon',
      description: 'Host init via Docker daemon socket',
      execute: async (action: PowerAction) => {
        await executeHostPowerViaDocker(action);
      },
    };
  }

  for (const bin of ['/usr/bin/systemctl', '/bin/systemctl']) {
    if (exists(bin)) {
      return {
        id: 'systemctl',
        description: `systemd via ${bin}`,
        build: (action) => ({
          file: bin,
          args: [action === 'shutdown' ? 'poweroff' : 'reboot'],
        }),
      };
    }
  }

  for (const bin of ['/sbin/shutdown', '/usr/sbin/shutdown']) {
    if (exists(bin)) {
      return {
        id: 'shutdown',
        description: `SysV shutdown via ${bin}`,
        build: (action) => ({
          file: bin,
          args: [action === 'shutdown' ? '-h' : '-r', 'now'],
        }),
      };
    }
  }

  return null;
}

let cachedMechanism: Mechanism | null | undefined;

function mechanism(): Mechanism | null {
  if (cachedMechanism === undefined) cachedMechanism = detectMechanism();
  return cachedMechanism;
}

export function getPowerCapability(): PowerCapability {
  const mech = mechanism();
  const contained = inContainer();

  let reason: string | undefined;
  if (!ENABLED) {
    reason = 'Set ENABLE_POWER_CONTROLS=true in docker-compose.yml / environment to allow shutdown and reboot.';
  } else if (!mech) {
    reason = 'No supported power mechanism found. Mount /var/run/docker.sock or set GUARDIAN_POWER_COMMAND.';
  }

  return {
    enabled: ENABLED && !!mech,
    mechanism: mech?.id ?? null,
    description: mech?.description ?? null,
    inContainer: contained,
    confirmationPhrase: resolveHostHostname(),
    reason,
  };
}

export class PowerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function executePowerAction(
  action: PowerAction,
  confirmation: string,
  requestedBy: string
): Promise<{ scheduledInMs: number; mechanism: string }> {
  const capability = getPowerCapability();

  if (!ENABLED) {
    logger.warn('power', `Refused ${action}: power controls disabled`, { requestedBy });
    throw new PowerError('Power controls are disabled on this server.', 403);
  }

  const mech = mechanism();
  if (!mech) {
    logger.warn('power', `Refused ${action}: no mechanism available`, { requestedBy });
    throw new PowerError('No supported power mechanism is available.', 501);
  }

  const hostName = capability.confirmationPhrase.toLowerCase().trim();
  const localHostName = os.hostname().toLowerCase().trim();
  const input = confirmation.toLowerCase().trim();

  if (input !== hostName && input !== localHostName) {
    logger.warn('power', `Refused ${action}: confirmation mismatch`, { requestedBy, input });
    throw new PowerError(
      `Confirmation does not match. Type the hostname "${capability.confirmationPhrase}" to proceed.`,
      400
    );
  }

  logger.warn('power', `${action} accepted, executing in ${EXECUTE_DELAY_MS}ms`, {
    requestedBy,
    mechanism: mech.id,
  });
  logger.save();

  // Fire after the response has been flushed.
  const timer = setTimeout(async () => {
    try {
      if (mech.execute) {
        await mech.execute(action);
        logger.info('power', `${action} executed via ${mech.id}`);
      } else if (mech.build) {
        const { file, args } = mech.build(action);
        execFile(file, args, { timeout: 15000 }, (err, stdout, stderr) => {
          if (err) {
            logger.error('power', `${action} command failed`, {
              message: err.message,
              stderr: String(stderr).slice(0, 500),
            });
            logger.save();
          } else {
            logger.info('power', `${action} command issued`, {
              stdout: String(stdout).slice(0, 500),
            });
          }
        });
      }
    } catch (err) {
      logger.error('power', `Execution of ${action} failed: ${(err as Error).message}`);
    }
  }, EXECUTE_DELAY_MS);
  timer.unref?.();

  return { scheduledInMs: EXECUTE_DELAY_MS, mechanism: mech.id };
}
