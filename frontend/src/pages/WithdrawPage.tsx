/** Withdraw — pre-trigger only */

import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowUpFromLine } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, TextSmall, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card, LoadingState } from '@/components/Card';
import { Select, Input } from '@/components/Input';
import { showToast } from '@/components/Modal';
import { useAuth, useAssets, useVaultStatus, useWithdraw } from '@/hooks/useApi';
import { useSignTx } from '@/hooks/useSignTx';
import { formatUnits } from '@/utils/format';
import type { NetworkKey, Asset } from '@/types';

interface WithdrawPageProps {
  networkKey: NetworkKey;
}

export function WithdrawPage({ networkKey }: WithdrawPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { wallet } = useAuth();
  const { data: assetsData } = useAssets(networkKey);
  const { data: status } = useVaultStatus(wallet, networkKey);

  const preselectedAsset = (location.state as { asset?: Asset })?.asset;
  const [selectedSymbol, setSelectedSymbol] = useState<string>(
    preselectedAsset?.symbol ?? assetsData?.assets?.[0]?.symbol ?? 'ETH'
  );
  const [amount, setAmount] = useState('');

  const assets = useMemo(() => assetsData?.assets ?? [], [assetsData]);
  const selectedAsset = assets.find((a) => a.symbol === selectedSymbol);

  const withdrawMutation = useWithdraw(wallet ?? '', networkKey);
  const signTx = useSignTx(networkKey);

  const currentBalance = selectedAsset
    ? status?.balances?.[selectedAsset.address] ??
      status?.balances?.[selectedAsset.address.toLowerCase()] ??
      '0'
    : '0';

  const canWithdraw = status?.state === 'Active' || status?.state === 'Missed' || status?.state === 'Eligible';

  const handleWithdraw = async () => {
    if (!selectedAsset || !amount) return;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }

    try {
      const [intPart, fracPart = ''] = amount.split('.');
      const paddedFrac = fracPart.padEnd(selectedAsset.decimals, '0').slice(0, selectedAsset.decimals);
      const weiAmount = BigInt(intPart + paddedFrac).toString();

      const result = await withdrawMutation.mutateAsync({
        asset: selectedAsset.address,
        amount: weiAmount,
      });
      if (result.prepared) {
        const signed = await signTx.mutateAsync({ prepared: result.prepared, label: 'Withdraw' });
        showToast(`Withdrawal submitted: ${signed.hash.slice(0, 10)}…`, 'success');
        navigate('/vault');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Withdrawal failed', 'error');
    }
  };

  if (!assetsData) {
    return <LoadingState variant="page" message="Loading…" />;
  }

  if (status && !canWithdraw) {
    return (
      <Container size="narrow">
        <Stack gap={6} className="py-8">
          <Display>Withdrawal unavailable</Display>
          <Card padding="lg">
            <Stack gap={3}>
              <TextLarge>
                Withdrawals are disabled because your vault is in{' '}
                <strong>{status.state}</strong> state.
              </TextLarge>
              <TextSmall style={{ color: 'var(--color-soft)' }}>
                Once inheritance has been triggered, all vault assets are
                frozen and distributed to beneficiaries. This is irreversible.
              </TextSmall>
            </Stack>
          </Card>
          <Row gap={3}>
            <Button variant="secondary" onClick={() => navigate('/vault')}>
              Back to vault
            </Button>
          </Row>
        </Stack>
      </Container>
    );
  }

  return (
    <Container size="narrow">
      <Stack gap={6} className="py-8">
        <Stack gap={2}>
          <Row gap={2} align="center">
            <ArrowUpFromLine size={28} color="var(--color-alert)" />
            <Display>Withdraw</Display>
          </Row>
          <TextLarge style={{ color: 'var(--color-soft)' }}>
            Move assets from your vault back to your wallet. Only available
            before inheritance is triggered.
          </TextLarge>
        </Stack>

        <Card padding="lg">
          <Stack gap={5}>
            <Select
              label="Asset"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
            >
              {assets.map((a) => (
                <option key={a.address} value={a.symbol}>
                  {a.symbol} — {a.native ? 'native' : 'ERC-20'}
                </option>
              ))}
            </Select>

            {selectedAsset && (
              <>
                <Input
                  label="Amount"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  suffix={selectedAsset.symbol}
                  helperText={`Available: ${formatUnits(currentBalance, selectedAsset.decimals)} ${selectedAsset.symbol}`}
                />

                {parseFloat(amount) > 0 && (
                  <Card padding="sm" variant="outlined">
                    <Row justify="between">
                      <TextSmall style={{ color: 'var(--color-soft)' }}>You will withdraw</TextSmall>
                      <Mono>{amount} {selectedAsset.symbol}</Mono>
                    </Row>
                  </Card>
                )}
              </>
            )}

            <Row gap={3} justify="end">
              <Button variant="ghost" onClick={() => navigate('/vault')}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleWithdraw}
                loading={withdrawMutation.isPending || signTx.isPending}
                disabled={!selectedAsset || !amount || parseFloat(amount) <= 0}
              >
                Withdraw
              </Button>
            </Row>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}