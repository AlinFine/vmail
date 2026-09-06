import { useTranslation } from "react-i18next";
import { format } from "date-fns/format";
import { zhCN } from "date-fns/locale";

// 导入图标
import UserCircleIcon from "../components/icons/UserCircleIcon.tsx";

import type { Email } from "../database_types"; // 导入 Email 类型

// 定义 MailDetail 组件的 props
interface MailDetailProps {
  email: Email;
  onClose: () => void; // 用于关闭详情视图的回调函数
}

export function MailDetail({ email, onClose }: MailDetailProps) {
  const { t } = useTranslation();

  return (
    // refactor: 移除外部的 p-2 gap-10，将其移到 MailList 中控制
    <div className="flex min-h-0 flex-1 flex-col text-zinc-950">
      {/* refactor: 移除返回按钮，它现在位于 MailList 的标题栏中 */}
      <div className="mb-5 flex items-start gap-4">
        <div className="flex items-start gap-4 text-sm">
          <div>
            <UserCircleIcon className="h-6 w-6 text-zinc-500" />
          </div>
          <div className="grid gap-1">
            <div className="font-semibold text-zinc-900">{email.from.name}</div>
            <div className="line-clamp-1 text-xs text-zinc-700">
              {email.subject}
            </div>
            <div className="line-clamp-1 text-xs text-zinc-500">
              <span className="font-medium">{t("Reply-To:")}</span>{" "}
              {email.from.address}
            </div>
          </div>
        </div>
        {email.date && (
          <div className="ml-auto shrink-0 text-xs text-zinc-500">
            {format(new Date(email.date), "PPpp", { locale: zhCN })}
          </div>
        )}
      </div>
      {/* fix: 调整 iframe 的容器和样式，以适应在 MailList 中显示 */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-200 bg-white text-sm">
        <iframe
          srcDoc={email.html || `<pre>${email.text}</pre>`}
          className="w-full h-[60vh] border-0"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          title="邮件内容"
        />
      </div>
    </div>
  );
}
