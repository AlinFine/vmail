import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import clsx from "clsx";
import { Link } from "react-router-dom";
// refactor: 将导入从 'database' 包更改为本地的类型定义文件
import type { Email } from "../database_types";

// 图标导入
import MailIcon from "./icons/MailIcon.tsx";
import RefreshIcon from "./icons/RefreshIcon.tsx";
import Loader from "./icons/Loader.tsx";
import { TrashIcon } from "./icons/TrashIcon.tsx";
// feat: 导入新组件
import { MailDetail } from "../pages/MailDetail.tsx";
import ArrowUturnLeft from "./icons/ArrowUturnLeft.tsx";
import Expand from "./icons/Expand.tsx"; // feat: 导入 Expand 图标
import SendIcon from "./icons/SendIcon.tsx";

interface MailListProps {
  emails: Email[];
  isLoading: boolean;
  isFetching: boolean;
  onDelete: (ids: string[]) => void;
  isDeleting: boolean;
  onRefresh: () => void;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  isAddressCreated: boolean;
  onSelectEmail: (email: Email) => void;
  // feat: 新增 props，用于接收当前选中的邮件和关闭详情页的回调
  selectedEmail: Email | null;
  onCloseDetail: () => void;
  onExpand: () => void; // feat: 新增 onExpand 回调
  canSendEmails: boolean;
  onOpenSender: () => void; // 打开发件弹窗
  errorMessage?: string;
  requiresLogin?: boolean;
}

