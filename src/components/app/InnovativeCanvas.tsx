import { useEffect, useRef } from "react";

interface Point3D {
  x: number;
  y: number;
  z: number;
  char: string;
  isSpecial?: boolean;
}

export function InnovativeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let time = 0;

    const chars = ["░", "▒", "▓", "│", "─", "┼", "·", "•", "₹", "%", "✓", "Σ"];

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      mouseRef.current.targetX = nx * 0.8;
      mouseRef.current.targetY = ny * 0.8;
    };

    window.addEventListener("mousemove", handleMouseMove);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    // Floating particle dust
    const dustParticles = Array.from({ length: 45 }, () => ({
      x: Math.random(),
      y: Math.random(),
      speed: 0.0003 + Math.random() * 0.0007,
      size: 1 + Math.random() * 2,
      alpha: 0.1 + Math.random() * 0.5,
    }));

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Smooth mouse lerp
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.05;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.05;

      const centerX = rect.width * 0.58;
      const centerY = rect.height * 0.48;
      const radius = Math.min(rect.width, rect.height) * 0.42;

      // ── 1. Floating ambient dust particles ──
      dustParticles.forEach((p) => {
        p.y -= p.speed;
        if (p.y < 0) p.y = 1;
        const px = p.x * rect.width;
        const py = p.y * rect.height;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(147, 197, 253, ${p.alpha * 0.4})`;
        ctx.fill();
      });

      // ── 2. Subtle background radar rings ──
      const ringAlpha = 0.04 + Math.sin(time * 1.5) * 0.02;
      [0.6, 0.9, 1.25].forEach((scale) => {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * scale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(96, 165, 250, ${ringAlpha})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 12]);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // ── 3. 3D Holographic Financial Sphere ──
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const points: Point3D[] = [];

      // Generate points around sphere surface with mathematical distribution
      const steps = 30;
      for (let i = 0; i < steps; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / steps);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i + time * 0.15;

        for (let ring = 0; ring < 2; ring++) {
          const rOffset = ring === 0 ? 1 : 0.72;
          const x0 = Math.sin(phi) * Math.cos(theta) * rOffset;
          const y0 = Math.sin(phi) * Math.sin(theta) * rOffset;
          const z0 = Math.cos(phi) * rOffset;

          // Rotation with time + mouse tilt
          const rotY = time * 0.35 + mouseRef.current.x * 0.7;
          const x1 = x0 * Math.cos(rotY) - z0 * Math.sin(rotY);
          const z1 = x0 * Math.sin(rotY) + z0 * Math.cos(rotY);

          const rotX = time * 0.2 + mouseRef.current.y * 0.5;
          const y2 = y0 * Math.cos(rotX) - z1 * Math.sin(rotX);
          const z2 = y0 * Math.sin(rotX) + z1 * Math.cos(rotX);

          // Select character based on depth and position
          const depthNorm = (z2 + 1) / 2;
          const isSpecial = i % 7 === 0;
          const char = isSpecial
            ? i % 14 === 0
              ? "₹"
              : "%"
            : chars[Math.min(Math.floor(depthNorm * (chars.length - 2)), chars.length - 1)];

          points.push({
            x: centerX + x1 * radius,
            y: centerY + y2 * radius,
            z: z2,
            char,
            isSpecial,
          });
        }
      }

      // Sort points from back to front for proper 3D depth
      points.sort((a, b) => a.z - b.z);

      // Render 3D points
      points.forEach((pt) => {
        const normZ = (pt.z + 1) / 2; // 0 to 1
        const alpha = Math.max(0.08, normZ * 0.85);

        if (pt.isSpecial) {
          // Highlight financial symbol
          ctx.fillStyle = `rgba(191, 219, 254, ${Math.min(1, alpha + 0.35)})`;
          ctx.font = "bold 13px monospace";
          ctx.fillText(pt.char, pt.x, pt.y);
          ctx.font = "12px monospace";
        } else {
          // Standard cyan/blue cyber text
          ctx.fillStyle = `rgba(147, 197, 253, ${alpha * 0.75})`;
          ctx.fillText(pt.char, pt.x, pt.y);
        }
      });

      // ── 4. Outer Orbital Latitude Orbit Rings ──
      const orbitAngles = [0, Math.PI / 3, (2 * Math.PI) / 3];
      orbitAngles.forEach((offset, idx) => {
        ctx.beginPath();
        const pts = 60;
        for (let i = 0; i <= pts; i++) {
          const t = (i / pts) * Math.PI * 2;
          const x0 = Math.cos(t) * 1.15;
          const y0 = Math.sin(t) * 0.35;
          const z0 = Math.sin(t) * 1.15;

          const rot = time * (0.18 + idx * 0.05) + offset;
          const rx = x0 * Math.cos(rot) - z0 * Math.sin(rot);
          const rz = x0 * Math.sin(rot) + z0 * Math.cos(rot);

          const px = centerX + rx * radius;
          const py = centerY + y0 * radius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = `rgba(96, 165, 250, ${0.12 + Math.sin(time + idx) * 0.05})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      time += 0.012;
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
      className="h-full w-full pointer-events-none"
      style={{ display: "block" }}
    />
  );
}
