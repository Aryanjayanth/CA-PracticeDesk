import { useRef } from "react";
import { Camera, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fileToAvatar } from "@/lib/image";

const tones = ["bg-primary/15 text-primary", "bg-success/15 text-success", "bg-warning/25 text-warning-foreground", "bg-destructive/10 text-destructive", "bg-accent text-accent-foreground"];

export function EntityAvatar({ name, src, className, square }: { name?: string | null; src?: string | null; className?: string; square?: boolean }) {
  const n = (name ?? "?").trim();
  const initials = n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  const tone = tones[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length];
  return (
    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden font-semibold", square ? "rounded-lg" : "rounded-full", !src && tone, className)}>
      {src ? <img src={src} alt={n} className="h-full w-full object-cover" /> : <span className="text-[0.8em]">{initials}</span>}
    </div>
  );
}

export function AvatarPicker({ name, value, onChange, square }: { name?: string; value?: string | null; onChange: (v: string | null) => void; square?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <EntityAvatar name={name} src={value} square={square} className="h-20 w-20 text-2xl" />
        {value && (
          <button type="button" onClick={() => onChange(null)} className="absolute -right-1 -top-1 rounded-full border bg-card p-0.5 text-muted-foreground hover:text-destructive" aria-label="Remove photo">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <button type="button" onClick={() => ref.current?.click()} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
        <Camera className="h-4 w-4" />{value ? "Change photo" : "Upload photo"}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        try { onChange(await fileToAvatar(f)); } catch (err) { toast.error(err instanceof Error ? err.message : "Upload failed"); }
      }} />
    </div>
  );
}
