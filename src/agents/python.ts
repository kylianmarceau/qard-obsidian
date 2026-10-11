import { findBinary, loginPath, runProcess, type NodeHost } from './cli-runner';

/** Runs a figure script and returns the SVG it prints. Desktop only. */
export type PythonRunner = (script: string, signal?: AbortSignal) => Promise<string>;
const TIMEOUT = 90_000;

/**
 * Qard sets the style and saves the figure, so scripts only draw. Follows the vault's figure guide:
 * a light theme on a white background, which reads in light and dark Obsidian themes, and text kept as text.
 */
export const PY_BEFORE = `import sys, warnings
warnings.filterwarnings('ignore')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
try:
    import seaborn as sns
    sns.set_theme(style='whitegrid')
except Exception:
    pass
plt.rcParams.update({'svg.fonttype': 'none', 'figure.facecolor': 'white', 'axes.spines.top': False, 'axes.spines.right': False, 'figure.figsize': (9, 5)})
`;
export const PY_AFTER = `
plt.savefig(sys.stdout.buffer, format='svg', bbox_inches='tight')
`;

/**
 * On macOS the script runs under sandbox-exec: no network, and writes only to Qard's own temporary folder
 * (matplotlib's font cache). Elsewhere it runs as a normal process with a time limit.
 */
export function pythonRunner(host: NodeHost): PythonRunner {
  return async (script, signal) => {
    const python =
      (await findBinary(host, 'python3', '')) ?? (await findBinary(host, 'python', ''));
    if (!python) {
      throw new Error(
        'Python 3 was not found. Install it with numpy and matplotlib to draw plots.',
      );
    }
    const work = host.tempFile('qard-figures'),
      path = await loginPath(host);
    const env = { ...host.env, MPLCONFIGDIR: work, PYTHONDONTWRITEBYTECODE: '1' };
    const sandbox = !host.windows && host.exists('/usr/bin/sandbox-exec');
    const profile = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath "${work}") (subpath "/private${work}") (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))`;
    const [command, args] = sandbox
      ? ['/usr/bin/sandbox-exec', ['-p', profile, python, '-']]
      : [python, ['-']];
    const out = await runProcess({ ...host, env }, command, args, PY_BEFORE + script + PY_AFTER, {
      cwd: host.home,
      path,
      signal,
      timeout: TIMEOUT,
    });
    const start = out.indexOf('<svg');
    if (start < 0) {
      throw new Error('The script did not produce a figure.');
    }
    return out.slice(start);
  };
}
