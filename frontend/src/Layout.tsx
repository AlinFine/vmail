import { Outlet } from "react-router-dom";
import { Toaster } from "react-hot-toast";

export function Layout() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <Outlet />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#ffffff",
            border: "1px solid #e4e4e7",
            color: "#18181b",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.08)",
          },
        }}
      />
    </div>
  );
}
