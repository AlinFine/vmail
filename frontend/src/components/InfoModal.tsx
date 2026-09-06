import { Modal } from "./modal";
import Close from "./icons/Close";
import React from "react";

interface InfoModalProps {
  showModal: boolean;
  setShowModal: React.Dispatch<React.SetStateAction<boolean>>;
  title: string;
  children: React.ReactNode;
}

export function InfoModal({
  showModal,
  setShowModal,
  title,
  children,
}: InfoModalProps) {
  return (
    <Modal showModal={showModal} setShowModal={setShowModal} theme="light">
      <div className="flex max-h-[80vh] w-full flex-col bg-white shadow-xl md:max-w-3xl md:rounded-lg md:border md:border-zinc-200">
        {/* 修复：创建一个固定的头部，包含标题和关闭按钮，使其不随内容滚动 */}
        <div className="relative flex flex-shrink-0 items-center justify-center border-b border-zinc-200 p-4">
          <h3 className="font-display text-lg font-semibold text-zinc-950">
            {title}
          </h3>
          <Close
            className="absolute right-4 top-4 h-6 w-6 cursor-pointer text-zinc-500 transition hover:text-zinc-950"
            onClick={() => setShowModal(false)}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>

        {/* 修复：为内容区域添加 overflow-y-auto，使其可独立滚动 */}
        <div className="flex-grow overflow-y-auto p-6 text-zinc-950">
          <div>{children}</div>
        </div>
      </div>
    </Modal>
  );
}
