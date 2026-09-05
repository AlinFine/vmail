import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Turnstile } from "@marsidev/react-turnstile";
import { useTranslation } from "react-i18next";
import Cookies from "js-cookie";
import { toast } from "react-hot-toast";
import { Link } from "react-router-dom";

import { MailList } from "../components/MailList.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import {
  getEmails,
  getMailboxMeta,
  deleteEmails,
  loginByPassword,
  refreshMailboxToken,
  verifyTurnstile,
  createPermanentMailbox,
  setPermanentMailboxPassword,
} from "../services/api.ts";
import { useConfig } from "../hooks/useConfig.ts";
import { encrypt } from "../lib/utlis.ts";

import { usePasswordModal } from "../components/password.tsx";
import PasswordIcon from "../components/icons/Password.tsx";
import Close from "../components/icons/Close.tsx";

import type { Email } from "../database_types.ts";
import { InfoModal } from "../components/InfoModal.tsx";
import { MailDetail } from "./MailDetail.tsx";
import { CountdownTimer } from "../components/CountdownTimer.tsx";
import { useSenderModal } from "../components/sender.tsx";

export function Home() {
  const config = useConfig();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [address, setAddress] = useState<string | undefined>(() =>
    Cookies.get("userMailbox"),
  );
  const [isPermanentMailbox, setIsPermanentMailbox] = useState(
    () => Cookies.get("permanentMailbox") === "1",
  );
  const [needsPermanentPassword, setNeedsPermanentPassword] = useState(
    () => Cookies.get("permanentPasswordPending") === "1",
  );
  const [mailboxToken, setMailboxToken] = useState<string>(
    () => Cookies.get("mailboxToken") || "",
  );
  const [expiryTimestamp, setExpiryTimestamp] = useState<number | undefined>(
    () => {
      const expiry = Cookies.get("emailExpiry");
      return expiry ? parseInt(expiry, 10) : undefined;
    },
  );
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string>(
    config.emailDomain[0],
  );
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [mailboxMode, setMailboxMode] = useState<"temporary" | "permanent">(
    () => (Cookies.get("permanentMailbox") === "1" ? "permanent" : "temporary"),
  );
  const [permanentLocalPart, setPermanentLocalPart] = useState("");
  const [permanentPassword, setPermanentPassword] = useState("");
  const [isCreatingPermanent, setIsCreatingPermanent] = useState(false);
  const [isSettingPermanentPassword, setIsSettingPermanentPassword] = useState(false);

  const { PasswordModal, setShowPasswordModal } = usePasswordModal();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const { SenderModal, setShowSenderModal } = useSenderModal(
    address || "",
    mailboxToken,
  );
  const canSendEmails = Boolean(address && mailboxToken && config.sendChannel);

  const [hasReceivedEmail, setHasReceivedEmail] = useState(false);

  // 使用 React Query 获取邮件列表
  const {
    data: emails = [],
    isLoading,
    isFetching,
    refetch,
    error: emailsError,
  } = useQuery<Email[], Error>({
    queryKey: ["emails", address, mailboxToken],
    queryFn: () => getEmails(address!, 50, mailboxToken || undefined),
    enabled: !!address, // 只有在 address 存在时才执行查询
    refetchInterval: () =>
      document.visibilityState === "visible" ? 5000 : false,
    retry: false, // 失败后不自动重试
  });

  useEffect(() => {
    if (emailsError) {
      toast.error(`${t("Failed to get emails")}: ${emailsError.message}`, {
        duration: 5000,
      });
    }
  }, [emailsError, t]);

  const mailboxMetaSignatureRef = useRef<string | null>(null);

  const { data: mailboxMeta } = useQuery({
    queryKey: ["emails-meta", address, mailboxToken],
    queryFn: () => getMailboxMeta(address!, mailboxToken || undefined),
    enabled: !!address,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 5000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => {
    if (!mailboxMeta) {
      return;
    }

    const signature = `${mailboxMeta.count}:${mailboxMeta.latestEmailCreatedAt ?? ""}`;
    if (mailboxMetaSignatureRef.current === null) {
      mailboxMetaSignatureRef.current = signature;
      return;
    }

    if (mailboxMetaSignatureRef.current !== signature) {
      mailboxMetaSignatureRef.current = signature;
      queryClient.invalidateQueries({ queryKey: ["emails", address] });
    }
  }, [address, mailboxMeta, queryClient]);

  // feat: 将密码提示封装成一个函数，并用 useCallback 包裹以优化性能。
  // refactor: 移除自定义的 toast.custom, 使用全局 toast
  const showPasswordToast = useCallback(
    (password: string) => {
      toast(
        (toastInstance) => (
          // 优化：为弹窗添加独立的标题栏和关闭按钮，并调整整体样式
          <div className="w-full max-w-lg p-4 bg-slate-800 text-white rounded-lg shadow-lg border border-slate-700">
            {/* 标题栏：包含图标、标题和关闭按钮 */}
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <PasswordIcon className="h-6 w-6 text-cyan-400" />
                <h3 className="text-lg font-semibold">{t("View password")}</h3>
              </div>
              <button
                onClick={() => toast.dismiss(toastInstance.id)}
                className="p-1 rounded-full text-gray-400 hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                aria-label="Close"
              >
                <Close className="h-5 w-5" />
              </button>
            </div>

            {/* 内容区域 */}
            <div>
              <p className="text-sm text-gray-300">
                {t("Save your password and continue using this email in 1 day")}
              </p>
              <div className="mt-2 flex items-center text-sm bg-slate-700 px-2 py-1 rounded">
                <span className="flex-1 font-mono break-all text-gray-100">
                  {password}
                </span>
                <CopyButton text={password} className="p-1" />
              </div>
              <p className="mt-3 text-xs text-yellow-400">
                {t(
                  "Remember your password, otherwise your email will expire and cannot be retrieved",
                )}
              </p>
            </div>
          </div>
        ),
        {
          id: "password-notification", // 防止重复通知
          duration: 5000, // 5秒后自动关闭
          position: "top-center",
          // 优化：移除默认样式，让自定义组件完全控制外观
          style: {
            background: "transparent",
            border: "none",
            padding: 0,
            boxShadow: "none",
          },
        },
      );
    },
    [t],
  );

  // feat(fix): 使用useEffect来检测新邮件、显示密码通知，并控制”查看密码”按钮的可见性
  const prevEmailsLength = useRef(emails.length);
  useEffect(() => {
    // 修复：只要邮件列表不为空，就确保 hasReceivedEmail 状态为 true。
    // 这修复了从其他页面导航回来时，因组件重新挂载导致状态重置、图标不显示的问题。
    if (emails.length > 0 && !hasReceivedEmail) {
      setHasReceivedEmail(true);
    }

    // 当用户停止使用邮箱时（地址被清除），重置状态并关闭通知
    if (!address) {
      setHasReceivedEmail(false);
      // feat: 清除过期时间戳状态
      setExpiryTimestamp(undefined);
      toast.dismiss("password-notification");
    } else {
      // feat: 当地址存在时，尝试读取过期时间 cookie
      const expiry = Cookies.get("emailExpiry");
      if (expiry && !expiryTimestamp) {
        setExpiryTimestamp(parseInt(expiry, 10));
      }
    }

    prevEmailsLength.current = emails.length;
    // }, [emails, address, hasReceivedEmail]); // 依赖项包含 emails, address 和 hasReceivedEmail 以响应所有相关变化
    // feat: 添加 expiryTimestamp 到依赖项
  }, [emails, address, hasReceivedEmail, expiryTimestamp]);

  // 创建新邮箱地址的处理函数
  const handleCreateAddress = async () => {
    const requireTurnstile = config.turnstileEnabled;

    if (requireTurnstile && !turnstileToken) {
      toast.error(t("No captcha response"));
      return;
    }

    try {
      const authorization = await verifyTurnstile(
        selectedDomain,
        requireTurnstile ? turnstileToken : undefined,
      );
      const mailbox = authorization.mailbox;
      // feat: 计算并存储过期时间戳 (当前时间 + 24小时)
      const now = Date.now();
      const expires = now + 24 * 60 * 60 * 1000;
      Cookies.set("userMailbox", mailbox, { expires: 1 }); // cookie 有效期1天
      Cookies.set("emailExpiry", expires.toString(), { expires: 1 }); // 存储过期时间戳
      if (authorization.mailboxToken) {
        Cookies.set("mailboxToken", authorization.mailboxToken, { expires: 1 });
      } else {
        Cookies.remove("mailboxToken");
      }
      setAddress(mailbox);
      setIsPermanentMailbox(false);
      setNeedsPermanentPassword(false);
      setMailboxMode("temporary");
      Cookies.remove("permanentMailbox");
      Cookies.remove("permanentPasswordPending");
      setMailboxToken(authorization.mailboxToken || "");
      setExpiryTimestamp(expires); // 更新状态
      setHasReceivedEmail(false); // 重置接收邮件状态
      toast.success(t("Email created successfully")); // feat: 使用全局 toast 提示
    } catch (error) {
      toast.error(t("Failed to verify captcha"));
      console.error("Turnstile verification failed:", error);
    }
  };

  const handleCreatePermanentAddress = async () => {
    const localPart = permanentLocalPart.trim().toLowerCase();
    if (!localPart) {
      toast.error("请输入邮箱名称");
      return;
    }
    if (config.turnstileEnabled && !turnstileToken) {
      toast.error(t("No captcha response"));
      return;
    }

    setIsCreatingPermanent(true);
    try {
      const result = await createPermanentMailbox(localPart, selectedDomain, config.turnstileEnabled ? turnstileToken : undefined);
      Cookies.set("userMailbox", result.address);
      Cookies.set("permanentMailbox", "1");
      Cookies.set("permanentPasswordPending", "1", { expires: 30 });
      Cookies.remove("emailExpiry");
      setAddress(result.address);
      setIsPermanentMailbox(true);
      setNeedsPermanentPassword(true);
      if (result.mailboxToken) {
        Cookies.set("mailboxToken", result.mailboxToken, { expires: 30 });
      }
      setMailboxToken(result.mailboxToken || "");
      setExpiryTimestamp(undefined);
      setHasReceivedEmail(false);
      toast.success("固定邮箱已创建，请先接收一封邮件");
    } catch (error: any) {
      toast.error(error?.message || "固定邮箱创建失败");
    } finally {
      setIsCreatingPermanent(false);
    }
  };

  const handleSetPermanentPassword = async () => {
    if (!address || permanentPassword.length < 8) {
      toast.error("密码至少需要 8 位");
      return;
    }
    setIsSettingPermanentPassword(true);
    try {
      const result = await setPermanentMailboxPassword(address, permanentPassword, mailboxToken || undefined);
      if (result.mailboxToken) {
        Cookies.set("mailboxToken", result.mailboxToken, { expires: 30 });
        setMailboxToken(result.mailboxToken);
      }
      setPermanentPassword("");
      Cookies.remove("permanentPasswordPending");
      setNeedsPermanentPassword(false);
      toast.success("密码设置成功，以后可使用邮箱和密码登录");
      queryClient.invalidateQueries({ queryKey: ["emails", address] });
    } catch (error: any) {
      toast.error(error?.message || "密码设置失败");
    } finally {
      setIsSettingPermanentPassword(false);
    }
  };

  // 停止使用当前邮箱地址
  const handleStopAddress = () => {
    Cookies.remove("userMailbox");
    Cookies.remove("mailboxToken");
    // feat: 移除过期时间 cookie
    Cookies.remove("emailExpiry");
    Cookies.remove("permanentMailbox");
    Cookies.remove("permanentPasswordPending");
    setAddress(undefined);
    setIsPermanentMailbox(false);
    setNeedsPermanentPassword(false);
    setMailboxMode("temporary");
    setMailboxToken("");
    mailboxMetaSignatureRef.current = null;
    setHasReceivedEmail(false); // 重置状态
    setSelectedEmail(null); // 清除选中的邮件
    setExpiryTimestamp(undefined); // 清除过期时间状态
    queryClient.invalidateQueries({ queryKey: ["emails"] }); // 清理缓存
  };

  // feat: 手动刷新邮件
  const handleRefresh = () => {
    refetch();
    toast.success(t("Mailbox refreshed"));
  };

  // 修改：将延长邮箱有效期改为重置邮箱有效期
  const handleResetExpiry = useCallback(async () => {
    if (mailboxToken) {
      try {
        const refreshedToken = await refreshMailboxToken(mailboxToken);
        Cookies.set("mailboxToken", refreshedToken, { expires: 1 });
        setMailboxToken(refreshedToken);
      } catch {
        toast.error(t("SEND_UNAUTHORIZED"));
        return;
      }
    }

    // feat: 计算新的过期时间戳 (当前时间 + 24小时)
    const newExpiry = Date.now() + 24 * 60 * 60 * 1000;
    // 计算新的 Cookie 过期时间（相对于当前时间1天）
    const cookieExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    Cookies.set("emailExpiry", newExpiry.toString(), {
      expires: cookieExpires,
    }); // 更新 Cookie，有效期设为从现在起1天
    setExpiryTimestamp(newExpiry); // 更新状态
    toast.success(t("Validity reset successfully")); // 修改：显示重置成功提示
  }, [mailboxToken, t]);

  // 删除邮件的 useMutation hook
  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteEmails(ids, address, mailboxToken || undefined),
    onSuccess: () => {
      toast.success(t("Emails deleted successfully")); // feat: 使用全局 toast 提示
      setSelectedIds([]); // 清空选择
      if (selectedEmail && selectedIds.includes(selectedEmail.id)) {
        setSelectedEmail(null); // 如果删除的邮件是被选中的，则清除
      }
      queryClient.invalidateQueries({ queryKey: ["emails", address] }); // 刷新列表
    },
    onError: () => {
      toast.error(t("Failed to delete emails")); // feat: 使用全局 toast 提示
    },
  });

  // 定义 handleDeleteEmails 函数
  const handleDeleteEmails = (ids: string[]) => {
    if (ids.length === 0) {
      toast.error(t("Please select emails to delete"));
      return;
    }
    deleteMutation.mutate(ids);
  };

  // feat: 处理密码登录的函数
  // fix: 移除登录时的 turnstile token 校验逻辑
  const handleLogin = async (password: string) => {
    setIsLoggingIn(true);
    try {
      // fix: 调用更新后的 loginByPassword 函数，不再传递 token
      const data = await loginByPassword(password);
      // feat: 登录成功后也设置过期时间戳
      const now = Date.now();
      const expires = now + 24 * 60 * 60 * 1000;
      Cookies.set("userMailbox", data.address, { expires: 1 });
      Cookies.set("emailExpiry", expires.toString(), { expires: 1 });
      if (data.mailboxToken) {
        Cookies.set("mailboxToken", data.mailboxToken, { expires: 1 });
      } else {
        Cookies.remove("mailboxToken");
      }
      setAddress(data.address);
      setIsPermanentMailbox(false);
      setNeedsPermanentPassword(false);
      setMailboxMode("temporary");
      Cookies.remove("permanentMailbox");
      Cookies.remove("permanentPasswordPending");
      setMailboxToken(data.mailboxToken || "");
      setExpiryTimestamp(expires); // 更新状态
      setShowPasswordModal(false); // 关闭模态框
      toast.success(t("Login successful"));
    } catch (error: any) {
      // fix: 使用 i18n 翻译错误信息
      toast.error(`${t("Login failed")}: ${t(error.message)}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // feat: 获取密码（基于当前邮箱地址和 COOKIES_SECRET 加密）
  const getPassword = useCallback(() => {
    if (address && config.cookiesSecret) {
      return encrypt(address, config.cookiesSecret);
    }
    return null;
  }, [address, config.cookiesSecret]);

  // 新增：处理邮件选择
  const handleSelectEmail = (email: Email) => {
    setSelectedEmail(email);
  };

  // 新增：关闭邮件详情
  const handleCloseDetail = () => {
    setSelectedEmail(null);
  };

  // feat: 新增处理函数，用于在模态框中显示邮件
  const handleExpandEmail = () => {
    setShowEmailModal(true);
  };

  return (
    <main className="min-h-[calc(100vh-2rem)] w-full px-4 py-5 text-white md:px-8 md:py-8">
      <PasswordModal onLogin={handleLogin} isLoggingIn={isLoggingIn} />
      <SenderModal />
      {selectedEmail && (
        <InfoModal
          showModal={showEmailModal}
          setShowModal={setShowEmailModal}
          title={t("Email Detail")}
        >
          <MailDetail
            email={selectedEmail}
            onClose={() => setShowEmailModal(false)}
          />
        </InfoModal>
      )}
      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <section className="rounded-xl border border-white/10 bg-zinc-900/80 p-4 shadow-xl md:p-5">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-white">{isPermanentMailbox ? "固定邮箱" : "临时邮箱"}</h1>
              <p className="mt-1 text-sm text-zinc-400">
                {address ? "当前收件地址" : "创建一个收件地址"}
              </p>
            </div>
            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
          </div>

          {address ? (
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-sm font-medium text-zinc-300">
                  {t("Email address")}
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                    {address}
                  </span>
                  <CopyButton
                    text={address}
                    className="shrink-0 rounded-md p-1"
                  />
                </div>
              </div>
              {isPermanentMailbox && needsPermanentPassword && emails.length > 0 && (
                <div className="space-y-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3">
                  <div>
                    <div className="text-sm font-medium text-amber-100">已收到邮件</div>
                    <p className="mt-1 text-xs text-zinc-400">设置密码后，这个邮箱将固定保留，可随时登录查看历史邮件。</p>
                  </div>
                  <input
                    type="password"
                    value={permanentPassword}
                    onChange={(event) => setPermanentPassword(event.target.value)}
                    placeholder="设置自定义密码（至少 8 位）"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/60"
                  />
                  <button
                    type="button"
                    onClick={handleSetPermanentPassword}
                    disabled={isSettingPermanentPassword}
                    className="w-full rounded-lg bg-amber-300 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-200 disabled:opacity-60"
                  >
                    {isSettingPermanentPassword ? "正在设置..." : "保存密码"}
                  </button>
                </div>
              )}
              {expiryTimestamp && (
                <CountdownTimer
                  expiryTimestamp={expiryTimestamp}
                  onReset={handleResetExpiry}
                />
              )}
              <button
                type="button"
                onClick={handleStopAddress}
                className="w-full rounded-lg border border-rose-400/30 bg-rose-400/10 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-400/20"
              >
                {t("Stop")}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setMailboxMode("temporary")}
                  className={`rounded-md px-3 py-2 text-sm transition ${mailboxMode === "temporary" ? "bg-cyan-500 text-zinc-950" : "text-zinc-300 hover:bg-white/10"}`}
                >
                  临时邮箱
                </button>
                <button
                  type="button"
                  onClick={() => setMailboxMode("permanent")}
                  className={`rounded-md px-3 py-2 text-sm transition ${mailboxMode === "permanent" ? "bg-cyan-500 text-zinc-950" : "text-zinc-300 hover:bg-white/10"}`}
                >
                  固定邮箱
                </button>
              </div>
              {mailboxMode === "permanent" && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-zinc-300">邮箱名称</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={permanentLocalPart}
                      onChange={(event) => setPermanentLocalPart(event.target.value.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase())}
                      placeholder="例如：mycode"
                      maxLength={64}
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/60"
                    />
                    <span className="text-sm text-zinc-400">@{selectedDomain}</span>
                  </div>
                </div>
              )}
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  {t("Domain")}
                </label>
                <select
                  value={selectedDomain}
                  onChange={(e) => setSelectedDomain(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                >
                  {config.emailDomain.map((domain) => (
                    <option
                      key={domain}
                      value={domain}
                      className="bg-zinc-900 text-white"
                    >
                      @{domain}
                    </option>
                  ))}
                </select>
              </div>
              {config.turnstileEnabled && (
                <div>
                  <div className="mb-2 text-sm font-medium text-zinc-300">
                    {t("Validater")}
                  </div>
                  <div className="h-[65px] max-w-full overflow-hidden rounded-lg bg-zinc-800 [&_iframe]:!w-full">
                    <Turnstile
                      className="w-full border border-white/10"
                      siteKey={config.turnstileKey}
                      onSuccess={setTurnstileToken}
                      options={{ theme: "dark", size: "flexible" }}
                    />
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={mailboxMode === "permanent" ? handleCreatePermanentAddress : handleCreateAddress}
                disabled={
                  (config.turnstileEnabled && !turnstileToken) ||
                  isCreatingPermanent
                }
                className="w-full rounded-lg bg-cyan-500 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                {mailboxMode === "permanent"
                  ? isCreatingPermanent
                    ? "正在创建..."
                    : "创建固定邮箱"
                  : t("Create temporary email")}
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-2.5 text-sm text-cyan-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10"
                onClick={() => setShowPasswordModal(true)}
              >
                <PasswordIcon className="h-4 w-4" />
                {t("Have a password? Login.")}
              </button>
              <Link
                to="/mailbox-login"
                className="block text-center text-sm text-zinc-400 underline-offset-4 hover:text-cyan-300 hover:underline"
              >
                固定邮箱登录
              </Link>
            </div>
          )}
        </section>

        {/* 右侧邮件列表或邮件详情 */}
        {/* refactor: 始终渲染 MailList，并通过 selectedEmail prop 控制其内部显示逻辑 */}
        <section className="min-h-[32rem] min-w-0 overflow-hidden">
          <MailList
            isAddressCreated={!!address}
            emails={emails}
            isLoading={isLoading}
            isFetching={isFetching}
            onDelete={handleDeleteEmails}
            isDeleting={deleteMutation.isPending}
            onRefresh={handleRefresh} // feat: 传递新的刷新函数
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onSelectEmail={handleSelectEmail} // 传递选择邮件的函数
            // feat: 传递新状态和回调函数
            showViewPasswordButton={hasReceivedEmail}
            onShowPassword={() => {
              const password = getPassword();
              if (password) {
                showPasswordToast(password);
              }
            }}
            // feat: 传递当前选中的邮件和关闭详情页的回调
            selectedEmail={selectedEmail}
            onCloseDetail={handleCloseDetail}
            onExpand={handleExpandEmail} // feat: 传递展开邮件的回调
            canSendEmails={canSendEmails}
            onOpenSender={() => setShowSenderModal(true)} // 打开发件弹窗
          />
        </section>
      </div>
    </main>
  );
}
