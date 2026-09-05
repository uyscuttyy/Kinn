/** Security — wallet list, lock controls, fallback wallets */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock, Unlock, Trash2, ExternalLink } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, Text, TextSmall, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card, EmptyState } from '@/components/Card';
import { Input } from '@/components/Input';
import { ConfirmDialog, showToast } from '@/components/Modal';
import { useAuth, useKeyManager } from '@/hooks/useApi';
import { formatAddress, copyToClipboard } from '@/utils/format';
import { NETWORKS } from '@/lib/config';
import type { NetworkKey } from '@/types';

interface SecurityPageProps {
  networkKey: NetworkKey;
}

export function SecurityPage({ networkKey }: SecurityPageProps) {
  const navigate = useNavigate();
  const { wallet, logout } = useAuth();
  const { keys, unlockedKeyId, unlock, lock, lockAll, destroy } = useKeyManager();
  const [unlockId, setUnlockId] = useState<string | null>(null);
  const [unlockPassphrase, setUnlockPassphrase] = useState('');
  const [destroyId, setDestroyId] = useState<string | null>(null);
  const network = NETWORKS[networkKey];

  const handleUnlock = async (id: string) => {
    try {
      await unlock(id, unlockPassphrase);
      setUnlockId(null);
      setUnlockPassphrase('');
      showToast('Wallet unlocked', 'success');
    } catch {
      // error handled
    }
  };

  const handleDestroy = async (id: string) => {
    try {
      await destroy(id);
      setDestroyId(null);
      showToast('Wallet destroyed', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to destroy', 'error');
    }
  };

  return (
    <Container>
      <Stack gap={6} className="py-8">
        <Stack gap={2}>
          <Row gap={2} align="center">
            <Shield size={28} color="var(--color-brand)" />
            <Display>Security</Display>
          </Row>
          <TextLarge style={{ color: '#6B7B6E' }}>
            Manage your KeyManager wallets, session locks, and connection settings.
          </TextLarge>
        </Stack>

        {/* Connected wallet */}
        {wallet && (
          <Card padding="lg">
            <Stack gap={4}>
              <TextSmall style={{ color: '#6B7B6E', letterSpacing: '0.1em' }}>
                CURRENT SESSION
              </TextSmall>
              <Row justify="between" align="center" wrap>
                <Stack gap={1}>
                  <Text style={{ fontWeight: 500 }}>Signed in as</Text>
                  <Mono>{formatAddress(wallet, 6)}</Mono>
                </Stack>
                <Button variant="secondary" onClick={() => logout()}>
                  Sign out
                </Button>
              </Row>
            </Stack>
          </Card>
        )}

        {/* KeyManager wallets */}
        <Card padding="lg">
          <Stack gap={4}>
            <Row justify="between" align="center">
              <TextSmall style={{ color: '#6B7B6E', letterSpacing: '0.1em' }}>
                KEYMANAGER WALLETS
              </TextSmall>
              <Button variant="secondary" size="sm" onClick={() => navigate('/create-wallet')}>
                + New wallet
              </Button>
            </Row>

            {keys.length === 0 ? (
              <EmptyState
                title="No KeyManager wallets"
                description="Create a first-party wallet to sign vault transactions directly — no MetaMask required."
                action={
                  <Button variant="primary" onClick={() => navigate('/create-wallet')}>
                    Create wallet
                  </Button>
                }
              />
            ) : (
              <Stack gap={3}>
                {keys.map((k) => {
                  const isUnlocked = unlockedKeyId === k.id;
                  return (
                    <Card key={k.id} padding="md" variant="outlined">
                      <Row justify="between" align="center" wrap>
                        <Stack gap={1}>
                          <Row gap={2} align="center">
                            <Text style={{ fontWeight: 500 }}>
                              {k.label ?? 'Unnamed wallet'}
                            </Text>
                            {isUnlocked ? (
                              <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>
                                Unlocked
                              </span>
                            ) : (
                              <span className="badge badge-closed" style={{ fontSize: '0.65rem' }}>
                                Locked
                              </span>
                            )}
                          </Row>
                          <TextSmall style={{ color: '#6B7B6E' }}>
                            Created {new Date(k.createdAt * 1000).toLocaleDateString()}
                          </TextSmall>
                        </Stack>
                        <Row gap={2}>
                          {!isUnlocked ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setUnlockId(k.id);
                                setUnlockPassphrase('');
                              }}
                            >
                              <Unlock size={14} />
                              Unlock
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => lock(k.id)}
                            >
                              <Lock size={14} />
                              Lock
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDestroyId(k.id)}
                          >
                            <Trash2 size={14} color="var(--color-destructive)" />
                          </Button>
                        </Row>
                      </Row>
                    </Card>
                  );
                })}

                {unlockedKeyId && (
                  <Row justify="end">
                    <Button variant="ghost" size="sm" onClick={() => lockAll()}>
                      Lock all
                    </Button>
                  </Row>
                )}
              </Stack>
            )}
          </Stack>
        </Card>

        {/* Fallback wallets */}
        <Card padding="lg">
          <Stack gap={4}>
            <TextSmall style={{ color: '#6B7B6E', letterSpacing: '0.1em' }}>
              FALLBACK WALLETS
            </TextSmall>

              <Row gap={3} align="center" justify="between" wrap>
                <Stack gap={1}>
                  <Text style={{ fontWeight: 500 }}>MetaMask</Text>
                  <TextSmall style={{ color: '#6B7B6E' }}>
                    Browser extension. Use if your browser has it installed.
                  </TextSmall>
                </Stack>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => showToast('MetaMask integration requires a browser extension', 'info')}
                >
                  <ExternalLink size={14} />
                  Connect
                </Button>
              </Row>

              <Row gap={3} align="center" justify="between" wrap>
                <Stack gap={1}>
                  <Text style={{ fontWeight: 500 }}>WalletConnect</Text>
                  <TextSmall style={{ color: '#6B7B6E' }}>
                    Connect mobile wallets via QR code.
                  </TextSmall>
                </Stack>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => showToast('WalletConnect requires a project ID', 'info')}
                >
                  <ExternalLink size={14} />
                  Connect
                </Button>
              </Row>
            </Stack>
        </Card>

        {/* Vault contract info */}
        <Card padding="lg">
          <Stack gap={3}>
            <TextSmall style={{ color: '#6B7B6E', letterSpacing: '0.1em' }}>
              VAULT FACTORY
            </TextSmall>
            <Row justify="between" align="center" wrap>
              <Stack gap={1}>
                <Mono>{network.factoryAddress}</Mono>
                <TextSmall style={{ color: '#6B7B6E' }}>{network.name}</TextSmall>
              </Stack>
              <Row gap={2}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(network.factoryAddress)}
                >
                  Copy
                </Button>
                <a
                  href={`${network.explorerUrl}/address/${network.factoryAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  <ExternalLink size={14} />
                  Explorer
                </a>
              </Row>
            </Row>
          </Stack>
        </Card>
      </Stack>

      {/* Unlock dialog */}
      {unlockId && (
        <ConfirmDialog
          isOpen={!!unlockId}
          onClose={() => {
            setUnlockId(null);
            setUnlockPassphrase('');
          }}
          onConfirm={() => handleUnlock(unlockId)}
          title="Unlock wallet"
          description=""
          confirmText="Unlock"
        >
          <Input
            label="Passphrase"
            type="password"
            value={unlockPassphrase}
            onChange={(e) => setUnlockPassphrase(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </ConfirmDialog>
      )}

      {/* Destroy confirm */}
      <ConfirmDialog
        isOpen={!!destroyId}
        onClose={() => setDestroyId(null)}
        onConfirm={() => destroyId && handleDestroy(destroyId)}
        title="Destroy this wallet?"
        description="This permanently removes the encrypted key from this device. If you haven't backed up your key elsewhere, you will lose access to any vault owned by this wallet."
        confirmText="Destroy"
        variant="destructive"
      />
    </Container>
  );
}