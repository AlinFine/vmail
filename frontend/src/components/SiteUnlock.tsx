import { useState } from "react";
import { useTranslation } from "react-i18next";

interface SiteUnlockProps {
  onUnlock: (password: string) => Promise<void>;
  isUnlocking: boolean;
  error: string | null;
}

export function SiteUnlock({ onUnlock, isUnlocking, error }: SiteUnlockProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      return;
    }
    await onUnlock(password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-zinc-950 shadow-sm"
      >
        <h1 className="mb-3 text-xl font-semibold">{t("Site locked")}</h1>
        <p className="mb-5 text-sm text-zinc-500">
          {t("Enter site password to continue")}
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("Password")}
          className="mb-4 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
        />

        {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}

        <button
          type="submit"
          disabled={isUnlocking || !password.trim()}
          className="w-full rounded-md bg-zinc-950 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUnlocking ? t("Unlocking...") : t("Unlock")}
        </button>
      </form>
    </div>
  );
}
