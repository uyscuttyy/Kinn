/** App router — wires all pages with auth + query client */

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, queryClient } from '@/hooks/AuthContext';
import { useAuth } from '@/hooks/useApi';
import { Navigation } from '@/components/Navigation';
import { ToastContainer } from '@/components/Modal';

import { LandingPage } from '@/pages/LandingPage';
import { ConnectPage } from '@/pages/ConnectPage';
import { CreateWalletPage } from '@/pages/CreateWalletPage';
import { UnlockPage } from '@/pages/UnlockPage';
import { VaultDashboardPage } from '@/pages/VaultDashboardPage';
import { CreateVaultPage } from '@/pages/CreateVaultPage';
import { CheckInPage } from '@/pages/CheckInPage';
import { DepositPage } from '@/pages/DepositPage';
import { WithdrawPage } from '@/pages/WithdrawPage';
import { BeneficiariesPage } from '@/pages/BeneficiariesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ActivityPage } from '@/pages/ActivityPage';
import { SecurityPage } from '@/pages/SecurityPage';

import { DEFAULT_NETWORK } from '@/lib/config';
import type { NetworkKey } from '@/types';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode; networkKey: NetworkKey }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <Navigation networkKey={DEFAULT_NETWORK} />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/connect" element={<ConnectPage networkKey={DEFAULT_NETWORK} />} />
        <Route path="/create-wallet" element={<CreateWalletPage />} />
        <Route path="/unlock" element={<UnlockPage />} />

        <Route
          path="/vault"
          element={
            <ProtectedRoute networkKey={DEFAULT_NETWORK}>
              <VaultDashboardPage networkKey={DEFAULT_NETWORK} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vault/create"
          element={
            <ProtectedRoute networkKey={DEFAULT_NETWORK}>
              <CreateVaultPage networkKey={DEFAULT_NETWORK} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vault/check-in"
          element={
            <ProtectedRoute networkKey={DEFAULT_NETWORK}>
              <CheckInPage networkKey={DEFAULT_NETWORK} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vault/deposit"
          element={
            <ProtectedRoute networkKey={DEFAULT_NETWORK}>
              <DepositPage networkKey={DEFAULT_NETWORK} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vault/withdraw"
          element={
            <ProtectedRoute networkKey={DEFAULT_NETWORK}>
              <WithdrawPage networkKey={DEFAULT_NETWORK} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vault/beneficiaries"
          element={
            <ProtectedRoute networkKey={DEFAULT_NETWORK}>
              <BeneficiariesPage networkKey={DEFAULT_NETWORK} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vault/settings"
          element={
            <ProtectedRoute networkKey={DEFAULT_NETWORK}>
              <SettingsPage networkKey={DEFAULT_NETWORK} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vault/activity"
          element={
            <ProtectedRoute networkKey={DEFAULT_NETWORK}>
              <ActivityPage networkKey={DEFAULT_NETWORK} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/security"
          element={
            <ProtectedRoute networkKey={DEFAULT_NETWORK}>
              <SecurityPage networkKey={DEFAULT_NETWORK} />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider networkKey={DEFAULT_NETWORK}>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;