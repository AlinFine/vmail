import {
  Dispatch,
  SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";
import { Modal } from "./modal";
import { useTranslation } from "react-i18next";
import Close from "./icons/Close";
import toast from "react-hot-toast";
import { useConfig } from "../hooks/useConfig";

export default function SenderModal({
  senderEmail,
  mailboxToken,
  showSenderModal,
  setShowSenderModal,
}: {
  senderEmail: string;
  mailboxToken: string;
  showSenderModal: boolean;
  setShowSenderModal: Dispatch<SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  const config = useConfig();
  const [isSending, setIsSending] = useState(false);

  const hasSender = Boolean(
    config.sendChannel && config.senderEmail && mailboxToken,
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSending(true);
    const form = e.currentTarget;

    const formData = new FormData(form);
    const payload = {
      senderName: formData.get("senderName") as string,
      receiverEmail: formData.get("receiverEmail") as string,
      subject: formData.get("subject") as string,
      content: formData.get("content") as string,
      type: (formData.get("type") as string) || "text/plain",
    };

    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mailboxToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
      };

      if (!res.ok) {
        throw new Error(
          data.code ? t(data.code) : data.message || t("Failed to send email"),
        );
      }

      form.reset();
      setShowSenderModal(false);
      toast.success(t("Message sent"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Failed to send email"),
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal showModal={showSenderModal} setShowModal={setShowSenderModal}>
      <div className="w-full overflow-hidden bg-white p-4 text-zinc-950 shadow-xl md:max-w-3xl md:rounded-lg md:border md:border-zinc-200">
        <Close
          className="absolute right-8 top-5 h-6 w-6 cursor-pointer text-zinc-500 transition hover:text-zinc-950 md:right-4"
          onClick={() => setShowSenderModal(false)}
        />

        <div className="border-b border-zinc-200 px-4 py-4">
          <h3 className="font-display text-lg font-semibold">发送邮件</h3>
        </div>
        <form
          onSubmit={handleSubmit}
          className="mt-4 flex flex-col space-y-4 px-4"
        >
          <div className="flex w-full flex-col gap-4 md:flex-row">
            <input
              value={config.senderEmail}
              type="email"
              name="fromEmail"
              placeholder={t("Sending email *")}
              required
              readOnly
              title={`${t("Reply-To:")} ${senderEmail}`}
              className="w-full cursor-not-allowed rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-zinc-500 outline-none"
            />
            <input
              type="text"
              name="senderName"
              placeholder={t("Sending name")}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            />
          </div>

          <div className="flex w-full flex-col gap-4 md:flex-row">
            <input
              type="email"
              name="receiverEmail"
              placeholder={t("Recipient email *")}
              required
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            />
            <input
              type="text"
              name="subject"
              placeholder={t("Email subject *")}
              required
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            />
          </div>

          <div className="w-full">
            <select
              name="type"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            >
              <option value="text/plain">纯文本</option>
              <option value="text/html">HTML</option>
            </select>
          </div>
          <div className="w-full">
            <textarea
              name="content"
              placeholder={t("Email content *")}
              required
              className="min-h-32 w-full resize-y rounded-md border border-zinc-300 bg-white p-3 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            ></textarea>
          </div>

          {hasSender && (
            <button
              type="submit"
              disabled={isSending}
              className="w-full rounded-md bg-zinc-950 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {isSending ? t("Sending...") : t("Send")}
            </button>
          )}
          {!hasSender && (
            <p className="w-full rounded-md border border-dashed border-zinc-300 py-2.5 text-center text-sm text-zinc-500">
              {t("No sending service configured")}
            </p>
          )}
        </form>
      </div>
    </Modal>
  );
}

export function useSenderModal(senderEmail: string, mailboxToken: string) {
  const [showSenderModal, setShowSenderModal] = useState(false);

  const SenderModalCallback = useCallback(() => {
    return (
      <SenderModal
        senderEmail={senderEmail}
        mailboxToken={mailboxToken}
        showSenderModal={showSenderModal}
        setShowSenderModal={setShowSenderModal}
      />
    );
  }, [mailboxToken, senderEmail, showSenderModal]);

  return useMemo(
    () => ({ setShowSenderModal, SenderModal: SenderModalCallback }),
    [setShowSenderModal, SenderModalCallback],
  );
}
