import { useState, useEffect, useCallback, useRef } from 'react';
import type { MpvStatus, MpvFrameInfo } from './types/electron';
import { Settings } from './components/Settings';
import { Sidebar, type View } from './components/Sidebar';
import { NowPlayingBar } from './components/NowPlayingBar';
import { CategoryStrip } from './components/CategoryStrip';
import { ChannelPanel } from './components/ChannelPanel';
import { MoviesPage } from './components/MoviesPage';
import { SeriesPage } from './components/SeriesPage';
import { Logo } from './components/Logo';
import { useSelectedCategory } from './hooks/useChannels';
import { useChannelSyncing, useVodSyncing, useTmdbMatching } from './stores/uiStore';
import { syncAllSources, syncAllVod, syncVodForSource, isVodStale } from './db/sync';
import type { StoredChannel } from './db';
import type { VodPlayInfo } from './types/media';

/**
 * Generate fallback stream URLs when primary fails.
 * Live TV: .ts → .m3u8 → .m3u
 * VOD: provider extension → .m3u8 → .ts
 */
function getStreamFallbacks(url: string, isLive: boolean): string[] {
  try {
    // Parse URL properly to preserve query params (often used for auth tokens)
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    const extMatch = pathname.match(/\.([a-z0-9]+)$/i);
    if (!extMatch) return []; // No extension, can't generate fallbacks

    const currentExt = extMatch[1].toLowerCase();
    const basePathname = pathname.slice(0, -currentExt.length - 1);

    const generateUrl = (ext: string): string => {
      const newUrl = new URL(url);
      newUrl.pathname = `${basePathname}.${ext}`;
      return newUrl.toString();
    };

    if (isLive) {
      // Live TV fallback order: .ts → .m3u8 → .m3u
      const fallbacks: string[] = [];
      if (currentExt !== 'm3u8') fallbacks.push(generateUrl('m3u8'));
      if (currentExt !== 'm3u') fallbacks.push(generateUrl('m3u'));
      return fallbacks;
    } else {
      // VOD fallback order: provider ext → .m3u8 → .ts
      const fallbacks: string[] = [];
      if (currentExt !== 'm3u8') fallbacks.push(generateUrl('m3u8'));
      if (currentExt !== 'ts') fallbacks.push(generateUrl('ts'));
      return fallbacks;
    }
  } catch {
    // Invalid URL, can't generate fallbacks
    return [];
  }
}

/**
 * Try loading a stream URL with fallbacks on failure.
 * Returns the successful URL or null if all failed.
 */
async function tryLoadWithFallbacks(
  primaryUrl: string,
  isLive: boolean,
  mpv: NonNullable<typeof window.mpv>
): Promise<{ success: boolean; url: string; error?: string }> {
  // Try primary URL first
  const result = await mpv.load(primaryUrl);
  if (!result.error) {
    return { success: true, url: primaryUrl };
  }

  // Try fallbacks
  const fallbacks = getStreamFallbacks(primaryUrl, isLive);
  for (const fallbackUrl of fallbacks) {
    const fallbackResult = await mpv.load(fallbackUrl);
    if (!fallbackResult.error) {
      return { success: true, url: fallbackUrl };
    }
  }

  // All failed - return original error
  return { success: false, url: primaryUrl, error: result.error };
}

