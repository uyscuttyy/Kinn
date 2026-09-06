/** Beneficiaries — view + edit list, must sum to 10000 bps */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Users } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, TextSmall, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card, LoadingState } from '@/components/Card';
import { Input } from '@/components/Input';
import { ConfirmDialog, showToast } from '@/components/Modal';
import { useAuth, useBeneficiaries, useUpdateBeneficiaries } from '@/hooks/useApi';
import { useSignTx } from '@/hooks/useSignTx';
import { isValidAddress, parseBps, getAllocationWidth } from '@/utils/format';
import type { NetworkKey } from '@/types';

interface BeneficiariesPageProps {
  networkKey: NetworkKey;
}

interface BeneficiaryDraft {
  account: string;
  allocationPct: string;
  label?: string;
}

export function BeneficiariesPage({ networkKey }: BeneficiariesPageProps) {
  const navigate = useNavigate();
  const { wallet } = useAuth();
  const { data: existing, isLoading } = useBeneficiaries(wallet, networkKey);
  const updateMutation = useUpdateBeneficiaries(wallet ?? '', networkKey);
  const signTx = useSignTx(networkKey);

  const [drafts, setDrafts] = useState<BeneficiaryDraft[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (existing?.beneficiaries) {
      setDrafts(
        existing.beneficiaries.map((b) => ({
          account: b.account,
          allocationPct: (b.allocationBps / 100).toString(),
          label: b.label,
        }))
      );
    }
  }, [existing]);

  const totalBps = drafts.reduce((sum, d) => sum + parseBps(d.allocationPct || '0'), 0);
  const totalPct = totalBps / 100;

  const allValid =
    drafts.length > 0 &&
    drafts.every((d) => isValidAddress(d.account) && parseFloat(d.allocationPct) > 0) &&
    totalBps === 10000;

  const addDraft = () => {
    setDrafts([...drafts, { account: '', allocationPct: '0' }]);
  };

  const removeDraft = (i: number) => {
    setDrafts(drafts.filter((_, idx) => idx !== i));
  };

  const updateDraft = (i: number, field: keyof BeneficiaryDraft, value: string) => {
    setDrafts(drafts.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  };

  const handleSave = async () => {
    if (!allValid) {
      showToast('Fix errors before saving', 'error');
      return;
    }
    try {
      const result = await updateMutation.mutateAsync({
        accounts: drafts.map((d) => d.account),
        allocationBps: drafts.map((d) => parseBps(d.allocationPct)),
      });
      if (result.prepared) {
        const signed = await signTx.mutateAsync({ prepared: result.prepared, label: 'Update beneficiaries' });
        showToast(`Beneficiaries update submitted: ${signed.hash.slice(0, 10)}…`, 'success');
        navigate('/vault');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  if (isLoading) {
    return <LoadingState variant="page" message="Loading beneficiaries…" />;
  }

  return (
    <Container>
      <Stack gap={6} className="py-8">
        <Row gap={2} align="center" justify="between" wrap>
          <Stack gap={2}>
            <Row gap={2} align="center">
              <Users size={28} color="var(--color-brand)" />
              <Display>Beneficiaries</Display>
            </Row>
            <TextLarge style={{ color: '#6B7B6E' }}>
              The contract enforces that all allocations sum to exactly 100%.
            </TextLarge>
          </Stack>
          <Button variant="secondary" onClick={addDraft}>
            <Plus size={14} />
            Add
          </Button>
        </Row>

        <Card padding="lg">
          <Stack gap={4}>
            {drafts.length === 0 ? (
              <Stack gap={3} className="items-center py-8">
                <TextSmall style={{ color: '#6B7B6E' }}>
                  No beneficiaries yet. Add at least one.
                </TextSmall>
                <Button variant="primary" onClick={addDraft}>
                  <Plus size={14} />
                  Add first beneficiary
                </Button>
              </Stack>
            ) : (
              <Stack gap={3}>
                {drafts.map((d, i) => {
                  const validAddr = isValidAddress(d.account);
                  const validPct = parseFloat(d.allocationPct) > 0;
                  return (
                    <Row key={i} gap={3} align="start" wrap>
                      <div className="beneficiary-avatar" style={{ width: 40, height: 40, flexShrink: 0 }}>
                        {(d.label || d.account || '?').slice(0, 1).toUpperCase()}
                      </div>
                      <div style={{ flex: '1 1 200px' }}>
                        <Input
                          placeholder="0x..."
                          value={d.account}
                          onChange={(e) => updateDraft(i, 'account', e.target.value)}
                          errorText={d.account && !validAddr ? 'Invalid address' : undefined}
                        />
                      </div>
                      <div style={{ flex: '1 1 150px' }}>
                        <Input
                          placeholder="Label (optional)"
                          value={d.label ?? ''}
                          onChange={(e) => updateDraft(i, 'label', e.target.value)}
                        />
                      </div>
                      <div style={{ flex: '0 0 100px' }}>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="%"
                          value={d.allocationPct}
                          onChange={(e) => updateDraft(i, 'allocationPct', e.target.value)}
                          suffix="%"
                          errorText={d.allocationPct && !validPct ? '> 0' : undefined}
                        />
                      </div>
                      <div style={{ width: 80, alignSelf: 'center' }}>
                        <div className="allocation-bar" style={{ marginBottom: 4 }}>
                          <div
                            className="allocation-bar-fill"
                            style={{ width: `${getAllocationWidth(parseBps(d.allocationPct || '0'))}%` }}
                          />
                        </div>
                        <Mono style={{ fontSize: '0.75rem' }}>
                          {parseFloat(d.allocationPct || '0').toFixed(1)}%
                        </Mono>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDraft(i)}
                        style={{ marginTop: 1 }}
                        aria-label="Remove"
                      >
                        <Trash2 size={16} color="var(--color-destructive)" />
                      </Button>
                    </Row>
                  );
                })}
              </Stack>
            )}

            {drafts.length > 0 && (
              <Row justify="between" align="center" className="pt-2">
                <TextSmall style={{ color: '#6B7B6E' }}>Total allocation</TextSmall>
                <Mono
                  style={{
                    color: totalBps === 10000 ? 'var(--color-brand)' : 'var(--color-destructive)',
                    fontWeight: 600,
                  }}
                >
                  {totalPct.toFixed(2)}% / 100.00%
                </Mono>
              </Row>
            )}

            {totalBps !== 10000 && totalBps > 0 && (
              <TextSmall style={{ color: 'var(--color-destructive)' }}>
                Allocations must sum to exactly 100% (currently {totalPct}%)
              </TextSmall>
            )}
          </Stack>
        </Card>

        <Row gap={3} justify="end">
          <Button variant="ghost" onClick={() => navigate('/vault')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={!allValid}
            loading={updateMutation.isPending || signTx.isPending}
          >
            Save changes
          </Button>
        </Row>
      </Stack>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          handleSave();
        }}
        title="Update beneficiaries?"
        description="Replaces the entire beneficiary list. You'll sign the transaction in your connected wallet."
        confirmText="Update and sign"
      />
    </Container>
  );
}