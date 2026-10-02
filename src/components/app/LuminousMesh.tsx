import { useEffect, useRef } from "react";

export function LuminousMesh() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let time = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.targetX = (e.clientX - rect.left) / rect.width;
      mouseRef.current.targetY = (e.clientY - rect.top) / rect.height;
    };

    window.addEventListener("mousemove", handleMouseMove);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

      // Smooth mouse lerp
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.04;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.04;

      const cols = 28;
      const rows = 20;
      const spacingX = rect.width / (cols - 1);
      const spacingY = rect.height / (rows - 1);

      const grid: { x: number; y: number; elevation: number; alpha: number }[][] = [];

      const mx = mouseRef.current.x * rect.width;
      const my = mouseRef.current.y * rect.height;

      // Calculate 3D undulating wave grid
      for (let r = 0; r < rows; r++) {
        grid[r] = [];
        for (let c = 0; c < cols; c++) {
          const baseX = c * spacingX;
          const baseY = r * spacingY;

          // Wave interference
          const distToMouse = Math.hypot(baseX - mx, baseY - my);
          const mouseEffect = Math.max(0, 1 - distToMouse / 280) * 25;

          const wave1 = Math.sin(c * 0.28 + time * 1.2) * Math.cos(r * 0.22 + time * 0.8);
          const wave2 = Math.sin((c + r) * 0.2 + time * 1.5) * 14;
          const elevation = wave1 * 22 + wave2 + mouseEffect;

          const px = baseX;
          const py = baseY + elevation;

          const normalizedElevation = (elevation + 36) / 72;
          const alpha = Math.max(0.08, Math.min(0.65, 0.15 + normalizedElevation * 0.5));

          grid[r][c] = { x: px, y: py, elevation, alpha };
        }
      }

      // Draw horizontal spline curves
      for (let r = 0; r < rows; r++) {
        ctx.beginPath();
        for (let c = 0; c < cols; c++) {
          const pt = grid[r][c];
          if (c === 0) ctx.moveTo(pt.x, pt.y);
          else {
            const prev = grid[r][c - 1];
            const cx = (prev.x + pt.x) / 2;
            const cy = (prev.y + pt.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, cx, cy);
          }
        }
        const rowAlpha = Math.sin((r / (rows - 1)) * Math.PI) * 0.28;
        ctx.strokeStyle = `rgba(96, 165, 250, ${rowAlpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw vertical spline curves
      for (let c = 0; c < cols; c += 2) {
        ctx.beginPath();
        for (let r = 0; r < rows; r++) {
          const pt = grid[r][c];
          if (r === 0) ctx.moveTo(pt.x, pt.y);
          else {
            const prev = grid[r - 1][c];
            const cx = (prev.x + pt.x) / 2;
            const cy = (prev.y + pt.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, cx, cy);
          }
        }
        const colAlpha = Math.sin((c / (cols - 1)) * Math.PI) * 0.16;
        ctx.strokeStyle = `rgba(147, 197, 253, ${colAlpha})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Draw luminous node intersections
      for (let r = 2; r < rows - 2; r += 2) {
        for (let c = 2; c < cols - 2; c += 2) {
          const pt = grid[r][c];
          const dist = Math.hypot(pt.x - mx, pt.y - my);
          const isNearMouse = dist < 180;
          const radius = isNearMouse ? 2.5 : 1.5;

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = isNearMouse
            ? `rgba(191, 219, 254, ${pt.alpha * 1.2})`
            : `rgba(96, 165, 250, ${pt.alpha * 0.7})`;
          ctx.fill();
        }
      }

      time += 0.016;
      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none h-full w-full"
      style={{ display: "block" }}
    />
  );
}
