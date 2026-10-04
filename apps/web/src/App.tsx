import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { Route, Routes } from "react-router";
import { RequireAuth } from "./components/layout/RequireAuth";
import { ToastProvider } from "./components/ui/toast";
import { AccountPage } from "./pages/AccountPage";
import { AuthPage } from "./pages/AuthPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrgSettingsPage } from "./pages/OrgSettingsPage";
import { RatingsPage } from "./pages/RatingsPage";
import { ReportPage } from "./pages/ReportPage";

/** Providers and routes. The router itself is supplied by main.tsx (or a test). */
export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </QueryClientProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
      <Route path="/sign-up" element={<AuthPage mode="sign-up" />} />
      <Route element={<RequireAuth />}>
        <Route index element={<RatingsPage />} />
        <Route path="ratings/:id" element={<ReportPage />} />
        <Route path="workspace" element={<OrgSettingsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
