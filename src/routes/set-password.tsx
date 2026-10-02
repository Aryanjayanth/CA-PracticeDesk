import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/app/common";

export const Route = createFileRoute("/set-password")({
  head: () => ({
    meta: [
      { title: "Set your password — CA PracticeDesk" },
      { name: "description", content: "Finish setting up your CA PracticeDesk account." },
      { property: "og:title", content: "Set your password — CA PracticeDesk" },
      { property: "og:description", content: "Finish setting up your CA PracticeDesk account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetPassword,
});

function SetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setReady(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== pw2) return toast.error("Passwords don't match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password set — welcome!");
    navigate({ to: "/dashboard", replace: true });
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="p-8">
          <h1 className="text-xl font-semibold">Set your password</h1>
          <p className="mb-6 text-sm text-muted-foreground">{ready ? "Choose a password to finish setting up your account." : "Open this page from the link in your invite email."}</p>
          <form onSubmit={save} className="space-y-4">
            <Field label="New password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={!ready} /></Field>
            <Field label="Confirm password"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={!ready} /></Field>
            <Button className="w-full" disabled={!ready || busy}>{busy ? "Saving…" : "Save password"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
