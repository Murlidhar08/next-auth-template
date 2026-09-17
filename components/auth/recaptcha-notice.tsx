"use client";

import { envClient } from "@/lib/env.client";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

export function RecaptchaNotice() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const siteKey = envClient.NEXT_PUBLIC_CAPTCHA_SITE_KEY;
  if (!mounted || !siteKey) return null;

  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground/80 px-2.5 py-1.5 rounded-xl bg-muted/30 border border-border/40 backdrop-blur-xs shadow-2xs">
      <div className="flex items-center gap-1.5 font-semibold text-foreground/80">
        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
        <span>Protected by reCAPTCHA</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] font-medium">
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noreferrer"
          className="hover:underline hover:text-primary transition-colors"
        >
          Privacy
        </a>
        <span>•</span>
        <a
          href="https://policies.google.com/terms"
          target="_blank"
          rel="noreferrer"
          className="hover:underline hover:text-primary transition-colors"
        >
          Terms
        </a>
      </div>
    </div>
  );
}
