import { useState, useEffect } from "react";

export function useAdminPrivacy() {
  const [privacyMode, setPrivacyModeState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("ca_admin_privacy_mode");
    // Default to true (Privacy Mode ON)
    return saved === null ? true : saved === "true";
  });

  const setPrivacyMode = (val: boolean) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ca_admin_privacy_mode", String(val));
      setPrivacyModeState(val);
      window.dispatchEvent(new Event("admin-privacy-change"));
    }
  };

  useEffect(() => {
    const handler = () => {
      const saved = localStorage.getItem("ca_admin_privacy_mode");
      setPrivacyModeState(saved === null ? true : saved === "true");
    };
    window.addEventListener("admin-privacy-change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("admin-privacy-change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return { privacyMode, setPrivacyMode };
}
