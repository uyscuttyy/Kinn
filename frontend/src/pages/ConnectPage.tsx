/** Connect — browser wallet (MetaMask/Rabby) connect + EIP-712 sign-in */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, ShieldCheck, ArrowLeft } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, Text, TextSmall, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { showToast } from '@/components/Modal';
import { useAuth } from '@/hooks/useApi';
import { useExternalSigner } from '@/hooks/useExternalSigner';
import { NETWORKS } from '@/lib/config';
import type { NetworkKey } from '@/types';

interface ConnectPageProps {
  networkKey: NetworkKey;
}

export function ConnectPage({ networkKey }: ConnectPageProps) {
  const navigate = useNavigate();
  const { startChallenge, completeChallenge, isLoading: authLoading } = useAuth();
  const signer = useExternalSigner();
  const network = NETWORKS[networkKey];
  const [busy, setBusy] = useState(false);

  const switchChain = async () => {
    const w = window.ethereum;
    if (!w) return;
    const hexId = `0x${network.chainId.toString(16)}`;
    try {
      await w.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    } catch (err) {
      const e = err as { code?: number };
      if (e?.code === 4902) {
        try {
          await w.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: hexId,
              chainName: network.name,
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: [network.rpcUrl],
              blockExplorerUrls: [network.explorerUrl],
            }],
          });
        } catch (addErr) {
          showToast(addErr instanceof Error ? addErr.message : 'Failed to add network', 'error');
        }
      } else {
        showToast(err instanceof Error ? err.message : 'Failed to switch network', 'error');
      }
    }
  };

  const handleSignIn = async () => {
    if (!signer.address) return;
    setBusy(true);
    try {
      if (signer.chainId !== network.chainId) {
        showToast(`Switch to ${network.name} in your wallet first`, 'error');
        return;
      }
      const typed = await startChallenge(signer.address);
      const sig = await signer.signTypedData({
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      });
      await completeChallenge(sig);
      showToast('Signed in', 'success');
      navigate('/vault');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sign-in failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container size="narrow">
      <Stack gap={6} className="py-8">
        <Button variant="ghost" onClick={() => navigate('/')} style={{ alignSelf: 'flex-start' }}>
          <ArrowLeft size={16} />
          Back home
        </Button>

        <Stack gap={3} className="text-center items-center">
          <div
            style={{
              width: 64, height: 64, borderRadius: '50%',
              backgroundColor: 'rgb(64 86 244 / 0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-system)',
            }}
          >
            <Wallet size={32} strokeWidth={1.5} />
          </div>
          <Display>Connect your wallet.</Display>
          <TextLarge style={{ color: '#6B7B6E' }}>
            MetaMask, Rabby, or any injected browser wallet. You'll sign a login
            message — never a transaction, never a spend.
          </TextLarge>
        </Stack>

        {!signer.available ? (
          <Card padding="lg">
            <Stack gap={3} className="items-center text-center">
              <Text style={{ fontWeight: 600 }}>No browser wallet detected</Text>
              <TextSmall style={{ color: '#6B7B6E', maxWidth: 400 }}>
                Install MetaMask (or Rabby), then refresh this page. The first-party
                Kinn KeyManager is still in progress; the browser wallet is the
                supported signer for now.
              </TextSmall>
              <a className="btn btn-system" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
                Get MetaMask
              </a>
            </Stack>
          </Card>
        ) : (
          <Card padding="lg">
            <Stack gap={5}>
              {!signer.connected ? (
                <Stack gap={3} className="items-center text-center">
                  <Text style={{ fontWeight: 600 }}>Step 1 of 2 — connect</Text>
                  <TextSmall style={{ color: '#6B7B6E' }}>
                    Your address becomes your Kinn identity. One vault per address.
                  </TextSmall>
                  <Button variant="system" size="lg" onClick={() => signer.connect()} loading={signer.isConnecting}>
                    Connect {signer.kind === 'none' ? 'wallet' : signer.kind}
                  </Button>
                  {signer.error && (
                    <TextSmall style={{ color: 'var(--color-destructive)' }}>{signer.error}</TextSmall>
                  )}
                </Stack>
              ) : (
                <Stack gap={4}>
                  <Row justify="between" align="center" wrap>
                    <Stack gap={1}>
                      <TextSmall style={{ color: '#6B7B6E', letterSpacing: '0.1em' }}>CONNECTED</TextSmall>
                      <Mono style={{ wordBreak: 'break-all' }}>{signer.address}</Mono>
                    </Stack>
                    <Button variant="ghost" size="sm" onClick={() => signer.disconnect()}>Disconnect</Button>
                  </Row>

                  {signer.chainId !== network.chainId ? (
                    <Card padding="md" variant="outlined">
                      <Row justify="between" align="center" wrap>
                        <TextSmall style={{ color: 'var(--color-destructive)' }}>
                          Wrong network (chain {signer.chainId}). Kinn needs {network.name} ({network.chainId}).
                        </TextSmall>
                        <Button variant="secondary" size="sm" onClick={switchChain}>
                          Switch to {network.name}
                        </Button>
                      </Row>
                    </Card>
                  ) : (
                    <Row justify="between" align="center">
                      <TextSmall style={{ color: '#6B7B6E' }}>Network</TextSmall>
                      <span className="badge badge-success">{network.name}</span>
                    </Row>
                  )}

                  <Stack gap={3} className="items-center text-center">
                    <Text style={{ fontWeight: 600 }}>Step 2 of 2 — sign in</Text>
                    <TextSmall style={{ color: '#6B7B6E', maxWidth: 420 }}>
                      <ShieldCheck size={14} style={{ display: 'inline', verticalAlign: -2 }} />{' '}
                      A free off-chain signature proves you own this address. It cannot move funds.
                    </TextSmall>
                    <Button
                      variant="primary" size="lg" fullWidth
                      onClick={handleSignIn}
                      loading={busy || authLoading}
                      disabled={signer.chainId !== network.chainId}
                    >
                      Sign in with wallet
                    </Button>
                  </Stack>
                </Stack>
              )}
            </Stack>
          </Card>
        )}
      </Stack>
    </Container>
  );
}
