import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n.ts"; // 导入 i18n 配置以进行初始化

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <React.Suspense fallback="加载中...">
      <App />
    </React.Suspense>
  </React.StrictMode>,
);
