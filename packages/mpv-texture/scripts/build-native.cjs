const { execFileSync } = require('node:child_process');
const { copyFileSync } = require('node:fs');
const { join } = require('node:path');

if (!['darwin', 'linux'].includes(process.platform)) {
  console.log('[mpv-texture] Skipping native build on this platform');
  process.exit(0);
}

execFileSync('node-gyp', ['rebuild'], { stdio: 'inherit' });
if (process.platform === 'linux') {
  const addon = join(__dirname, '../build/Release/mpv_texture.node');
  const addonDependencies = execFileSync('patchelf', ['--print-needed', addon], { encoding: 'utf8' });
  if (/mpv_runtime|libmpv|libavcodec|libavformat/.test(addonDependencies)) {
    throw new Error('The addon must dlopen the mpv runtime privately, not link to it');
  }
  const runtime = join(__dirname, '../build/Release/mpv_runtime.so');
  const dependencies = execFileSync('patchelf', ['--print-needed', runtime], { encoding: 'utf8' }).trim().split('\n');
  const mpvSoname = dependencies.find(name => /^libmpv\.so\.[12]$/.test(name));
  if (!mpvSoname) throw new Error('mpv_runtime.so must link to libmpv.so.1 or libmpv.so.2');

  // The shim only forwards allocators and looks up mpv dynamically. Its code
  // is identical for both ABIs; only the loader dependency differs.
  for (const abi of [2, 1]) {
    const destination = join(__dirname, `../build/Release/mpv_runtime_${abi}.so`);
    copyFileSync(runtime, destination);
    execFileSync('patchelf', ['--replace-needed', mpvSoname, `libmpv.so.${abi}`, destination]);
  }
}
