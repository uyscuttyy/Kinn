/** Navigation — top bar with wallet account + state */

import { Link, NavLink, useLocation } from 'react-router-dom';
import { Shield, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth, useKeyManager } from '@/hooks/useApi';
import { Stack } from './Layout';
import { formatAddress } from '@/utils/format';
import { NETWORKS } from '@/lib/config';
import type { NetworkKey } from '@/types';

interface NavigationProps {
  networkKey: NetworkKey;
}

export function Navigation({ networkKey }: NavigationProps) {
  const { wallet, isAuthenticated, logout } = useAuth();
  const { unlockedKeyId, lockAll } = useKeyManager();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const network = NETWORKS[networkKey];
  const isActive = (path: string) => location.pathname === path;

  const navLinks = [
    { to: '/vault', label: 'Vault' },
    { to: '/vault/activity', label: 'Activity' },
    { to: '/security', label: 'Security' },
  ];

  return (
    <nav className="nav-bar">
      <div className="container">
        <div className="nav-content">
          <Link to={isAuthenticated ? '/vault' : '/'} className="nav-brand">
            <Shield className="nav-brand-icon" size={28} />
            <span>Kinn</span>
          </Link>

          {isAuthenticated && (
            <>
              {/* Desktop nav */}
              <div className="hidden md:flex items-center" style={{ gap: 'var(--space-6)' }}>
                {navLinks.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive: a }) =>
                      a ? 'text-body-sm' : 'text-body-sm'
                    }
                    style={{
                      color: isActive(link.to) ? 'var(--color-brand)' : 'var(--color-foreground)',
                      textDecoration: 'none',
                      fontWeight: isActive(link.to) ? 600 : 500,
                    }}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>

              {/* Mobile menu trigger */}
              <button
                className="btn-ghost md:hidden"
                onClick={() => setMobileOpen(!mobileOpen)}
                style={{ padding: 'var(--space-2)' }}
                aria-label="Menu"
              >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </>
          )}

          {!isAuthenticated && (
            <Link to="/unlock" className="btn btn-system btn-sm">
              Unlock wallet
            </Link>
          )}

          {isAuthenticated && wallet && (
            <div className="hidden md:flex items-center" style={{ gap: 'var(--space-3)' }}>
              {unlockedKeyId && (
                <span
                  className="badge badge-success"
                  style={{ fontSize: '0.65rem' }}
                >
                  Unlocked
                </span>
              )}
              <span className="text-body-sm" style={{ color: '#6B7B6E' }}>
                {network.name}
              </span>
              <div className="wallet-account">
                <span className="wallet-address">{formatAddress(wallet, 3)}</span>
                <button
                  onClick={async () => {
                    lockAll();
                    await logout();
                  }}
                  className="btn-ghost btn-sm"
                  style={{ fontSize: '0.7rem', padding: 'var(--space-1) var(--space-2)' }}
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile menu drawer */}
      {mobileOpen && isAuthenticated && (
        <div
          className="md:hidden"
          style={{
            borderTop: '1px solid var(--color-border)',
            padding: 'var(--space-4) 0',
            backgroundColor: 'var(--color-deep)',
          }}
        >
          <Stack gap={2} className="container">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                style={{
                  color: isActive(link.to) ? 'var(--color-brand)' : 'var(--color-foreground)',
                  textDecoration: 'none',
                  fontWeight: isActive(link.to) ? 600 : 500,
                  padding: 'var(--space-3) 0',
                }}
              >
                {link.label}
              </NavLink>
            ))}
            {wallet && (
              <div
                className="flex items-center justify-between"
                style={{
                  paddingTop: 'var(--space-3)',
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                <span className="text-body-sm text-mono">{formatAddress(wallet, 4)}</span>
                <button
                  onClick={async () => {
                    lockAll();
                    await logout();
                    setMobileOpen(false);
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  Sign out
                </button>
              </div>
            )}
          </Stack>
        </div>
      )}
    </nav>
  );
}