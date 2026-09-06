/** Vault Dashboard — state, deadline, assets, beneficiaries, quick actions */

import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Plus, ArrowUpRight, Settings, Activity } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, Headline, TextLarge, Text, TextSmall, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card, EmptyState, LoadingState } from '@/components/Card';
import { VaultStateBadge } from '@/components/Badge';
import { DeadlineIndicator } from '@/components/DeadlineIndicator';
import { useAuth, useVaultStatus, useBeneficiaries, useInheritanceInfo, useAssets, useCheckIn } from '@/hooks/useApi';
import { useSignTx } from '@/hooks/useSignTx';
import { formatAddress, formatUnits, formatDeadline, getStateDescription, isNativeEth, getAllocationWidth } from '@/utils/format';
import { NETWORKS } from '@/lib/config';
import type { NetworkKey } from '@/types';
import { showToast } from '@/components/Modal';

interface VaultDashboardPageProps {
  networkKey: NetworkKey;
}

export function VaultDashboardPage({ networkKey }: VaultDashboardPageProps) {
  const navigate = useNavigate();
  const { wallet } = useAuth();
  const network = NETWORKS[networkKey];

  const { data: status, isLoading: statusLoading } = useVaultStatus(wallet, networkKey);
  const { data: inheritance } = useInheritanceInfo(wallet, networkKey);
  const { data: beneficiaries, isLoading: beneficiariesLoading } = useBeneficiaries(wallet, networkKey);
  const { data: assetsData } = useAssets(networkKey);

  const checkInMutation = useCheckIn(wallet ?? '', networkKey);
  const signTx = useSignTx(networkKey);

  // If no vault exists, show create CTA
  if (!statusLoading && !status) {
    return (
      <Container>
        <Stack gap={8} className="py-12">
          <Stack gap={4}>
            <Display>Welcome to Kinn.</Display>
            <TextLarge style={{ color: 'var(--color-soft)', maxWidth: '600px' }}>
              You don't have a vault yet on {network.name}. Create one to start
              protecting your assets for inheritance.
            </TextLarge>
          </Stack>
          <Row gap={3}>
            <Button variant="primary" size="lg" onClick={() => navigate('/vault/create')}>
              Create a vault
            </Button>
          </Row>
        </Stack>
      </Container>
    );
  }

  if (statusLoading || !status) {
    return <LoadingState variant="page" message="Loading your vault…" />;
  }

  const state = status.state;
  const canCheckIn = state === 'Active' || state === 'Missed' || state === 'Eligible';
  const canDeposit = state === 'Active' || state === 'Missed';
  const canWithdraw = state === 'Active' || state === 'Missed' || state === 'Eligible';

  const handleCheckIn = async () => {
    if (!wallet) return;
    try {
      const result = await checkInMutation.mutateAsync();
      if (result.prepared) {
        const signed = await signTx.mutateAsync({ prepared: result.prepared, label: 'Check in' });
        showToast(`Check-in submitted: ${signed.hash.slice(0, 10)}…`, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Check-in failed', 'error');
    }
  };

  const lastCheckInDate = new Date(parseInt(status.lastCheckIn) * 1000).toLocaleDateString();
  const remaining = inheritance ? formatDeadline(inheritance.eligibilityDeadline).text : '—';
  const deadlineLabel =
    inheritance && inheritance.missedCheckIns > 0
      ? `Missed ${inheritance.missedCheckIns} of ${status.maxMissedCheckIns} check-in${inheritance.missedCheckIns > 1 ? 's' : ''}`
      : 'Time until eligibility';
  const summaryLine =
    state === 'Active'
      ? `Checked in ${lastCheckInDate}. Next check-in due before eligibility — ${remaining} left on the clock.`
      : state === 'Missed'
        ? `You missed ${inheritance?.missedCheckIns ?? 0} of ${status.maxMissedCheckIns} check-ins. Check in now to reset the clock — nothing is lost.`
        : state === 'Eligible'
          ? 'Inheritance can now be triggered by anyone. Check in immediately if you do not want this.'
          : state === 'Distributing'
            ? 'Inheritance was triggered. Assets are paying out to your beneficiaries — nothing left for you to do.'
            : state === 'Distributed'
              ? 'Every asset has been distributed. This vault is finished.'
              : 'This vault is closed. You can open a new one any time.';

  return (
    <Container>
      <Stack gap={8} className="py-8">
        {/* Vault Header */}
        <Stack gap={5}>
          <Row justify="between" align="start" wrap>
            <Stack gap={2}>
              <Row gap={3} align="center">
                <Headline>Your vault</Headline>
                <VaultStateBadge state={state} />
              </Row>
              <Text style={{ color: 'var(--color-soft)' }}>
                {getStateDescription(state)}
              </Text>
            </Stack>
            <Row gap={2}>
              <Button variant="secondary" onClick={() => navigate('/vault/activity')}>
                <Activity size={16} />
                Activity
              </Button>
              <Button variant="secondary" onClick={() => navigate('/vault/settings')}>
                <Settings size={16} />
                Settings
              </Button>
            </Row>
          </Row>
        </Stack>

        {/* State summary + caps */}
        <Stack gap={4}>
          <div className="band" style={{ borderRadius: 'var(--radius-lg)', borderLeft: 'none', borderRight: 'none' }}>
            <Stack gap={1} style={{ padding: 'var(--space-4) var(--space-5)' }}>
              <TextSmall style={{ color: 'var(--color-soft)', letterSpacing: '0.1em' }}>
                VAULT SUMMARY
              </TextSmall>
              <Text style={{ fontWeight: 500 }}>{summaryLine}</Text>
            </Stack>
          </div>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
          >
            <Card padding="md" className={state === 'Active' ? 'live-rail' : undefined}>
              <Stack gap={1}>
                <TextSmall style={{ color: 'var(--color-soft)', letterSpacing: '0.1em' }}>
                  STATUS
                </TextSmall>
                <VaultStateBadge state={state} />
                <TextSmall style={{ color: 'var(--color-soft)' }}>
                  Last check-in {new Date(parseInt(status.lastCheckIn) * 1000).toLocaleDateString()}
                </TextSmall>
              </Stack>
            </Card>

            <Card padding="md">
              <Stack gap={2}>
                <TextSmall style={{ color: 'var(--color-soft)', letterSpacing: '0.1em' }}>
                  TIME REMAINING
                </TextSmall>
                {inheritance ? (
                  <DeadlineIndicator
                    deadline={inheritance.eligibilityDeadline}
                    label={deadlineLabel}
                  />
                ) : (
                  <LoadingState message="Loading deadline…" />
                )}
              </Stack>
            </Card>

            <Card padding="md">
              <Stack gap={1}>
                <TextSmall style={{ color: 'var(--color-soft)', letterSpacing: '0.1em' }}>
                  BENEFICIARIES
                </TextSmall>
                <Text style={{ fontWeight: 600, fontSize: '1.5rem' }}>
                  {beneficiaries ? beneficiaries.beneficiaries.length : '—'}
                </Text>
                <TextSmall style={{ color: 'var(--color-soft)' }}>
                  {beneficiaries ? `${(beneficiaries.totalAllocationBps / 100).toFixed(0)}% allocated` : 'Loading…'}
                </TextSmall>
              </Stack>
            </Card>
          </div>

          {canCheckIn && (
            <Row gap={3} align="center" wrap>
              <Button
                variant="primary"
                size="lg"
                onClick={handleCheckIn}
                loading={checkInMutation.isPending || signTx.isPending}
              >
                <CheckCircle2 size={20} />
                Check in now
              </Button>
              <Button variant="ghost" onClick={() => navigate('/vault/check-in')}>
                Open check-in screen
              </Button>
            </Row>
          )}
        </Stack>

        {/* Assets + Beneficiaries + Quick Actions grid */}
        <div
          className="grid gap-5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}
        >
          {/* Assets */}
          <Card padding="lg">
            <Stack gap={4}>
              <Row justify="between" align="center">
                <Headline style={{ fontSize: '1.125rem' }}>Vault assets</Headline>
                {canDeposit && (
                  <Button variant="ghost" size="sm" onClick={() => navigate('/vault/deposit')}>
                    <Plus size={14} />
                    Deposit
                  </Button>
                )}
              </Row>

              {assetsData?.assets ? (
                <Stack gap={2}>
                  {assetsData?.assets?.map((asset) => {
                    const balance = status.balances?.[asset.address] ?? status.balances?.[asset.address.toLowerCase()] ?? '0';
                    const isEth = isNativeEth(asset);
                    return (
                      <div
                        key={asset.address}
                        className="asset-row"
                      >
                        <div className={`asset-icon ${isEth ? 'asset-icon-eth' : 'asset-icon-usdc'}`}>
                          <Text style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                            {asset.symbol}
                          </Text>
                        </div>
                        <div className="asset-info">
                          <div className="asset-symbol">{asset.symbol}</div>
                          <div className="asset-balance-sm">
                            {asset.symbol === 'ETH' ? 'Ether' : 'USD Coin'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="asset-balance">
                            {balance === '0' ? '0' : formatUnits(balance, asset.decimals)}
                          </div>
                          {canWithdraw && balance !== '0' && (
                            <button
                              onClick={() => navigate('/vault/withdraw', { state: { asset } })}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--color-primary)',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                padding: 0,
                                marginTop: 4,
                              }}
                            >
                              Withdraw
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </Stack>
              ) : (
                <LoadingState message="Loading assets…" />
              )}
            </Stack>
          </Card>

          {/* Beneficiaries */}
          <Card padding="lg">
            <Stack gap={4}>
              <Row justify="between" align="center">
                <Headline style={{ fontSize: '1.125rem' }}>Beneficiaries</Headline>
                {(state === 'Active' || state === 'Missed') && (
                  <Button variant="ghost" size="sm" onClick={() => navigate('/vault/beneficiaries')}>
                    Manage
                    <ArrowUpRight size={14} />
                  </Button>
                )}
              </Row>

              {beneficiariesLoading ? (
                <LoadingState message="Loading beneficiaries…" />
              ) : beneficiaries && beneficiaries.beneficiaries.length > 0 ? (
                <Stack gap={3}>
                  {beneficiaries.beneficiaries.slice(0, 3).map((b) => (
                    <div key={b.account} className="beneficiary-row">
                      <div className="beneficiary-avatar">
                        {(b.label ?? b.account).slice(0, 1).toUpperCase()}
                      </div>
                      <div className="beneficiary-info">
                        <Text style={{ fontWeight: 500 }}>
                          {b.label ?? formatAddress(b.account, 4)}
                        </Text>
                        {b.label && (
                          <TextSmall style={{ color: 'var(--color-soft)' }} className="text-mono">
                            {formatAddress(b.account, 4)}
                          </TextSmall>
                        )}
                      </div>
                      <div className="beneficiary-allocation">
                        <div className="allocation-bar">
                          <div
                            className="allocation-bar-fill"
                            style={{ width: `${getAllocationWidth(b.allocationBps)}%` }}
                          />
                        </div>
                        <Mono>{(b.allocationBps / 100).toFixed(0)}%</Mono>
                      </div>
                    </div>
                  ))}
                  {beneficiaries.beneficiaries.length > 3 && (
                    <TextSmall style={{ color: 'var(--color-soft)', textAlign: 'center' }}>
                      +{beneficiaries.beneficiaries.length - 3} more
                    </TextSmall>
                  )}
                </Stack>
              ) : (
                <EmptyState
                  title="No beneficiaries yet"
                  description="Add at least one beneficiary with an allocation."
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => navigate('/vault/beneficiaries')}
                    >
                      Add beneficiary
                    </Button>
                  }
                />
              )}
            </Stack>
          </Card>
        </div>
      </Stack>
    </Container>
  );
}