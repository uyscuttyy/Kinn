/** Deposit — asset + amount + sign */

import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowDownToLine } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, TextSmall, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card, LoadingState } from '@/components/Card';
import { Select, Input } from '@/components/Input';
import { showToast } from '@/components/Modal';
import { useAuth, useAssets, useVaultStatus, useApproveToken, useDeposit } from '@/hooks/useApi';
import { formatUnits, isNativeEth } from '@/utils/format';
import type { NetworkKey, Asset } from '@/types';

interface DepositPageProps {
  networkKey: NetworkKey;
}

export function DepositPage({ networkKey }: DepositPageProps) {
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

  const approveMutation = useApproveToken(wallet ?? '', networkKey);
  const depositMutation = useDeposit(wallet ?? '', networkKey);

  const currentBalance = selectedAsset
    ? status?.balances?.[selectedAsset.address] ??
      status?.balances?.[selectedAsset.address.toLowerCase()] ??
      '0'
    : '0';

  const handleDeposit = async () => {
    if (!selectedAsset || !amount) return;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }

    try {
      // Convert amount to wei (BigInt-safe)
      const [intPart, fracPart = ''] = amount.split('.');
      const paddedFrac = fracPart.padEnd(selectedAsset.decimals, '0').slice(0, selectedAsset.decimals);
      const weiAmount = BigInt(intPart + paddedFrac).toString();

      if (!isNativeEth(selectedAsset)) {
        // ERC-20: need approve first
        showToast('Approving token spending…', 'info');
        const approveResult = await approveMutation.mutateAsync({
          token: selectedAsset.address,
          amount: weiAmount,
        });
        showToast('Approved. Preparing deposit…', 'info');
        // In production, would sign + broadcast the approve, then continue
        console.log('Approve prepared:', approveResult);
      }

      const depositResult = await depositMutation.mutateAsync({
        asset: selectedAsset.address,
        amount: weiAmount,
      });
      showToast('Deposit prepared. Sign with your KeyManager to broadcast.', 'success');
      console.log('Deposit prepared:', depositResult);
      navigate('/vault');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Deposit failed', 'error');
    }
  };

  if (!assetsData) {
    return <LoadingState variant="page" message="Loading…" />;
  }

  return (
    <Container size="narrow">
      <Stack gap={6} className="py-8">
        <Stack gap={2}>
          <Row gap={2} align="center">
            <ArrowDownToLine size={28} color="var(--color-brand)" />
            <Display>Deposit</Display>
          </Row>
          <TextLarge style={{ color: '#6B7B6E' }}>
            Move assets into your vault. Funds are protected by the smart contract
            and will be distributed to beneficiaries if you stop checking in.
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
                  helperText={`Current vault balance: ${formatUnits(currentBalance, selectedAsset.decimals)} ${selectedAsset.symbol}`}
                />

                {parseFloat(amount) > 0 && (
                  <Card padding="sm" variant="outlined">
                    <Stack gap={2}>
                      <Row justify="between">
                        <TextSmall style={{ color: '#6B7B6E' }}>You will deposit</TextSmall>
                        <Mono>{amount} {selectedAsset.symbol}</Mono>
                      </Row>
                      {!isNativeEth(selectedAsset) && (
                        <TextSmall style={{ color: '#6B7B6E' }}>
                          This requires an approval transaction first, then a deposit
                          transaction. Both will be signed by your wallet.
                        </TextSmall>
                      )}
                    </Stack>
                  </Card>
                )}
              </>
            )}

            <Row gap={3} justify="end">
              <Button variant="ghost" onClick={() => navigate('/vault')}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleDeposit}
                loading={approveMutation.isPending || depositMutation.isPending}
                disabled={!selectedAsset || !amount || parseFloat(amount) <= 0}
              >
                Prepare deposit
              </Button>
            </Row>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}