/** Activity — full indexed event timeline */

import { Activity, ArrowDownToLine, ArrowUpFromLine, Users, CheckCircle2, Shield } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, Text, TextSmall } from '@/components/Typography';
import { EmptyState, LoadingState } from '@/components/Card';
import { useAuth, useVaultActivity } from '@/hooks/useApi';
import { formatAddress } from '@/utils/format';
import { NETWORKS } from '@/lib/config';
import type { NetworkKey, VaultActivityEvent } from '@/types';

interface ActivityPageProps {
  networkKey: NetworkKey;
}

export function ActivityPage({ networkKey }: ActivityPageProps) {
  const { wallet } = useAuth();
  const network = NETWORKS[networkKey];
  const { data, isLoading } = useVaultActivity(wallet, networkKey);

  if (isLoading) {
    return <LoadingState variant="page" message="Loading activity…" />;
  }

  const events = data?.events ?? [];

  return (
    <Container>
      <Stack gap={6} className="py-8">
        <Stack gap={2}>
          <Row gap={2} align="center">
            <Activity size={28} color="var(--color-primary)" />
            <Display>Activity</Display>
          </Row>
          <TextLarge style={{ color: 'var(--color-soft)' }}>
            Every state change for your vault, indexed from chain events.
          </TextLarge>
        </Stack>

        {events.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Once you create your vault and make your first transaction, all events will appear here."
          />
        ) : (
          <div className="ctable-wrap">
            <table className="ctable">
              <colgroup>
                <col style={{ width: '220px' }} />
                <col />
                <col className="hide-mobile" style={{ width: '110px' }} />
                <col style={{ width: '150px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Detail</th>
                  <th className="hide-mobile num">Block</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, i) => (
                  <ActivityRow
                    key={`${event.txHash}-${i}`}
                    event={event}
                    explorerUrl={network.explorerUrl}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Stack>
    </Container>
  );
}

function ActivityRow({ event, explorerUrl }: { event: VaultActivityEvent; explorerUrl: string }) {
  const { icon, label, color, details } = getEventDisplay(event);

  return (
    <tr>
      <td>
        <Row gap={2} align="center">
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              backgroundColor: `${color}20`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color,
              flexShrink: 0,
            }}
          >
            {icon}
          </span>
          <Text style={{ fontWeight: 500 }}>{label}</Text>
        </Row>
      </td>
      <td>
        <TextSmall style={{ color: 'var(--color-soft)' }}>
          {details ?? (event.timestamp > 0 ? new Date(event.timestamp * 1000).toLocaleString() : '—')}
        </TextSmall>
      </td>
      <td className="hide-mobile num">{event.blockNumber}</td>
      <td>
        <a
          href={`${explorerUrl}/tx/${event.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-mono"
          style={{ color: 'var(--color-primary)', textDecoration: 'none', fontSize: '0.75rem' }}
        >
          {formatAddress(event.txHash, 6)} ↗
        </a>
      </td>
    </tr>
  );
}

function getEventDisplay(event: VaultActivityEvent): {
  icon: React.ReactNode;
  label: string;
  color: string;
  details?: string;
} {
  const iconSize = 16;
  switch (event.type) {
    case 'VaultCreated':
      return {
        icon: <Shield size={iconSize} />,
        label: 'Vault created',
        color: 'var(--color-primary)',
        details: event.data?.vaultAddress ? `Address: ${formatAddress(event.data.vaultAddress as string, 4)}` : undefined,
      };
    case 'AssetDeposited':
      return {
        icon: <ArrowDownToLine size={iconSize} />,
        label: 'Deposit',
        color: 'var(--color-primary)',
        details: event.data?.amount ? `${event.data.amount} ${event.data.token ?? ''}` : undefined,
      };
    case 'AssetWithdrawn':
      return {
        icon: <ArrowUpFromLine size={iconSize} />,
        label: 'Withdrawal',
        color: 'var(--color-alert)',
        details: event.data?.amount ? `${event.data.amount} ${event.data.token ?? ''}` : undefined,
      };
    case 'BeneficiariesUpdated':
      return {
        icon: <Users size={iconSize} />,
        label: 'Beneficiaries updated',
        color: 'var(--color-system)',
        details: Array.isArray(event.data?.accounts) ? `${event.data.accounts.length} beneficiaries` : undefined,
      };
    case 'CheckedIn':
      return {
        icon: <CheckCircle2 size={iconSize} />,
        label: 'Check-in',
        color: 'var(--color-primary)',
      };
    case 'InheritanceTriggered':
      return {
        icon: <Shield size={iconSize} />,
        label: 'Inheritance triggered',
        color: 'var(--color-alert)',
        details: 'Vault is now frozen and distributing.',
      };
    case 'InheritanceDistributed':
      return {
        icon: <ArrowDownToLine size={iconSize} />,
        label: 'Distribution',
        color: 'var(--color-alert)',
        details: event.data?.beneficiary
          ? `${event.data.amount} → ${formatAddress(event.data.beneficiary as string, 4)}`
          : undefined,
      };
    case 'InheritanceTokenProcessed':
      return {
        icon: <CheckCircle2 size={iconSize} />,
        label: 'Asset processed',
        color: 'var(--color-primary)',
        details: event.data?.token as string | undefined,
      };
    case 'InheritanceDistributionFailed':
      return {
        icon: <Activity size={iconSize} />,
        label: 'Distribution retry pending',
        color: 'var(--color-alert)',
      };
    case 'VaultClosed':
      return {
        icon: <Shield size={iconSize} />,
        label: 'Vault closed',
        color: '#FBFBFF',
      };
    default:
      return {
        icon: <Activity size={iconSize} />,
        label: event.type,
        color: 'var(--color-system)',
      };
  }
}