function App() {
  // player state
  const [mpvReady, setMpvReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [currentChannel, setCurrentChannel] = useState<StoredChannel | null>(null);
  const [vodInfo, setVodInfo] = useState<VodPlayInfo | null>(null);

  // UI state
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const [activeView, setActiveView] = useState<View>('none');
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Channel/category state (persisted)
  const { categoryId, setCategoryId, loading: categoryLoading } = useSelectedCategory();

  // Global sync state (from Settings)
  const channelSyncing = useChannelSyncing();
  const vodSyncing = useVodSyncing();
  const tmdbMatching = useTmdbMatching();

  // Sync state
  const [syncing, setSyncing] = useState(false);

  // Track volume slider dragging to ignore player updates during drag
  const volumeDraggingRef = useRef(false);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const POSITION_UPDATE_THRESHOLD = 0.25;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestFrameRef = useRef<{ info: MpvFrameInfo; data: Uint8Array } | null>(null);
  const lastRenderedFrameIdRef = useRef(0);
  const imageDataRef = useRef<ImageData | null>(null);
  const canvasSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const glProgramRef = useRef<WebGLProgram | null>(null);
  const glTextureRef = useRef<WebGLTexture | null>(null);
  const glPositionBufferRef = useRef<WebGLBuffer | null>(null);
  const glTexCoordBufferRef = useRef<WebGLBuffer | null>(null);
  const glPackedBufferRef = useRef<Uint8Array | null>(null);
  const glScaleLocationRef = useRef<WebGLUniformLocation | null>(null);
  const glCanvasSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // Track seeking to prevent position flickering during scrub
  const seekingRef = useRef(false);

  // Track if mouse is hovering over controls (prevents auto-hide)
  const controlsHoveredRef = useRef(false);

  const viewportDebugLastRef = useRef<string | null>(null);

  // Set up player event listeners
  useEffect(() => {
    if (!window.mpv) {
      setError('Playback API not available - run the Electron app (pnpm dev), not the Vite browser.');
      return;
    }

    window.mpv.onReady((ready) => {
      console.log('player ready:', ready);
      setMpvReady(ready);
    });

    window.mpv.onStatus((status: MpvStatus) => {
      if (status.playing !== undefined) setPlaying(status.playing);
      // Skip volume updates while user is dragging the slider
      if (status.volume !== undefined && !volumeDraggingRef.current) {
        setVolume(status.volume);
      }
      if (status.muted !== undefined) setMuted(status.muted);
      // Skip position updates while user is seeking (prevents flickering)
      if (status.position !== undefined && !seekingRef.current) {
        if (Math.abs(status.position - positionRef.current) >= POSITION_UPDATE_THRESHOLD) {
          positionRef.current = status.position;
          setPosition(status.position);
        }
      }
      if (status.duration !== undefined) {
        if (Math.abs(status.duration - durationRef.current) >= POSITION_UPDATE_THRESHOLD) {
          durationRef.current = status.duration;
          setDuration(status.duration);
        }
      }
    });

    window.mpv.onWarning?.((warn: string) => {
      console.warn('player warning:', warn);
      setWarning(warn);
    });

    window.mpv.onError((err) => {
      console.error('player error:', err);
      setError(err);
    });

    window.mpv.onVideoInfo?.((info: MpvFrameInfo) => {
      if (!canvasRef.current) return;
      const { width, height } = info;
      if (width <= 0 || height <= 0) return;
      if (!glRef.current) {
        if (canvasSizeRef.current.width !== width || canvasSizeRef.current.height !== height) {
          canvasSizeRef.current = { width, height };
          canvasRef.current.width = width;
          canvasRef.current.height = height;
          imageDataRef.current = null;
        }
      }
    });

    window.mpv.onFrame?.((frame) => {
      latestFrameRef.current = { info: frame.info, data: new Uint8Array(frame.data) };
    });

    return () => {
      window.mpv?.removeAllListeners();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!gl) return;

    const vertexSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      uniform vec2 u_scale;
      void main() {
        v_texCoord = a_texCoord;
        gl_Position = vec4(a_position * u_scale, 0.0, 1.0);
      }
    `;

    const fragmentSource = `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D u_texture;
      void main() {
        gl_FragColor = texture2D(u_texture, v_texCoord);
      }
    `;

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile failed', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link failed', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return;
    }

    gl.useProgram(program);
    glProgramRef.current = program;

    glScaleLocationRef.current = gl.getUniformLocation(program, 'u_scale');

    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();
    if (!positionBuffer || !texCoordBuffer) return;
    glPositionBufferRef.current = positionBuffer;
    glTexCoordBufferRef.current = texCoordBuffer;

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ]), gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    if (!texture) return;
    glTextureRef.current = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

    glRef.current = gl;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      glCanvasSizeRef.current = { width, height };
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('resize', resize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    let rafId: number | null = null;

    const renderFrame = () => {
      rafId = requestAnimationFrame(renderFrame);
      const canvas = canvasRef.current;
      const frame = latestFrameRef.current;
      if (!canvas || !frame) return;
      if (frame.info.frameId === lastRenderedFrameIdRef.current) return;

      const { width, height, stride } = frame.info;
      if (width <= 0 || height <= 0) return;

      const gl = glRef.current;
      if (gl && glProgramRef.current && glTextureRef.current) {
        const rowBytes = width * 4;
        let pixelData = frame.data;
        if (stride !== rowBytes) {
          const packedSize = rowBytes * height;
          if (!glPackedBufferRef.current || glPackedBufferRef.current.length !== packedSize) {
            glPackedBufferRef.current = new Uint8Array(packedSize);
          }
          const packed = glPackedBufferRef.current;
          for (let y = 0; y < height; y += 1) {
            const srcStart = y * stride;
            const dstStart = y * rowBytes;
            packed.set(frame.data.subarray(srcStart, srcStart + rowBytes), dstStart);
          }
          pixelData = packed;
        }

        const canvasSize = glCanvasSizeRef.current;
        const canvasAspect = canvasSize.width > 0 && canvasSize.height > 0
          ? canvasSize.width / canvasSize.height
          : 1;
        const videoAspect = width / height;
        let scaleX = 1;
        let scaleY = 1;
        if (videoAspect > canvasAspect) {
          scaleY = canvasAspect / videoAspect;
        } else {
          scaleX = videoAspect / canvasAspect;
        }
        if (glScaleLocationRef.current) {
          gl.uniform2f(glScaleLocationRef.current, scaleX, scaleY);
        }

        gl.bindTexture(gl.TEXTURE_2D, glTextureRef.current);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        lastRenderedFrameIdRef.current = frame.info.frameId;
        return;
      }

      if (canvasSizeRef.current.width !== width || canvasSizeRef.current.height !== height) {
        canvasSizeRef.current = { width, height };
        canvas.width = width;
        canvas.height = height;
        imageDataRef.current = null;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let imageData = imageDataRef.current;
      if (!imageData || imageData.width !== width || imageData.height !== height) {
        imageData = ctx.createImageData(width, height);
        imageDataRef.current = imageData;
      }

      const dst = imageData.data;
      const src = frame.data;
      const rowBytes = width * 4;
      if (stride === rowBytes) {
        dst.set(src.subarray(0, rowBytes * height));
      } else {
        for (let y = 0; y < height; y += 1) {
          const srcStart = y * stride;
          const dstStart = y * rowBytes;
          dst.set(src.subarray(srcStart, srcStart + rowBytes), dstStart);
        }
      }

      ctx.putImageData(imageData, 0, 0);
      lastRenderedFrameIdRef.current = frame.info.frameId;
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  const armHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      if (!controlsHoveredRef.current && playing && activeView === 'none' && !categoriesOpen) {
        setShowControls(false);
      }
    }, 3000);
  }, [playing, activeView, categoriesOpen]);

  useEffect(() => {
    if (!playing || activeView !== 'none' || categoriesOpen) {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      return;
    }
    armHideTimer();
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [playing, activeView, categoriesOpen, armHideTimer]);

  useEffect(() => () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const handlePointerMove = useCallback(() => {
    setShowControls((prev) => (prev ? prev : true));
    armHideTimer();
  }, [armHideTimer]);

  // Control handlers
  const handleLoadStream = async (channel: StoredChannel) => {
    if (!window.mpv) return;
    if (!mpvReady) {
      setError('Player not ready yet');
      return;
    }
    setError(null);
    setWarning(null);
    console.info('[player] load live', channel.direct_url);
    const result = await tryLoadWithFallbacks(channel.direct_url, true, window.mpv);
    console.info('[player] load result', result);
    if (!result.success) {
      setError(result.error ?? 'Failed to load stream');
    } else {
      // Update channel with working URL if fallback was used
      setCurrentChannel(result.url !== channel.direct_url
        ? { ...channel, direct_url: result.url }
        : channel
      );
      setPlaying(true);
    }
  };

  const handleTogglePlay = async () => {
    if (!window.mpv) return;
    await window.mpv.togglePause();
  };

  const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
    if (window.mpv) {
      await window.mpv.setVolume(newVolume);
    }
  };

  const handleToggleMute = async () => {
    if (!window.mpv) return;
    await window.mpv.toggleMute();
    // UI state updated via mpv status callback
  };

  const handleStop = async () => {
    if (!window.mpv) return;
    await window.mpv.stop();
    setPlaying(false);
    setCurrentChannel(null);
    setWarning(null);
  };

  const handleSeek = async (seconds: number) => {
    if (!window.mpv) return;
    seekingRef.current = true;
    setPosition(seconds); // Optimistic update
    await window.mpv.seek(seconds);
    // Brief delay before accepting mpv updates again
    setTimeout(() => { seekingRef.current = false; }, 200);
  };

  // Play a channel
  const handlePlayChannel = (channel: StoredChannel) => {
    handleLoadStream(channel);
  };

  // Play VOD content (movies/series)
  const handlePlayVod = async (info: VodPlayInfo) => {
    if (!window.mpv) return;
    if (!mpvReady) {
      setError('Player not ready yet');
      return;
    }
    setError(null);
    setWarning(null);
    console.info('[player] load vod', info.url);
    const result = await tryLoadWithFallbacks(info.url, false, window.mpv);
    console.info('[player] load result', result);
    if (!result.success) {
      setError(result.error ?? 'Failed to load stream');
    } else {
      // Create a pseudo-channel for the now playing bar
      const workingUrl = result.url;
      setCurrentChannel({
        stream_id: 'vod',
        name: info.title,
        stream_icon: '',
        epg_channel_id: '',
        category_ids: [],
        direct_url: workingUrl,
        source_id: 'vod',
      });
      setVodInfo({ ...info, url: workingUrl });
      setPlaying(true);
      // Close VOD pages when playing
      setActiveView('none');
    }
  };

  // Handle category selection - opens guide if closed
  const handleSelectCategory = (catId: string | null) => {
    setCategoryId(catId);
    // Open guide if it's not already open
    if (activeView !== 'guide') {
      setActiveView('guide');
    }
  };

  // Sync sources on app load (if sources exist)
  useEffect(() => {
    const doInitialSync = async () => {
      if (!window.storage) return;
      const result = await window.storage.getSources();
      if (result.data && result.data.length > 0) {
        setSyncing(true);
        await syncAllSources();

        // Get user's configured refresh settings
        const settingsResult = await window.storage.getSettings();
        const vodRefreshHours = settingsResult.data?.vodRefreshHours ?? 24;

        // Sync VOD only for Xtream sources that are stale
        const xtreamSources = result.data.filter(s => s.type === 'xtream' && s.enabled);
        for (const source of xtreamSources) {
          const stale = await isVodStale(source.id, vodRefreshHours);
          if (stale) {
            console.log(`[VOD] Source ${source.name} is stale, syncing...`);
            await syncVodForSource(source);
          } else {
            console.log(`[VOD] Source ${source.name} is fresh, skipping sync`);
          }
        }
        setSyncing(false);
      }
    };
    doInitialSync();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          handleTogglePlay();
          break;
        case 'm':
          handleToggleMute();
          break;
        case 'g':
          // Toggle guide
          setActiveView((v) => (v === 'guide' ? 'none' : 'guide'));
          break;
        case 'c':
          // Toggle categories
          setCategoriesOpen((open) => !open);
          break;
        case 'Escape':
          setActiveView('none');
          setCategoriesOpen(false);
          setShowControls(false);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Window control handlers
  const handleMinimize = () => window.electronWindow?.minimize();
  const handleMaximize = () => window.electronWindow?.maximize();
  const handleClose = () => {
    if (window.electronWindow?.close) {
      window.electronWindow.close();
      return;
    }
    window.close();
  };

  const isTransparent = window.platform?.isWindows;

  useEffect(() => {
    if (!window.platform?.isLinux || !window.mpv?.setViewport) return;

    let rafId: number | null = null;
    const viewportDebugEnabled = window.localStorage?.getItem('sbtltv:viewportDebug') === '1';

    const updateViewport = () => {
      const lockViewport = window.localStorage?.getItem('sbtltv:lockViewport') === '1';
      if (!lockViewport && activeView !== 'none') {
        window.mpv?.setViewport({ x: 0, y: 0, width: 0, height: 0, hidden: true });
        if (viewportDebugEnabled) {
          const payload = {
            hidden: true,
            activeView,
            categoriesOpen,
            showControls,
            sidebarExpanded,
            error: !!error,
            warning: !!warning,
          };
          const serialized = JSON.stringify(payload);
          if (viewportDebugLastRef.current !== serialized) {
            viewportDebugLastRef.current = serialized;
            console.info('[viewport]', payload);
          }
        }
        return;
      }

      let topInset = 0;
      let leftInset = 0;
      let bottomInset = 0;

      if (!lockViewport) {
        const titleBar = document.querySelector('.title-bar') as HTMLElement | null;
        const errorBanner = document.querySelector('.error-banner') as HTMLElement | null;
        const sidebarNav = document.querySelector('.sidebar .sidebar-nav') as HTMLElement | null;
        const categoryStrip = document.querySelector('.category-strip.visible') as HTMLElement | null;
        const nowPlayingBar = document.querySelector('.now-playing-bar') as HTMLElement | null;

        topInset = (titleBar?.offsetHeight ?? 0) + (errorBanner ? errorBanner.offsetHeight : 0);
        if (categoriesOpen && categoryStrip) {
          leftInset = categoryStrip.offsetWidth;
        } else if (sidebarNav) {
          leftInset = sidebarNav.offsetWidth;
        }
        bottomInset = nowPlayingBar ? nowPlayingBar.offsetHeight : 0;
      }

      const width = Math.max(1, Math.round(window.innerWidth - leftInset));
      const height = Math.max(1, Math.round(window.innerHeight - topInset - bottomInset));
      const x = Math.round(leftInset);
      const y = Math.round(topInset);

      window.mpv?.setViewport({ x, y, width, height });
      if (viewportDebugEnabled) {
        const payload = {
          x,
          y,
          width,
          height,
          topInset,
          leftInset,
          bottomInset,
          lockViewport,
          activeView,
          categoriesOpen,
          showControls,
          sidebarExpanded,
          error: !!error,
          warning: !!warning,
        };
        const serialized = JSON.stringify(payload);
        if (viewportDebugLastRef.current !== serialized) {
          viewportDebugLastRef.current = serialized;
          console.info('[viewport]', payload);
        }
      }
    };

    const schedule = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateViewport();
      });
    };

    schedule();
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('resize', schedule);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [activeView, categoriesOpen, sidebarExpanded, error, warning]);
  const playerReady = mpvReady;

  return (
    <div className={`app${isTransparent ? ' app--transparent' : ''}`} onPointerMove={handlePointerMove}>
      {/* Custom title bar for frameless window */}
      <div className="title-bar">
        <Logo className="title-bar-logo" />
        <div className="window-controls">
          <button onClick={handleMinimize} title="Minimize">
            ─
          </button>
          <button onClick={handleMaximize} title="Maximize">
            □
          </button>
          <button onClick={handleClose} className="close" title="Close">
            ✕
          </button>
        </div>
      </div>

      {/* Background - transparent over video */}
      <div className="video-background">
        <canvas ref={canvasRef} />
        {!currentChannel && (
          <div className="placeholder">
            <Logo className="placeholder__logo" />
            {(channelSyncing || vodSyncing || tmdbMatching) ? (
              <div className="sync-status">
                <div className="sync-status__spinner" />
                <span className="sync-status__text">
                  {channelSyncing && vodSyncing
                    ? 'Syncing channels & VOD...'
                    : channelSyncing
                    ? 'Syncing channels...'
                    : vodSyncing
                    ? 'Syncing VOD...'
                    : 'Matching with TMDB...'}
                </span>
              </div>
            ) : (
              <div className="placeholder__spacer" />
            )}
          </div>
        )}
      </div>

      {/* Error display */}
      {(error || warning) && (
        <div className={`error-banner${warning && !error ? ' error-banner--warning' : ''}`}>
          <span>{error ? 'Error' : 'Warning'}: {error ?? warning}</span>
          <button onClick={() => (error ? setError(null) : setWarning(null))}>Dismiss</button>
        </div>
      )}

      {/* Now Playing Bar */}
      <NowPlayingBar
        visible={showControls}
        channel={currentChannel}
        playing={playing}
        muted={muted}
        volume={volume}
        mpvReady={playerReady}
        position={position}
        duration={duration}
        isVod={currentChannel?.stream_id === 'vod'}
        vodInfo={vodInfo}
        onTogglePlay={handleTogglePlay}
        onStop={handleStop}
        onToggleMute={handleToggleMute}
        onVolumeChange={handleVolumeChange}
        onSeek={handleSeek}
        onVolumeDragStart={() => { volumeDraggingRef.current = true; }}
        onVolumeDragEnd={() => { volumeDraggingRef.current = false; }}
        onMouseEnter={() => { controlsHoveredRef.current = true; }}
        onMouseLeave={() => { controlsHoveredRef.current = false; }}
      />

      {/* Sidebar Navigation - stays visible when any panel is open */}
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        visible={showControls || categoriesOpen || activeView !== 'none'}
        categoriesOpen={categoriesOpen}
        onCategoriesToggle={() => setCategoriesOpen((open) => !open)}
        onCategoriesClose={() => setCategoriesOpen(false)}
        expanded={sidebarExpanded}
        onExpandedToggle={() => setSidebarExpanded((exp) => !exp)}
      />

      {/* Category Strip - slides out from sidebar */}
      <CategoryStrip
        selectedCategoryId={categoryId}
        onSelectCategory={handleSelectCategory}
        visible={categoriesOpen}
        sidebarExpanded={sidebarExpanded}
      />

      {/* Channel Panel - slides out (shifts right if categories open) */}
      <ChannelPanel
        categoryId={categoryId}
        visible={activeView === 'guide'}
        categoryStripOpen={categoriesOpen}
        sidebarExpanded={sidebarExpanded}
        onPlayChannel={handlePlayChannel}
        onClose={() => setActiveView('none')}
      />

      {/* Settings Panel */}
      {activeView === 'settings' && <Settings onClose={() => setActiveView('none')} />}

      {/* Movies Page */}
      {activeView === 'movies' && (
        <MoviesPage
          onPlay={handlePlayVod}
          onClose={() => setActiveView('none')}
        />
      )}

      {/* Series Page */}
      {activeView === 'series' && (
        <SeriesPage
          onPlay={handlePlayVod}
          onClose={() => setActiveView('none')}
        />
      )}

      {/* Resize grip for frameless window (Windows only - frameless windows lack native resize) */}
      {window.platform?.isWindows && (
      <div
        className="resize-grip"
        onMouseDown={(e) => {
          e.preventDefault();
          if (!window.electronWindow) return;

          const startX = e.screenX;
          const startY = e.screenY;
          let startWidth = window.innerWidth;
          let startHeight = window.innerHeight;
          let rafId: number | null = null;
          let pendingWidth = startWidth;
          let pendingHeight = startHeight;

          window.electronWindow.getSize().then(([w, h]) => {
            startWidth = w;
            startHeight = h;
          });

          const onMouseMove = (moveEvent: MouseEvent) => {
            pendingWidth = startWidth + (moveEvent.screenX - startX);
            pendingHeight = startHeight + (moveEvent.screenY - startY);

            // Throttle with RAF for smoother resize
            if (rafId === null) {
              rafId = requestAnimationFrame(() => {
                window.electronWindow?.setSize(pendingWidth, pendingHeight);
                rafId = null;
              });
            }
          };

          const onMouseUp = () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            // Final update to ensure we hit the exact position
            window.electronWindow?.setSize(pendingWidth, pendingHeight);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M11 21L21 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M15 21L21 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M19 21L21 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      )}
    </div>
  );
}

export default App;
