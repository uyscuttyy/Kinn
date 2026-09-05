/** Create Wallet — generate first-party KeyManager key */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Key } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, Text, TextSmall, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { useKeyManager } from '@/hooks/useApi';
import { showToast } from '@/components/Modal';

export function CreateWalletPage() {
  const navigate = useNavigate();
  const { generate, isLoading, error } = useKeyManager();
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [label, setLabel] = useState('');
  const [generatedAddress, setGeneratedAddress] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (passphrase.length < 8) {
      showToast('Passphrase must be at least 8 characters', 'error');
      return;
    }
    if (passphrase !== confirmPassphrase) {
      showToast('Passphrases do not match', 'error');
      return;
    }
    try {
      const result = await generate(passphrase, label || undefined);
      setGeneratedAddress(result.address);
      showToast('Wallet created successfully', 'success');
    } catch (err) {
      // error handled by hook
    }
  };

  if (generatedAddress) {
    return (
      <Container size="narrow">
        <Stack gap={8} className="py-20">
          <Stack gap={4} className="text-center">
            <div
              className="mx-auto"
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
              <Key size={32} strokeWidth={1.5} />
            </div>
            <Display>Your wallet is ready.</Display>
            <TextLarge style={{ color: '#6B7B6E' }}>
              Your address is below. The encrypted key is stored only on this device.
            </TextLarge>
          </Stack>

          <Card padding="lg">
            <Stack gap={4}>
              <TextSmall style={{ color: '#6B7B6E', letterSpacing: '0.1em' }}>
                WALLET ADDRESS
              </TextSmall>
              <Mono style={{ wordBreak: 'break-all', fontSize: '0.95rem' }}>
                {generatedAddress}
              </Mono>
            </Stack>
          </Card>

          <Card padding="md">
            <Stack gap={3}>
              <Row gap={2} align="center">
                <Shield size={16} color="var(--color-brand)" />
                <Text style={{ fontWeight: 600 }}>What happens next</Text>
              </Row>
              <TextSmall style={{ color: '#6B7B6E' }}>
                Your key is encrypted with your passphrase using AES-256-GCM
                (PBKDF2, 210,000 iterations). It lives only in your browser.
                Kinn never receives the key, the passphrase, or any way to
                decrypt your vault.
              </TextSmall>
            </Stack>
          </Card>

          <Row gap={3} justify="end">
            <Button
              variant="primary"
              size="lg"
              onClick={() => navigate('/vault/create')}
            >
              Create a vault
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
          <Display>Create your wallet.</Display>
          <TextLarge style={{ color: '#6B7B6E' }}>
            Kinn is the wallet. No MetaMask required. Your key is generated,
            encrypted, and stored only on this device.
          </TextLarge>
        </Stack>

        <Card padding="lg">
          <Stack gap={5}>
            <Input
              label="Wallet label (optional)"
              placeholder="e.g. My main vault"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
              helperText="A friendly name to help you recognize this wallet."
            />

            <Input
              label="Passphrase"
              type="password"
              placeholder="At least 8 characters"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
              helperText="Used to encrypt your key. Kinn never sees this."
            />

            <Input
              label="Confirm passphrase"
              type="password"
              placeholder="Type it again"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              autoComplete="new-password"
              errorText={
                confirmPassphrase && passphrase !== confirmPassphrase
                  ? 'Passphrases do not match'
                  : undefined
              }
            />

            {error && (
              <TextSmall style={{ color: 'var(--color-destructive)' }}>
                {error}
              </TextSmall>
            )}

            <Row gap={3} justify="end">
              <Button variant="ghost" onClick={() => navigate('/')}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleGenerate}
                loading={isLoading}
                disabled={passphrase.length < 8 || passphrase !== confirmPassphrase}
              >
                {isLoading ? 'Generating…' : 'Generate wallet'}
              </Button>
            </Row>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}