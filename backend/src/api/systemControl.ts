import express from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';

const router = express.Router();

type SystemAction = 'start' | 'stop' | 'reset';

type ActionResponse = {
  action: SystemAction;
  status: 'success' | 'failed';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
};

const isWindows = process.platform === 'win32';

// Use PowerShell scripts on Windows, shell scripts on Linux/Mac
const actionScripts: Record<SystemAction, string> = isWindows
  ? {
      start: 'start.ps1',
      stop: 'stop.ps1',
      reset: 'reset.ps1',
    }
  : {
      start: 'start.sh',
      stop: 'stop.sh',
      reset: 'reset.sh',
    };

const scriptsDir = path.resolve(__dirname, '../../../scripts');

const repoRoot = path.resolve(scriptsDir, '..');

async function runScript(action: SystemAction): Promise<ActionResponse> {
  const scriptPath = path.join(scriptsDir, actionScripts[action]);
  await fs.access(scriptPath);

  const startedAt = new Date();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  return new Promise((resolve, reject) => {
    // Use PowerShell on Windows, bash on Linux/Mac
    const child = isWindows
      ? spawn(
          'powershell',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
          {
            cwd: repoRoot,
            windowsHide: true,
          }
        )
      : spawn('bash', [scriptPath], {
          cwd: repoRoot,
        });

    child.stdout.on('data', (data) => stdoutChunks.push(data.toString()));
    child.stderr.on('data', (data) => stderrChunks.push(data.toString()));

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      const finishedAt = new Date();
      resolve({
        action,
        status: code === 0 ? 'success' : 'failed',
        exitCode: code,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      });
    });
  });
}

router.post('/system/:action', async (req, res) => {
  const { action } = req.params;

  if (!['start', 'stop', 'reset'].includes(action)) {
    res.status(400).json({
      error: 'Invalid action',
      details: 'Supported actions are start, stop, and reset.',
    });
    return;
  }

  try {
    const result = await runScript(action as SystemAction);
    res.status(result.status === 'success' ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to run system script',
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
