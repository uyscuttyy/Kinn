/** Unlock — passphrase unlock existing Kinn wallet, then EIP-712 sign-in */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Unlock, Key } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, Text, TextSmall } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { showToast } from '@/components/Modal';
import { useKeyManager, useAuth } from '@/hooks/useApi';
import type { NetworkKey } from '@/types';

interface UnlockPageProps {
  networkKey: NetworkKey;
}

export function UnlockPage({ networkKey: _networkKey }: UnlockPageProps) {
  void _networkKey;
  const navigate = useNavigate();
  const { keys, unlock, signTypedData, getAddress, isLoading, error } = useKeyManager();
  const { startChallenge, completeChallenge } = useAuth();
  const [selectedId, setSelectedId] = useState<string>('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedId && keys.length > 0) setSelectedId(keys[0].id);
  }, [keys, selectedId]);

  const handleUnlock = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await unlock(selectedId, passphrase);
      const address = await getAddress(selectedId);
      const typed = await startChallenge(address);
      const sig = await signTypedData(
        selectedId,
        typed.domain as never,
        typed.types as never,
        typed.primaryType,
        typed.message as Record<string, unknown>
      );
      await completeChallenge(sig);
      showToast('Signed in', 'success');
      navigate('/vault');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unlock failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (keys.length === 0) {
    return (
      <Container size="narrow">
        <Stack gap={8} className="py-20">
          <Stack gap={3}>
            <Display>No wallets on this device.</Display>
            <TextLarge style={{ color: '#6B7B6E' }}>
              Wallets are encrypted on the device where they were created.
              Create a new one to get started.
            </TextLarge>
          </Stack>
          <Row gap={3}>
            <Button variant="primary" onClick={() => navigate('/create-wallet')}>
              Create a wallet
            </Button>
            <Button variant="ghost" onClick={() => navigate('/')}>
              Back home
            </Button>
          </Row>
        </Stack>
      </Container>
    );
  }

  return (
    <Container size="narrow">
      <Stack gap={8} className="py-20">
        <Stack gap={3}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: 'rgb(115 146 183 / 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-brand)',
            }}
          >
            <Unlock size={32} strokeWidth={1.5} />
          </div>
          <Display>Unlock your wallet.</Display>
          <TextLarge style={{ color: '#6B7B6E' }}>
            Enter your passphrase to decrypt and use the key on this device.
          </TextLarge>
        </Stack>

        <Card padding="lg">
          <Stack gap={5}>
            {keys.length > 1 ? (
              <Stack gap={2}>
                <span className="label">Select wallet</span>
                <Stack gap={2}>
                  {keys.map((k) => (
                    <button
                      key={k.id}
                      onClick={() => setSelectedId(k.id)}
                      className="btn"
                      style={{
                        backgroundColor: selectedId === k.id ? 'var(--color-muted)' : 'transparent',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-foreground)',
                        justifyContent: 'flex-start',
                        padding: 'var(--space-3) var(--space-4)',
                      }}
                    >
                      <Key size={16} color="var(--color-brand)" />
                      <span>{k.label ?? 'Unnamed wallet'}</span>
                      <TextSmall style={{ marginLeft: 'auto', color: '#6B7B6E' }}>
                        {new Date(k.createdAt * 1000).toLocaleDateString()}
                      </TextSmall>
                    </button>
                  ))}
                </Stack>
              </Stack>
            ) : (
              <Card padding="sm" variant="flat">
                <Row gap={2} align="center">
                  <Key size={16} color="var(--color-brand)" />
                  <Text style={{ fontWeight: 500 }}>
                    {keys[0].label ?? 'Unnamed wallet'}
                  </Text>
                </Row>
              </Card>
            )}

            <Input
              label="Passphrase"
              type="password"
              placeholder="Enter your passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUnlock();
              }}
              errorText={error ?? undefined}
            />

            <Row gap={3} justify="end">
              <Button variant="ghost" onClick={() => navigate('/')}>
                Cancel
              </Button>
              <Button
                variant="system"
                onClick={handleUnlock}
                loading={isLoading || busy}
                disabled={!passphrase || !selectedId}
              >
                {isLoading || busy ? 'Unlocking…' : 'Unlock'}
              </Button>
            </Row>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}