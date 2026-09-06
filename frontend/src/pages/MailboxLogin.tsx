import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import { toast } from "react-hot-toast";
import { loginPermanentMailbox } from "../services/api.ts";

export function MailboxLogin() {
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim() || !password) {
      toast.error("\u8bf7\u8f93\u5165\u90ae\u7bb1\u548c\u5bc6\u7801");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await loginPermanentMailbox(address.trim(), password);
      Cookies.set("userMailbox", result.address);
      Cookies.set("permanentMailbox", result.permanent === false ? "0" : "1");
      if (result.permanent === false && result.expiresAt) {
        const expiresAt = new Date(result.expiresAt).getTime();
        Cookies.set("emailExpiry", expiresAt.toString(), { expires: 1 });
      } else {
        Cookies.remove("emailExpiry");
      }
      if (result.mailboxToken) {
        Cookies.set("mailboxToken", result.mailboxToken, { expires: 30 });
      }
      toast.success("\u767b\u5f55\u6210\u529f");
      navigate("/");
    } catch (error: any) {
      toast.error(
        error?.message || "\u90ae\u7bb1\u6216\u5bc6\u7801\u9519\u8bef",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-8 text-zinc-950">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">
            {"\u90ae\u7bb1\u767b\u5f55"}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {
              "\u767b\u5f55\u540e\u67e5\u770b\u90ae\u7bb1\u4e2d\u7684\u5386\u53f2\u90ae\u4ef6\u548c\u65b0\u90ae\u4ef6"
            }
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-zinc-700">
            {"\u90ae\u7bb1\u5730\u5740"}
            <input
              type="email"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="name@example.com"
              autoComplete="username"
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            {"\u5bc6\u7801"}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            />
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-zinc-950 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "\u767b\u5f55\u4e2d..." : "\u767b\u5f55"}
          </button>
        </form>
        <Link
          to="/"
          className="mt-5 block text-center text-sm text-zinc-500 underline-offset-4 transition hover:text-zinc-950 hover:underline"
        >
          {"\u8fd4\u56de\u9996\u9875"}
        </Link>
      </section>
    </main>
  );
}
