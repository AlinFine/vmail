import { Outlet } from "react-router-dom";
import { Toaster } from "react-hot-toast";

export function Layout() {
  return (
    <div className="min-h-screen bg-[#101214]">
      <Outlet />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#27272a",
            color: "#fff",
          },
        }}
      />
    </div>
  );
}
