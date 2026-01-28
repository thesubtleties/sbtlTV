const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'linux') {
  console.log('[native] Skip libmpv copy on non-Linux');
  process.exit(0);
}

const source = path.join(__dirname, '..', 'native', 'mpv', 'build', 'Release', 'mpv.node');
const targetDir = path.join(__dirname, '..', 'dist', 'native');
const target = path.join(targetDir, 'mpv.node');
const libTargetDir = path.join(targetDir, 'lib');
const bundleRoot = path.join(__dirname, '..', 'mpv-bundle', 'linux');
const ffmpegDir = process.env.FFMPEG_STATIC === '1' ? 'ffmpeg-static' : 'ffmpeg';
const ffmpegLib = path.join(bundleRoot, ffmpegDir, 'lib');
const mpvLib = path.join(bundleRoot, 'mpv', 'lib');
const opensslLib = path.join(bundleRoot, 'openssl', 'lib');

if (!fs.existsSync(source)) {
  console.warn('[native] mpv.node not found; run pnpm native:build first');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log('[native] Copied mpv.node to dist/native');

const cleanLibTargetDir = () => {
  if (!fs.existsSync(libTargetDir)) return;
  for (const entry of fs.readdirSync(libTargetDir)) {
    const entryPath = path.join(libTargetDir, entry);
    let stat;
    try {
      stat = fs.lstatSync(entryPath);
    } catch {
      continue;
    }
    if (stat.isFile() || stat.isSymbolicLink()) {
      fs.unlinkSync(entryPath);
    } else {
      console.warn(`[native] Skipping non-file entry in lib dir: ${entry}`);
    }
  }
};

const copyLibs = (srcDir) => {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(libTargetDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, entry);
    const dest = path.join(libTargetDir, entry);
    const stat = fs.statSync(src);
    if (!stat.isFile()) continue;
    fs.copyFileSync(src, dest);
  }
};

cleanLibTargetDir();
copyLibs(ffmpegLib);
copyLibs(mpvLib);
copyLibs(opensslLib);
if (process.env.OPENSSL_PREFIX) {
  copyLibs(path.join(process.env.OPENSSL_PREFIX, 'lib'));
}
if (fs.existsSync(libTargetDir)) {
  console.log('[native] Copied bundled libs to dist/native/lib');
}
