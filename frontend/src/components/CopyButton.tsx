import { useState, useEffect } from "react";
import clsx from "clsx";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
// 关键修正：为图标导入添加 .tsx 扩展名
import CheckIcon from "./icons/CheckIcon.tsx";
import CopyIcon from "./icons/CopyIcon.tsx";

interface CopyButtonProps {
  text: string;
  className?: string; // 允许传入 className
}

function copyWithTextArea(text: string): boolean {
  const textArea = document.createElement("textarea");
  const activeElement = document.activeElement as HTMLElement | null;

  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
    activeElement?.focus();
  }
  return copied;
}

async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Some desktop browsers expose the API but block it by permission.
    }
  }

  return copyWithTextArea(text);
}

export function CopyButton({ text, className }: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const { t } = useTranslation(); // feat: 引入 i18n

  const handleCopy = async () => {
    try {
      const copied = await copyText(text);
      if (!copied) {
        throw new Error("The browser rejected the copy command");
      }
      setIsCopied(true);
      toast.success(t("Copied to clipboard")); // feat: 使用全局 toast 提示
    } catch (err) {
      console.error("复制文本失败: ", err);
      toast.error("复制失败，请手动复制邮箱地址");
    }
  };

  // 复制成功后，2秒后重置图标状态
  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => {
        setIsCopied(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      // 使用 clsx 合并基础样式和传入的 className
      className={clsx(
        // fix: 彻底移除浏览器在按钮聚焦时默认添加的边框/轮廓
        "focus:outline-none focus-visible:outline-none",
        className,
      )}
      aria-label="复制到剪贴板"
      title="复制邮箱地址"
    >
      {isCopied ? (
        <CheckIcon className="h-5 w-5 text-green-500" />
      ) : (
        <CopyIcon className="h-5 w-5 text-gray-400" />
      )}
    </button>
  );
}
