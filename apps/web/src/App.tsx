import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { RequireAuth } from "./components/layout/RequireAuth";
import { LoadingState } from "./components/states/states";
import { ToastProvider } from "./components/ui/toast";
import { NotFoundPage } from "./pages/NotFoundPage";

// Each page is its own chunk, fetched the first time it is visited, so the first load only
// carries the shell. <RequireAuth> shows a spinner inside the shell while a page loads.
const AuthPage = lazy(() =>
  import("./pages/AuthPage").then((module) => ({ default: module.AuthPage })),
);
const RatingsPage = lazy(() =>
  import("./pages/RatingsPage").then((module) => ({ default: module.RatingsPage })),
);
const ReportPage = lazy(() =>
  import("./pages/ReportPage").then((module) => ({ default: module.ReportPage })),
);
const ContractViewerPage = lazy(() =>
  import("./pages/ContractViewerPage").then((module) => ({
    default: module.ContractViewerPage,
  })),
);
const OrgSettingsPage = lazy(() =>
  import("./pages/OrgSettingsPage").then((module) => ({
    default: module.OrgSettingsPage,
  })),
);
const AccountPage = lazy(() =>
  import("./pages/AccountPage").then((module) => ({ default: module.AccountPage })),
);
const InvitePage = lazy(() =>
  import("./pages/InvitePage").then((module) => ({ default: module.InvitePage })),
);

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
    <Suspense fallback={<LoadingState className="min-h-dvh" />}>
      <Routes>
        <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
        <Route path="/sign-up" element={<AuthPage mode="sign-up" />} />
        <Route element={<RequireAuth />}>
          <Route index element={<RatingsPage />} />
          <Route path="ratings/:id" element={<ReportPage />} />
          <Route path="ratings/:id/contract" element={<ContractViewerPage />} />
          <Route path="workspace" element={<OrgSettingsPage />} />
          <Route path="account" element={<AccountPage />} />
          {/* The link from an invitation; signed-out visitors sign in first and come back. */}
          <Route path="invite/:id" element={<InvitePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
