import { spawnSync } from 'node:child_process';
import path from 'node:path';

let ffmpegBin = null;
let pathPatched = false;

function probeFfmpeg(bin) {
  try {
    const r = spawnSync(bin, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return false;
    return /\blibx264\b/.test(r.stdout || '');
  } catch {
    return false;
  }
}

export async function resolveFfmpeg(logger) {
  if (ffmpegBin) return ffmpegBin;

  const candidates = [];
  try {
    const mod = await import('ffmpeg-static');
    const p = mod?.default ?? mod;
    if (typeof p === 'string' && p) candidates.push(p);
    else if (typeof p?.path === 'string' && p.path) candidates.push(p.path);
  } catch {}

  candidates.push('ffmpeg');

  for (const bin of candidates) {
    if (probeFfmpeg(bin)) {
      ffmpegBin = bin;
      logger?.debug(`ffmpeg: ${bin}`);
      return bin;
    }
  }

  return null;
}

function prependPathEnv(dir) {
  if (pathPatched || !dir) return;
  const key = process.platform === 'win32' ? 'Path' : 'PATH';
  const current = process.env[key] || '';
  if (current.split(path.delimiter).includes(dir)) {
    pathPatched = true;
    return;
  }
  process.env[key] = `${dir}${path.delimiter}${current}`;
  pathPatched = true;
}

// Lib spawn('ffmpeg') trực tiếp (prism-media, Recorder) — ffmpeg-static
// phải nằm trên PATH của process, nếu không spawn sẽ ENOENT.
export async function ensureFfmpegOnPath(logger) {
  const bin = await resolveFfmpeg(logger);
  if (bin && path.isAbsolute(bin)) {
    prependPathEnv(path.dirname(bin));
  }
  return bin;
}
