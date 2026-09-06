/** Create Vault — interval, max misses, beneficiaries */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Plus, Shield } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, Text, TextSmall, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input, Select } from '@/components/Input';
import { ConfirmDialog, showToast } from '@/components/Modal';
import { useCreateVault } from '@/hooks/useApi';
import { useSignTx } from '@/hooks/useSignTx';
import { useAuth } from '@/hooks/useApi';
import { isValidAddress, parseBps } from '@/utils/format';
import type { NetworkKey } from '@/types';

interface CreateVaultPageProps {
  networkKey: NetworkKey;
}

interface BeneficiaryDraft {
  account: string;
  allocationPct: string; // user-entered percentage (string for editing)
  label?: string;
}

const INTERVAL_OPTIONS = [
  { value: 3600, label: '1 hour (testing)' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '1 week' },
  { value: 1209600, label: '2 weeks' },
  { value: 2592000, label: '30 days' },
  { value: 7776000, label: '90 days' },
];

const MAX_MISSED_OPTIONS = [
  { value: 1, label: '1 (after 1 missed)' },
  { value: 2, label: '2 (after 2 missed)' },
  { value: 3, label: '3 (after 3 missed)' },
];

export function CreateVaultPage({ networkKey }: CreateVaultPageProps) {
  const navigate = useNavigate();
  const { wallet } = useAuth();
  const createVault = useCreateVault(networkKey);
  const signTx = useSignTx(networkKey);

  const [intervalSec, setIntervalSec] = useState(2592000); // 30 days default
  const [maxMissed, setMaxMissed] = useState(2);
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryDraft[]>([
    { account: '', allocationPct: '100' },
  ]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const totalPct = beneficiaries.reduce((sum, b) => sum + parseFloat(b.allocationPct || '0'), 0);
  const totalBps = beneficiaries.reduce((sum, b) => sum + parseBps(b.allocationPct || '0'), 0);

  const addBeneficiary = () => {
    setBeneficiaries([...beneficiaries, { account: '', allocationPct: '0' }]);
  };

  const removeBeneficiary = (index: number) => {
    setBeneficiaries(beneficiaries.filter((_, i) => i !== index));
  };

  const updateBeneficiary = (index: number, field: keyof BeneficiaryDraft, value: string) => {
    setBeneficiaries(
      beneficiaries.map((b, i) => (i === index ? { ...b, [field]: value } : b))
    );
  };

  const allValid =
    beneficiaries.length > 0 &&
    beneficiaries.every((b) => isValidAddress(b.account) && parseFloat(b.allocationPct) > 0) &&
    totalBps === 10000;

  const handleCreate = async () => {
    if (!wallet) {
      showToast('Unlock your wallet first', 'error');
      return;
    }
    if (!allValid) {
      showToast('Fix beneficiary errors before continuing', 'error');
      return;
    }
    try {
      const result = await createVault.mutateAsync({
        checkInInterval: intervalSec,
        maxMissedCheckIns: maxMissed,
        beneficiaries: beneficiaries.map((b) => ({
          account: b.account,
          allocationBps: parseBps(b.allocationPct),
        })),
      });
      if (result.prepared) {
        const signed = await signTx.mutateAsync({ prepared: result.prepared, label: 'Create vault' });
        showToast(`Vault creation submitted: ${signed.hash.slice(0, 10)}…`, 'success');
        navigate('/vault');
      } else {
        showToast('Vault created.', 'success');
        navigate('/vault');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create vault', 'error');
    }
  };

  return (
    <Container>
      <Stack gap={6} className="py-8">
        <Stack gap={2}>
          <Display>Create your vault</Display>
          <TextLarge style={{ color: '#6B7B6E' }}>
            Configure how inheritance activates. All values are stored on-chain and
            can be changed later (until inheritance is triggered).
          </TextLarge>
        </Stack>

        {/* Schedule */}
        <Card padding="lg">
          <Stack gap={5}>
            <Row gap={2} align="center">
              <Shield size={20} color="var(--color-brand)" />
              <Text style={{ fontWeight: 600, fontSize: '1.125rem' }}>Schedule</Text>
            </Row>

            <Row gap={4} wrap>
              <div style={{ flex: 1, minWidth: 220 }}>
                <Select
                  label="Check-in interval"
                  value={intervalSec}
                  onChange={(e) => setIntervalSec(parseInt(e.target.value))}
                  helperText="How often you need to check in to keep the vault active."
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div style={{ flex: 1, minWidth: 220 }}>
                <Select
                  label="Max missed check-ins"
                  value={maxMissed}
                  onChange={(e) => setMaxMissed(parseInt(e.target.value))}
                  helperText="Inheritance becomes eligible after this many missed periods."
                >
                  {MAX_MISSED_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
            </Row>

            <Card padding="sm" variant="outlined">
              <TextSmall style={{ color: '#6B7B6E' }}>
                You must check in at least once every{' '}
                <TextSmall style={{ color: 'var(--color-foreground)' }}>
                  {INTERVAL_OPTIONS.find((o) => o.value === intervalSec)?.label.toLowerCase()}
                </TextSmall>
                . If you miss{' '}
                <TextSmall style={{ color: 'var(--color-foreground)' }}>
                  {maxMissed}
                </TextSmall>{' '}
                consecutive check-ins, your vault becomes eligible for inheritance.
                You can always check in early to reset the timer.
              </TextSmall>
            </Card>
          </Stack>
        </Card>

        {/* Beneficiaries */}
        <Card padding="lg">
          <Stack gap={5}>
            <Row justify="between" align="center">
              <Stack gap={1}>
                <Text style={{ fontWeight: 600, fontSize: '1.125rem' }}>Beneficiaries</Text>
                <TextSmall style={{ color: '#6B7B6E' }}>
                  Allocations must sum to exactly 100% (10000 basis points).
                </TextSmall>
              </Stack>
              <Button variant="secondary" size="sm" onClick={addBeneficiary}>
                <Plus size={14} />
                Add
              </Button>
            </Row>

            <Stack gap={3}>
              {beneficiaries.map((b, i) => {
                const validAddr = isValidAddress(b.account);
                const validPct = parseFloat(b.allocationPct) > 0;
                return (
                  <Row key={i} gap={3} align="start">
                    <div style={{ flex: 1 }}>
                      <Input
                        placeholder="0x..."
                        value={b.account}
                        onChange={(e) => updateBeneficiary(i, 'account', e.target.value)}
                        errorText={
                          b.account && !validAddr
                            ? 'Invalid Ethereum address'
                            : undefined
                        }
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Input
                        placeholder="Label (optional)"
                        value={b.label ?? ''}
                        onChange={(e) => updateBeneficiary(i, 'label', e.target.value)}
                      />
                    </div>
                    <div style={{ width: 100 }}>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="%"
                        value={b.allocationPct}
                        onChange={(e) => updateBeneficiary(i, 'allocationPct', e.target.value)}
                        suffix="%"
                        errorText={
                          b.allocationPct && !validPct ? 'Must be > 0' : undefined
                        }
                      />
                    </div>
                    {beneficiaries.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeBeneficiary(i)}
                        style={{ marginTop: 1 }}
                        aria-label="Remove beneficiary"
                      >
                        <Trash2 size={16} color="var(--color-destructive)" />
                      </Button>
                    )}
                  </Row>
                );
              })}
            </Stack>

            <Row justify="between" align="center">
              <TextSmall style={{ color: '#6B7B6E' }}>
                Total allocation
              </TextSmall>
              <Mono
                style={{
                  color: totalBps === 10000 ? 'var(--color-brand)' : 'var(--color-destructive)',
                  fontWeight: 600,
                }}
              >
                {totalPct.toFixed(2)}% / 100.00%
              </Mono>
            </Row>

            {totalBps !== 10000 && totalBps > 0 && (
              <TextSmall style={{ color: 'var(--color-destructive)' }}>
                Allocations must sum to exactly 100% (currently {totalBps / 100}%)
              </TextSmall>
            )}
          </Stack>
        </Card>

        {/* Actions */}
        <Row gap={3} justify="end">
          <Button variant="ghost" onClick={() => navigate('/vault')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={!allValid}
            loading={createVault.isPending || signTx.isPending}
          >
            Create vault
          </Button>
        </Row>
      </Stack>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          handleCreate();
        }}
        title="Create this vault?"
        description="Once created, the vault will be deployed to the chain. You'll need to sign a transaction to complete setup."
        confirmText="Create and sign"
      />
    </Container>
  );
}