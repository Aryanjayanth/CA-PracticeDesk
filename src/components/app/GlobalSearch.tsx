import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useRoles } from "@/hooks/use-roles";
import { inr } from "@/lib/format";

type Hit = { id: string; group: string; title: string; sub: string; go: () => void };

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const navigate = useNavigate();
  const { isStaff, isFinance } = useRoles();

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const s = q.trim().replace(/[%,()]/g, "");
    const t = setTimeout(async () => {
      const out: Hit[] = [];
      if (isStaff) {
        const { data: c } = await supabase.from("clients").select("id,name,client_code,pan,gstin,mobile")
          .or(`name.ilike.%${s}%,client_code.ilike.%${s}%,pan.ilike.%${s}%,gstin.ilike.%${s}%,mobile.ilike.%${s}%`).limit(6);
        c?.forEach((x) => out.push({ id: x.id, group: "Clients", title: x.name, sub: `${x.client_code} · ${x.pan ?? ""} ${x.gstin ?? ""}`, go: () => navigate({ to: "/clients/$id", params: { id: x.id } }) }));
        const { data: j } = await supabase.from("jobs").select("id,job_code,title").or(`job_code.ilike.%${s}%,title.ilike.%${s}%`).limit(6);
        j?.forEach((x) => out.push({ id: x.id, group: "Jobs", title: x.title, sub: x.job_code, go: () => navigate({ to: "/jobs/$id", params: { id: x.id } }) }));
      }
      if (isFinance) {
        const { data: i } = await supabase.from("invoices").select("id,invoice_no,total").ilike("invoice_no", `%${s}%`).limit(6);
        i?.forEach((x) => out.push({ id: x.id, group: "Invoices", title: x.invoice_no, sub: inr(x.total), go: () => navigate({ to: "/invoices/$id", params: { id: x.id } }) }));
      }
      const { data: p } = await supabase.from("payments").select("id,payment_code,reference,amount").or(`payment_code.ilike.%${s}%,reference.ilike.%${s}%`).limit(6);
      p?.forEach((x) => out.push({ id: x.id, group: "Payments", title: x.payment_code, sub: `${x.reference ?? ""} · ${inr(x.amount)}`, go: () => navigate({ to: "/payments" }) }));
      setHits(out);
    }, 250);
    return () => clearTimeout(t);
  }, [q, isStaff, isFinance, navigate]);

  const groups = [...new Set(hits.map((h) => h.group))];
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:bg-muted">
        <Search className="h-4 w-4" /> Search clients, PAN, GSTIN, job, invoice, payment…
        <kbd className="ml-auto hidden rounded border px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
        <CommandInput value={q} onValueChange={setQ} placeholder="Type to search…" />
        <CommandList>
          <CommandEmpty>{q.length < 2 ? "Type at least 2 characters" : "No matches"}</CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g} heading={g}>
              {hits.filter((h) => h.group === g).map((h) => (
                <CommandItem key={h.group + h.id} value={h.group + h.id} onSelect={() => { setOpen(false); h.go(); }}>
                  <div><div className="font-medium">{h.title}</div><div className="text-xs text-muted-foreground">{h.sub}</div></div>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
