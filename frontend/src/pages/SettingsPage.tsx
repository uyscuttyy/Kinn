/** Settings — interval, max misses, reserve, close vault */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, AlertTriangle, Trash2 } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, TextSmall, Text, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card, LoadingState } from '@/components/Card';
import { Select, Input } from '@/components/Input';
import { ConfirmDialog, showToast } from '@/components/Modal';
import {
  useAuth,
  useVaultStatus,
  useUpdateSettings,
  useTopUpReserve,
  useWithdrawReserve,
  useCloseVault,
} from '@/hooks/useApi';
import { formatUnits } from '@/utils/format';
import type { NetworkKey } from '@/types';

interface SettingsPageProps {
  networkKey: NetworkKey;
}

const INTERVAL_OPTIONS = [
  { value: 3600, label: '1 hour (testing)' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '1 week' },
  { value: 2592000, label: '30 days' },
  { value: 7776000, label: '90 days' },
];

export function SettingsPage({ networkKey }: SettingsPageProps) {
  const navigate = useNavigate();
  const { wallet } = useAuth();
  const { data: status, isLoading } = useVaultStatus(wallet, networkKey);

  const [intervalSec, setIntervalSec] = useState(2592000);
  const [maxMissed, setMaxMissed] = useState(2);
  const [reserveAmount, setReserveAmount] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);

  useEffect(() => {
    if (status) {
      setIntervalSec(parseInt(status.checkInInterval));
      setMaxMissed(status.maxMissedCheckIns);
    }
  }, [status]);

  const updateSettingsMutation = useUpdateSettings(wallet ?? '', networkKey);
  const topUpMutation = useTopUpReserve(wallet ?? '', networkKey);
  const withdrawMutation = useWithdrawReserve(wallet ?? '', networkKey);
  const closeMutation = useCloseVault(wallet ?? '', networkKey);

  if (isLoading || !status) {
    return <LoadingState variant="page" message="Loading settings…" />;
  }

  const handleSaveSchedule = async () => {
    try {
      await updateSettingsMutation.mutateAsync({
        checkInInterval: intervalSec,
        maxMissedCheckIns: maxMissed,
      });
      showToast('Settings prepared. Sign the transaction.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update', 'error');
    }
  };

  const handleTopUp = async () => {
    if (!reserveAmount) return;
    try {
      const [intPart, fracPart = ''] = reserveAmount.split('.');
      const paddedFrac = fracPart.padEnd(18, '0').slice(0, 18);
      const weiAmount = BigInt(intPart + paddedFrac).toString();
      await topUpMutation.mutateAsync(weiAmount);
      showToast('Top-up prepared. Sign the transaction.', 'success');
      setReserveAmount('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Top-up failed', 'error');
    }
  };

  const handleWithdrawReserve = async () => {
    if (!reserveAmount) return;
    try {
      const [intPart, fracPart = ''] = reserveAmount.split('.');
      const paddedFrac = fracPart.padEnd(18, '0').slice(0, 18);
      const weiAmount = BigInt(intPart + paddedFrac).toString();
      await withdrawMutation.mutateAsync(weiAmount);
      showToast('Withdrawal prepared. Sign the transaction.', 'success');
      setReserveAmount('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Withdrawal failed', 'error');
    }
  };

  const handleClose = async () => {
    try {
      await closeMutation.mutateAsync();
      showToast('Vault close prepared. Sign the transaction.', 'success');
      navigate('/vault');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Close failed', 'error');
    }
  };

  return (
    <Container>
      <Stack gap={6} className="py-8">
        <Stack gap={2}>
          <Row gap={2} align="center">
            <SettingsIcon size={28} color="var(--color-brand)" />
            <Display>Settings</Display>
          </Row>
          <TextLarge style={{ color: '#6B7B6E' }}>
            Adjust your vault's check-in schedule, automation reserve, and
            danger-zone actions.
          </TextLarge>
        </Stack>

        {/* Schedule */}
        <Card padding="lg">
          <Stack gap={4}>
            <TextSmall style={{ color: '#6B7B6E', letterSpacing: '0.1em' }}>
              CHECK-IN SCHEDULE
            </TextSmall>

            <Row gap={4} wrap>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Select
                  label="Interval"
                  value={intervalSec}
                  onChange={(e) => setIntervalSec(parseInt(e.target.value))}
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Select
                  label="Max missed"
                  value={maxMissed}
                  onChange={(e) => setMaxMissed(parseInt(e.target.value))}
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
            </Row>

            <Row justify="end">
              <Button
                variant="primary"
                onClick={handleSaveSchedule}
                loading={updateSettingsMutation.isPending}
              >
                Save schedule
              </Button>
            </Row>
          </Stack>
        </Card>

        {/* Automation reserve */}
        <Card padding="lg">
          <Stack gap={4}>
            <TextSmall style={{ color: '#6B7B6E', letterSpacing: '0.1em' }}>
              AUTOMATION RESERVE
            </TextSmall>

            <Row gap={3} align="baseline">
              <Mono style={{ fontSize: '1.5rem' }}>{formatUnits(status.reserve, 18)} ETH</Mono>
              <TextSmall style={{ color: '#6B7B6E' }}>
                Funds keeper gas for inheritance execution and retries.
              </TextSmall>
            </Row>

            <Row gap={3} align="end" wrap>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Input
                  label="Amount"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.0"
                  value={reserveAmount}
                  onChange={(e) => setReserveAmount(e.target.value)}
                  suffix="ETH"
                />
              </div>
              <Row gap={2}>
                <Button
                  variant="secondary"
                  onClick={handleTopUp}
                  loading={topUpMutation.isPending}
                  disabled={!reserveAmount}
                >
                  Top up
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleWithdrawReserve}
                  loading={withdrawMutation.isPending}
                  disabled={!reserveAmount}
                >
                  Withdraw
                </Button>
              </Row>
            </Row>
          </Stack>
        </Card>

        {/* Danger zone */}
        <Card padding="lg" style={{ borderColor: 'var(--color-destructive)' }}>
          <Stack gap={4}>
            <Row gap={2} align="center">
              <AlertTriangle size={20} color="var(--color-destructive)" />
              <TextSmall style={{ color: 'var(--color-destructive)', letterSpacing: '0.1em' }}>
                DANGER ZONE
              </TextSmall>
            </Row>

            <Stack gap={2}>
              <Text>Close this vault</Text>
              <TextSmall style={{ color: '#6B7B6E' }}>
                Only possible when the vault is empty (no protected assets) and
                inheritance has not been triggered. The vault is permanently
                closed; you may create a new one.
              </TextSmall>
            </Stack>

            <Row justify="end">
              <Button variant="destructive" onClick={() => setCloseOpen(true)}>
                <Trash2 size={16} />
                Close vault
              </Button>
            </Row>
          </Stack>
        </Card>
      </Stack>

      <ConfirmDialog
        isOpen={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => {
          setCloseOpen(false);
          handleClose();
        }}
        title="Close this vault?"
        description="This is permanent. The vault will be closed and you can create a new one. Only works when the vault is empty."
        confirmText="Close vault"
        variant="destructive"
        loading={closeMutation.isPending}
      />
    </Container>
  );
}