'use client';
/* The sign-in warp transition, lifted out of login.html unchanged in
   behaviour — same phases, same starfield, same timings. It just owns
   its own canvas and cleans up its rAF loop on unmount now. */
import { useEffect, useRef } from 'react';

const STAR_COLORS = ['#FFFFFF', '#EEEEFF', '#DDDDFF', '#CCCCFF', '#EEE8FF', '#F8F0FF', '#C8AAFF', '#E0D0FF'];
const NUM_STARS = 420;

function hexToRgba(hex: string, alpha: number) {
  if (!hex.startsWith('#')) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function GalaxyTransition({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const progWrapRef = useRef<HTMLDivElement>(null);
  const progBarRef = useRef<HTMLDivElement>(null);
  const scanlineRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let raf = 0;
    let setWarp: ((fast: boolean) => void) | null = null;
    let onResize: (() => void) | null = null;

    function animateProgress(el: HTMLElement, from: number, to: number, duration: number) {
      const start = performance.now();
      function tick(now: number) {
        const t = Math.min((now - start) / duration, 1);
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        el.style.width = `${from + (to - from) * ease}%`;
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    function initCanvas() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      resize();
      onResize = resize;
      window.addEventListener('resize', resize);

      const stars = Array.from({ length: NUM_STARS }, () => ({
        x: (Math.random() - 0.5) * canvas.width * 2.5,
        y: (Math.random() - 0.5) * canvas.height * 2.5,
        z: Math.random() * canvas.width,
        pz: 0,
        size: Math.random() * 2.5 + 0.5,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        twinkle: Math.random() * Math.PI * 2,
      }));

      let warpSpeed = 3;
      let targetSpeed = 3;
      setWarp = (fast: boolean) => {
        targetSpeed = fast ? 28 : 3;
      };

      let lastT = 0;
      function drawFrame(ts: number) {
        const dt = Math.min((ts - lastT) / 16.67, 3);
        lastT = ts;
        warpSpeed += (targetSpeed - warpSpeed) * 0.04 * dt;

        const W = canvas!.width;
        const H = canvas!.height;
        ctx!.clearRect(0, 0, W, H);

        // Deep space background gradient
        const bg = ctx!.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
        bg.addColorStop(0, 'rgba(18, 0, 40, 0.55)');
        bg.addColorStop(0.5, 'rgba(6, 0, 20, 0.75)');
        bg.addColorStop(1, 'rgba(0, 0, 6, 0.90)');
        ctx!.fillStyle = bg;
        ctx!.fillRect(0, 0, W, H);

        const speed = warpSpeed * dt;

        for (const s of stars) {
          s.pz = s.z;
          s.z -= speed;
          s.twinkle += 0.04;

          if (s.z <= 0) {
            s.x = (Math.random() - 0.5) * W * 2.5;
            s.y = (Math.random() - 0.5) * H * 2.5;
            s.z = W;
            s.pz = W;
            s.color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
          }

          const sx = (s.x / s.z) * W / 2 + W / 2;
          const sy = (s.y / s.z) * H / 2 + H / 2;
          const spx = (s.x / s.pz) * W / 2 + W / 2;
          const spy = (s.y / s.pz) * H / 2 + H / 2;
          const size = (1 - s.z / W) * s.size * 2.8;

          if (warpSpeed > 8 && (Math.abs(spx - sx) > 1 || Math.abs(spy - sy) > 1)) {
            // At high warp: draw streaks
            const alpha = Math.min((warpSpeed / 30) * 0.85, 0.85);
            ctx!.strokeStyle = hexToRgba(s.color, alpha);
            ctx!.lineWidth = Math.max(size * 0.6, 0.4);
            ctx!.beginPath();
            ctx!.moveTo(spx, spy);
            ctx!.lineTo(sx, sy);
            ctx!.stroke();
          } else {
            const twinkleAlpha = 0.65 + 0.35 * Math.sin(s.twinkle);
            ctx!.fillStyle = hexToRgba(s.color, twinkleAlpha);
            ctx!.beginPath();
            ctx!.arc(sx, sy, Math.max(size, 0.3), 0, Math.PI * 2);
            ctx!.fill();
            if (size > 1.8) {
              const glow = ctx!.createRadialGradient(sx, sy, 0, sx, sy, size * 4);
              glow.addColorStop(0, hexToRgba(s.color, 0.3));
              glow.addColorStop(1, 'rgba(0,0,0,0)');
              ctx!.fillStyle = glow;
              ctx!.beginPath();
              ctx!.arc(sx, sy, size * 4, 0, Math.PI * 2);
              ctx!.fill();
            }
          }
        }

        // Central lens flare (subtle)
        const flareAlpha = Math.max(0, Math.min(0.06, (warpSpeed - 2) / 60));
        if (flareAlpha > 0) {
          const flare = ctx!.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 280);
          flare.addColorStop(0, `rgba(0,140,255, ${flareAlpha})`);
          flare.addColorStop(0.5, `rgba(100, 0, 180, ${flareAlpha * 0.4})`);
          flare.addColorStop(1, 'rgba(0,0,0,0)');
          ctx!.fillStyle = flare;
          ctx!.fillRect(0, 0, W, H);
        }

        raf = requestAnimationFrame(drawFrame);
      }

      raf = requestAnimationFrame(drawFrame);
    }

    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    // Phase 2: Overlay fades in
    at(200, () => {
      const o = overlayRef.current;
      if (o) {
        o.style.transition = 'opacity 0.55s ease';
        o.classList.add('visible');
      }
      initCanvas();
    });

    // Phase 3: Grid scan + scanline
    at(600, () => {
      if (gridRef.current) gridRef.current.style.animationPlayState = 'running';
      if (scanlineRef.current) scanlineRef.current.style.animationPlayState = 'running';
    });

    // Phase 4: Rings + title appear
    at(1100, () => {
      const t = titleRef.current;
      if (t) {
        t.style.animationPlayState = 'running';
        t.classList.add('pulse');
      }
    });

    // Phase 5: Subtitle + progress bar
    at(1700, () => {
      if (subtitleRef.current) subtitleRef.current.style.animationPlayState = 'running';
      if (progWrapRef.current) progWrapRef.current.style.animationPlayState = 'running';
      if (progBarRef.current) animateProgress(progBarRef.current, 0, 85, 1200);
    });

    // Phase 6: Warp speed + progress to 100
    at(2900, () => {
      setWarp?.(true);
      if (progBarRef.current) animateProgress(progBarRef.current, 85, 100, 500);
      const sub = subtitleRef.current;
      if (sub) {
        sub.textContent = '▸ ACCESS GRANTED';
        sub.style.color = 'rgba(200, 255, 180, 0.85)';
        sub.style.textShadow = '0 0 12px rgba(160,255,100,0.6)';
      }
    });

    // Phase 7: White flash + hand off
    at(3500, () => {
      flashRef.current?.classList.add('burst');
      at(420, onDone);
    });

    return () => {
      timers.forEach(clearTimeout);
      if (raf) cancelAnimationFrame(raf);
      if (onResize) window.removeEventListener('resize', onResize);
    };
  }, [onDone]);

  return (
    <div id="galaxy-overlay" ref={overlayRef}>
      <canvas id="galaxy-canvas" ref={canvasRef} />
      <div className="gx-nebula gx-nebula-1" />
      <div className="gx-nebula gx-nebula-2" />
      <div className="gx-nebula gx-nebula-3" />
      <div className="gx-grid" id="gx-grid" ref={gridRef} />

      <div className="gx-center">
        <div className="gx-rings-wrap">
          <div className="gx-ring gx-ring-1" />
          <div className="gx-ring gx-ring-2" />
          <div className="gx-ring gx-ring-3" />
          <div className="gx-core" />
        </div>

        <div className="gx-title" id="gx-title" ref={titleRef}>
          RAMSSOL PRE-SALES COPILOT
        </div>
        <div className="gx-subtitle" id="gx-subtitle" ref={subtitleRef}>
          ▸ INITIALIZING WORKSPACE...
        </div>
        <div className="gx-progress-wrap" id="gx-progress-wrap" ref={progWrapRef}>
          <div className="gx-progress-bar" id="gx-progress-bar" ref={progBarRef} />
        </div>
      </div>

      <div className="gx-scanline" id="gx-scanline" ref={scanlineRef} />
      <div className="gx-flash" id="gx-flash" ref={flashRef} />
    </div>
  );
}
