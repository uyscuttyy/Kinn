/** Unlock — passphrase unlock existing wallet */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Unlock, Key } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, Text, TextSmall } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { useKeyManager } from '@/hooks/useApi';

export function UnlockPage() {
  const navigate = useNavigate();
  const { keys, unlock, isLoading, error } = useKeyManager();
  const [selectedId, setSelectedId] = useState<string>(keys[0]?.id ?? '');
  const [passphrase, setPassphrase] = useState('');

  const handleUnlock = async () => {
    if (!selectedId) {
      return;
    }
    try {
      await unlock(selectedId, passphrase);
      navigate('/vault');
    } catch {
      // error handled by hook
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
                loading={isLoading}
                disabled={!passphrase || !selectedId}
              >
                {isLoading ? 'Unlocking…' : 'Unlock'}
              </Button>
            </Row>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}