export function MailList({
  emails,
  isLoading,
  isFetching,
  onDelete,
  isDeleting,
  onRefresh,
  selectedIds,
  setSelectedIds,
  isAddressCreated,
  onSelectEmail,
  selectedEmail,
  onCloseDetail,
  onExpand,
  canSendEmails,
  onOpenSender,
  errorMessage,
  requiresLogin,
}: MailListProps) {
  const { t } = useTranslation();

  const handleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const handleSelectAll = () => {
    if (emails.length === 0) return;
    if (selectedIds.length === emails.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(emails.map((e) => e.id));
    }
  };

  const renderBody = () => {
    // feat: 如果有选中的邮件，则渲染邮件详情
    if (selectedEmail) {
      return <MailDetail email={selectedEmail} onClose={onCloseDetail} />;
    }

    // 未创建地址时只显示下一步提示，避免在核心工作区混入推广信息。
    if (!isAddressCreated) {
      return (
        <div className="flex h-full min-h-80 w-full flex-col items-center justify-center gap-3 text-center">
          <MailIcon className="h-10 w-10 text-zinc-300" />
          <p className="text-sm text-zinc-500">
            {t("Please create a temporary email address first")}
          </p>
        </div>
      );
    }

    if (errorMessage) {
      return (
        <div className="flex h-full min-h-80 w-full flex-col items-center justify-center gap-3 px-6 text-center">
          <MailIcon className="h-10 w-10 text-rose-500" />
          <p className="text-sm text-rose-600">{errorMessage}</p>
          {requiresLogin && (
            <Link
              to="/mailbox-login"
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              重新登录邮箱
            </Link>
          )}
        </div>
      );
    }

    // 状态 2: 正在进行首次加载
    if (isLoading) {
      return (
        <div className="w-full items-center h-full flex-col justify-center flex">
          <Loader />
          <p className="mt-6 text-sm text-zinc-500">
            {t("Waiting for emails...")}
          </p>
        </div>
      );
    }

    // 状态 3: 收件箱为空
    if (emails.length === 0) {
      return (
        <div className="w-full items-center h-full flex-col justify-center flex">
          {/* 修复: 只要地址已创建且邮箱为空，就持续显示加载动画 */}
          <Loader />
          <p className="mt-6 text-sm text-zinc-500">
            {t("Waiting for emails...")}
          </p>
        </div>
      );
    }

    // 状态 4: 显示邮件列表
    return emails.map((email: Email) => (
      <div key={email.id} className="mb-2 flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-zinc-950"
          checked={selectedIds.includes(email.id)}
          onChange={() => handleSelect(email.id)}
        />
        <div
          onClick={() => onSelectEmail(email)}
          className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-left text-sm transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          <div className="flex w-full flex-col gap-1">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                {/* feat: 在用户名后显示邮箱地址 */}
                <div className="truncate font-semibold text-zinc-900">
                  {email.from?.name || email.messageFrom}{" "}
                  {email.from?.address && `(${email.from.address})`}
                </div>
              </div>
              <div className="shrink-0 whitespace-nowrap text-xs text-zinc-500">
                {formatDistanceToNow(new Date(email.date || email.createdAt), {
                  addSuffix: true,
                  locale: zhCN,
                })}
              </div>
            </div>
            <div className="truncate text-xs font-medium text-zinc-700">
              {email.subject}
            </div>
          </div>
          <div className="line-clamp-2 w-full text-xs font-normal text-zinc-500">
            {(email.text || email.html || "").substring(0, 300)}
          </div>
        </div>
      </div>
    ));
  };

  return (
    <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-950 shadow-sm lg:h-[calc(100vh-4rem)] lg:max-h-[44rem]">
      {/* 邮件列表头部 */}
      <div className="flex h-12 w-full shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 text-zinc-900">
        <div className="flex min-w-0 items-center justify-start gap-2 font-semibold">
          <MailIcon className="size-5" />
          {t("INBOX")}
          {isAddressCreated && emails.length > 0 && !selectedEmail && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-200 px-1 text-xs font-semibold text-zinc-700">
              {emails.length}
            </span>
          )}
          {/* feat: 在详情页模式下，显示返回按钮 */}
          {selectedEmail && (
            <button
              onClick={onCloseDetail}
              className="ml-1 flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 hover:text-zinc-950"
            >
              <ArrowUturnLeft />
              {t("Return to email list")}
            </button>
          )}
        </div>

        {/* 操作按钮区域 */}
        <div className="ml-auto flex items-center gap-2">
          {/* feat: 详情页模式下的操作按钮 */}
          {selectedEmail ? (
            <>
              <button
                onClick={onExpand}
                className="rounded-md p-1.5 text-zinc-700 transition hover:bg-zinc-200 hover:text-zinc-950"
                title={t("Expand")}
              >
                <Expand className="w-5 h-5" />
              </button>
              <button
                onClick={() => onDelete([selectedEmail.id])}
                disabled={isDeleting}
                className="rounded-md p-1.5 text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-zinc-300"
                title={t("Delete")}
              >
                <TrashIcon className="w-5 h-5" />
              </button>
            </>
          ) : (
            <>
              {/* 列表页模式下的操作按钮 */}
              {canSendEmails && (
                <button
                  className="rounded-md p-1.5 text-zinc-700 transition hover:bg-zinc-200 hover:text-zinc-950"
                  title={t("Send email")}
                  onClick={onOpenSender}
                >
                  <SendIcon className="w-5 h-5" />
                </button>
              )}
              {isAddressCreated && emails.length > 0 && (
                <>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-zinc-950"
                    title="全选"
                    checked={
                      selectedIds.length === emails.length && emails.length > 0
                    }
                    onChange={handleSelectAll}
                  />
                  <button
                    onClick={() => onDelete(selectedIds)}
                    disabled={selectedIds.length === 0 || isDeleting}
                    className="rounded-md p-1.5 text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-zinc-300"
                    title="删除选中"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                </>
              )}
              <button
                className="rounded-md p-1.5 text-zinc-700 transition hover:bg-zinc-200 hover:text-zinc-950 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
                title={t("Refresh")}
                onClick={onRefresh} // feat: 添加手动刷新事件
                // fix: 只有在创建地址后，刷新按钮才可用, 且在加载中时禁用
                disabled={!isAddressCreated || isFetching}
              >
                <RefreshIcon
                  className={clsx("size-5", isFetching && "animate-spin")}
                />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 邮件列表主体 */}
      {/* fix: 当显示详情时，移除 grids 背景和 h-[488px] 的高度限制 */}
      <div
        className={clsx(
          "flex min-h-0 flex-1 flex-col overflow-y-auto p-3",
          !selectedEmail && "grids",
        )}
      >
        {renderBody()}
      </div>
    </div>
  );
}
