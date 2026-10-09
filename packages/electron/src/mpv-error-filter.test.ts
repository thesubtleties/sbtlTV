import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTransientDecodeError } from './mpv-error-filter.js';

test('decoder and hwdec probe noise is transient', () => {
  for (const message of [
    'ffmpeg/video: h264: co located POCs unavailable\n',
    'ffmpeg/video: h264: Failed to end picture decode issue: 23 (internal decoding error).\n',
    'vd: Error while decoding frame (hardware decoding)!\n',
    'libmpv_render: Mapping hardware decoded surface failed.\n',
    'libmpv_render/vaapi: vaExportSurfaceHandle() failed (operation failed)\n',
    'ffmpeg: CUDA: Could not dynamically load CUDA\n',
    'ffmpeg/video: h264: non-existing PPS 0 referenced\n',
    'ffmpeg/video: h264: no frame!\n',
    'ffmpeg/video: h264: non-existing SPS 0 referenced in buffering period\n',
    'ffmpeg/video: h264: mmco: unref short failure\n',
    'ffmpeg/video: h264: number of reference frames (0+5) exceeds max (4; probably corrupt input), discarding one\n',
    'libmpv_render/drmprime-overlay: Cannot retrieve DRM resources: Bad file descriptor\n',
  ]) {
    assert.equal(isTransientDecodeError(message), true, message);
  }
});

test('stream, network and audio failures still reach the banner', () => {
  for (const message of [
    'ffmpeg/audio: aac: channel element 1.0 is not allocated\n',
    'ad: Error decoding audio.\n',
    'ffmpeg: Server returned 404 Not Found\n',
    'stream: Failed to open http://example.invalid/live\n',
    'cplayer: Failed to recognize file format.\n',
    'demux: ... \n',
    // A decoder that cannot open must keep its banner: video would stay black.
    'vd: Could not open codec.\n',
    "vd: Failed to initialize a decoder for codec 'hevc'.\n",
    'ffmpeg/video: hevc: Unsupported profile\n',
    'libmpv_render: Failed to create the render context.\n',
  ]) {
    assert.equal(isTransientDecodeError(message), false, message);
  }
});
