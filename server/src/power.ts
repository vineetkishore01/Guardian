import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { logger } from './logger.js';
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
 * Mechanism is auto-detected. Inside a container none of the local options will
 * work unless the host's init system is reachable, so GUARDIAN_POWER_COMMAND
 * lets an operator supply their own escape hatch (an ssh call, a webhook shim,
 * nsenter, …).
 */

const ENABLED = process.env.ENABLE_POWER_CONTROLS === 'true';

/** Custom command template. `{action}` expands to `poweroff` or `reboot`. */
const CUSTOM_COMMAND = process.env.GUARDIAN_POWER_COMMAND?.trim() || '';

/** Grace period so the HTTP response reaches the browser before we go down. */
const EXECUTE_DELAY_MS = 1500;

interface Mechanism {
  id: string;
  description: string;
  build: (action: PowerAction) => { file: string; args: string[] };
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
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
        // Split on whitespace and substitute the action placeholder. Arguments
        // are passed as an array to execFile, so nothing goes through a shell.
        const parts = CUSTOM_COMMAND.split(/\s+/).map((part) =>
          part.replace(/\{action\}/g, action === 'shutdown' ? 'poweroff' : 'reboot')
        );
        return { file: parts[0], args: parts.slice(1) };
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
    reason = 'Set ENABLE_POWER_CONTROLS=true to allow shutdown and reboot.';
  } else if (!mech) {
    reason = 'No supported power mechanism found. Set GUARDIAN_POWER_COMMAND to supply one.';
  } else if (contained && mech.id !== 'custom') {
    reason =
      'Running in a container: this will act on the container, not the host. ' +
      'Set GUARDIAN_POWER_COMMAND to reach the host instead.';
  }

  return {
    enabled: ENABLED && !!mech,
    mechanism: mech?.id ?? null,
    description: mech?.description ?? null,
    inContainer: contained,
    // The exact string the caller has to type back.
    confirmationPhrase: os.hostname(),
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

  if (confirmation !== capability.confirmationPhrase) {
    logger.warn('power', `Refused ${action}: confirmation mismatch`, { requestedBy });
    throw new PowerError(
      `Confirmation does not match. Type the hostname "${capability.confirmationPhrase}" to proceed.`,
      400
    );
  }

  const { file, args } = mech.build(action);
  logger.warn('power', `${action} accepted, executing in ${EXECUTE_DELAY_MS}ms`, {
    requestedBy,
    mechanism: mech.id,
    command: [file, ...args].join(' '),
  });
  logger.save();

  // Fire after the response has been flushed.
  const timer = setTimeout(() => {
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
  }, EXECUTE_DELAY_MS);
  timer.unref?.();

  return { scheduledInMs: EXECUTE_DELAY_MS, mechanism: mech.id };
}
