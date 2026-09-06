/** Check-In — dedicated one-tap check-in screen, mobile-first */

import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ArrowLeft } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, Text, TextSmall } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card, LoadingState } from '@/components/Card';
import { DeadlineIndicator } from '@/components/DeadlineIndicator';
import { VaultStateBadge } from '@/components/Badge';
import { useAuth, useVaultStatus, useInheritanceInfo, useCheckIn } from '@/hooks/useApi';
import { useSignTx } from '@/hooks/useSignTx';
import { formatTimestamp } from '@/utils/format';
import { showToast } from '@/components/Modal';
import type { NetworkKey } from '@/types';

interface CheckInPageProps {
  networkKey: NetworkKey;
}

export function CheckInPage({ networkKey }: CheckInPageProps) {
  const navigate = useNavigate();
  const { wallet } = useAuth();
  const { data: status, isLoading: statusLoading } = useVaultStatus(wallet, networkKey);
  const { data: inheritance } = useInheritanceInfo(wallet, networkKey);
  const checkInMutation = useCheckIn(wallet ?? '', networkKey);
  const signTx = useSignTx(networkKey);

  if (statusLoading || !status) {
    return <LoadingState variant="page" message="Loading…" />;
  }

  const state = status.state;
  const canCheckIn = state === 'Active' || state === 'Missed' || state === 'Eligible';

  const handleCheckIn = async () => {
    try {
      const result = await checkInMutation.mutateAsync();
      if (result.prepared) {
        const signed = await signTx.mutateAsync({ prepared: result.prepared, label: 'Check in' });
        showToast(`Check-in submitted: ${signed.hash.slice(0, 10)}…`, 'success');
        navigate('/vault');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Check-in failed', 'error');
    }
  };

  return (
    <Container size="narrow">
      <Stack gap={6} className="py-8">
        <Button
          variant="ghost"
          onClick={() => navigate('/vault')}
          style={{ alignSelf: 'flex-start' }}
        >
          <ArrowLeft size={16} />
          Back to vault
        </Button>

        <Stack gap={3} className="text-center">
          <Display>Check in</Display>
          <TextLarge style={{ color: 'var(--color-soft)' }}>
            Reset the dead-man switch. Your vault's clock starts over.
          </TextLarge>
        </Stack>

        {/* Big status card */}
        <Card padding="lg">
          <Stack gap={6}>
            <Row justify="between" align="center" wrap>
              <Stack gap={1}>
                <TextSmall style={{ color: 'var(--color-soft)', letterSpacing: '0.1em' }}>
                  CURRENT STATE
                </TextSmall>
                <VaultStateBadge state={state} />
              </Stack>
              {inheritance && inheritance.missedCheckIns > 0 && (
                <Stack gap={1}>
                  <TextSmall style={{ color: 'var(--color-destructive)' }}>
                    {inheritance.missedCheckIns} of {status.maxMissedCheckIns} missed
                  </TextSmall>
                </Stack>
              )}
            </Row>

            {inheritance && (
              <DeadlineIndicator
                deadline={inheritance.eligibilityDeadline}
                label="Time until eligibility"
              />
            )}

            <Stack gap={1}>
              <TextSmall style={{ color: 'var(--color-soft)' }}>Last check-in</TextSmall>
              <Text>{formatTimestamp(status.lastCheckIn)}</Text>
            </Stack>
          </Stack>
        </Card>

        {/* Big CTA */}
        <Card padding="lg" style={{ backgroundColor: 'rgb(64 86 244 / 0.08)' }}>
          <Stack gap={4} className="items-center text-center">
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                backgroundColor: 'rgb(64 86 244 / 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-primary)',
              }}
            >
              <CheckCircle2 size={40} strokeWidth={1.5} />
            </div>

            <Stack gap={2}>
              <Text style={{ fontWeight: 600, fontSize: '1.25rem' }}>
                {canCheckIn ? 'Ready to check in' : 'Check-in not available'}
              </Text>
              <TextSmall style={{ color: 'var(--color-soft)', maxWidth: 360 }}>
                {canCheckIn
                  ? 'A check-in is a single transaction. The vault contract records the new timestamp.'
                  : `Your vault is in ${state} state. Check-in is not available at this time.`}
              </TextSmall>
            </Stack>

            {canCheckIn && (
              <Button
                variant="primary"
                size="lg"
                onClick={handleCheckIn}
                loading={checkInMutation.isPending || signTx.isPending}
                fullWidth
              >
                Check in now
              </Button>
            )}
          </Stack>
        </Card>

        <Card padding="md" variant="outlined">
          <Stack gap={2}>
            <TextSmall style={{ color: 'var(--color-soft)', letterSpacing: '0.1em' }}>
              HOW CHECK-INS WORK
            </TextSmall>
            <TextSmall style={{ color: 'var(--color-soft)' }}>
              Every check-in resets the vault's clock to "now." Miss{' '}
              <TextSmall style={{ color: 'var(--color-foreground)' }}>
                {status.maxMissedCheckIns}
              </TextSmall>{' '}
              consecutive check-ins and your vault becomes eligible for inheritance.
              You can check in any time, even early — there's no penalty.
            </TextSmall>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}