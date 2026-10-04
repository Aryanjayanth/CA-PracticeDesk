import { useEffect, useRef } from "react";

/**
 * A slowly rotating wireframe sphere rendered with canvas 2D.
 * Adapts to container size, uses the sidebar-primary blue colour.
 */
export function AnimatedSphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let time = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const radius = Math.min(rect.width, rect.height) * 0.38;

      // ── Longitude lines ──
      const lonStep = Math.PI / 8;
      const detail = 80;

      for (let lon = 0; lon < Math.PI * 2; lon += lonStep) {
        ctx.beginPath();
        for (let i = 0; i <= detail; i++) {
          const lat = (i / detail) * Math.PI;
          const x3 = Math.sin(lat) * Math.cos(lon);
          const y3 = Math.cos(lat);
          const z3 = Math.sin(lat) * Math.sin(lon);

          // Rotate Y
          const ry = time * 0.25;
          const rx3 = x3 * Math.cos(ry) - z3 * Math.sin(ry);
          const rz3 = x3 * Math.sin(ry) + z3 * Math.cos(ry);
          // Rotate X
          const rxA = time * 0.15;
          const ry3 = y3 * Math.cos(rxA) - rz3 * Math.sin(rxA);
          const fz = y3 * Math.sin(rxA) + rz3 * Math.cos(rxA);

          const px = centerX + rx3 * radius;
          const py = centerY + ry3 * radius;
          const alpha = 0.08 + (fz + 1) * 0.22;

          ctx.strokeStyle = `rgba(130,170,255,${alpha})`;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── Latitude rings ──
      const latStep = Math.PI / 8;
      for (let lat = latStep; lat < Math.PI; lat += latStep) {
        ctx.beginPath();
        for (let i = 0; i <= detail; i++) {
          const lon2 = (i / detail) * Math.PI * 2;
          const x3 = Math.sin(lat) * Math.cos(lon2);
          const y3 = Math.cos(lat);
          const z3 = Math.sin(lat) * Math.sin(lon2);

          const ry = time * 0.25;
          const rx3 = x3 * Math.cos(ry) - z3 * Math.sin(ry);
          const rz3 = x3 * Math.sin(ry) + z3 * Math.cos(ry);
          const rxA = time * 0.15;
          const ry3 = y3 * Math.cos(rxA) - rz3 * Math.sin(rxA);
          const fz = y3 * Math.sin(rxA) + rz3 * Math.cos(rxA);

          const px = centerX + rx3 * radius;
          const py = centerY + ry3 * radius;
          const alpha = 0.06 + (fz + 1) * 0.18;

          ctx.strokeStyle = `rgba(130,170,255,${alpha})`;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      // ── Glow dot at vertices ──
      const dotCount = 60;
      for (let i = 0; i < dotCount; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / dotCount);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const x3 = Math.sin(phi) * Math.cos(theta);
        const y3 = Math.sin(phi) * Math.sin(theta);
        const z3 = Math.cos(phi);

        const ry = time * 0.25;
        const rx3 = x3 * Math.cos(ry) - z3 * Math.sin(ry);
        const rz3 = x3 * Math.sin(ry) + z3 * Math.cos(ry);
        const rxA = time * 0.15;
        const ry3 = y3 * Math.cos(rxA) - rz3 * Math.sin(rxA);
        const fz = y3 * Math.sin(rxA) + rz3 * Math.cos(rxA);

        const px = centerX + rx3 * radius;
        const py = centerY + ry3 * radius;
        const alpha = 0.25 + (fz + 1) * 0.35;
        const r = 1.5 + (fz + 1) * 1.2;

        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(140,190,255,${alpha})`;
        ctx.fill();
      }

      time += 0.008;
      frameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full" style={{ display: "block" }} />;
}
