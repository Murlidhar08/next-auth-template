"use client";

import { envClient } from "@/lib/env.client";
import { ReactNode, useEffect, useState } from "react";
import { GoogleReCaptchaProvider } from "react-google-recaptcha-v3";

export function ReCaptchaProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const siteKey = envClient.NEXT_PUBLIC_CAPTCHA_SITE_KEY;
  if (!mounted || !siteKey) {
    return <>{children}</>;
  }

  return (
    <GoogleReCaptchaProvider
      reCaptchaKey={siteKey}
      scriptProps={{
        async: true,
        defer: true,
        appendTo: "head",
      }}
    >
      {children}
    </GoogleReCaptchaProvider>
  );
}
