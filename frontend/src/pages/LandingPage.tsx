/** Landing page — value prop, create vault CTA */

import { Link } from 'react-router-dom';
import { Shield, Clock, Users, Lock } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, TextSmall, Text, Mono } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';

export function LandingPage() {
  return (
    <Container size="narrow">
      <Stack gap={12} className="py-20">
        <Stack gap={6} className="items-center text-center">
          <div
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
            <Shield size={32} strokeWidth={1.5} />
          </div>
          <Display style={{ maxWidth: '640px' }}>
            A vault for what you protect.
          </Display>
          <TextLarge
            style={{ maxWidth: '560px', color: '#6B7B6E' }}
          >
            Kinn is a non-custodial inheritance vault. Set check-in intervals,
            name your beneficiaries, and deposit assets. If you stop checking in,
            your vault automatically distributes to the people you trust.
          </TextLarge>
          <Row gap={3} className="mt-4">
            <Link to="/create-wallet">
              <Button variant="primary" size="lg">Get started</Button>
            </Link>
            <Link to="/unlock">
              <Button variant="secondary" size="lg">I have a wallet</Button>
            </Link>
          </Row>
        </Stack>

        <Stack gap={5}>
          <TextSmall
            style={{ color: '#6B7B6E', textAlign: 'center', letterSpacing: '0.1em' }}
          >
            HOW IT WORKS
          </TextSmall>
          <Stack gap={4}>
            <FeatureRow
              icon={<Clock size={20} />}
              title="Check in on your schedule"
              description="Set an interval that suits you — every 30 days, every quarter. Kinn runs in the background, not in your face."
            />
            <FeatureRow
              icon={<Users size={20} />}
              title="Name your beneficiaries"
              description="Allocate assets to anyone with a wallet. Allocations must sum to 100% and are enforced on-chain."
            />
            <FeatureRow
              icon={<Lock size={20} />}
              title="The contract holds the keys"
              description="Kinn never custodies. The smart contract is the only authority. The backend only prepares your transactions."
            />
            <FeatureRow
              icon={<Shield size={20} />}
              title="You stay in control"
              description="A missed check-in is not a death sentence. Check in any time to reset the timer. Withdrawal works until inheritance is triggered."
            />
          </Stack>
        </Stack>

        <Card padding="md">
          <Stack gap={3}>
            <TextSmall style={{ color: '#6B7B6E', letterSpacing: '0.1em' }}>
              TECHNICAL DETAILS
            </TextSmall>
            <Text>
              Built on Base. State machine: Active → Missed → Eligible →
              Distributing → Distributed. 121 contract tests pass on Base Sepolia.
              EIP-712 authentication. First-party KeyManager with AES-GCM
              encryption at rest.
            </Text>
            <Row gap={2} wrap>
              <Mono style={{ color: '#6B7B6E' }}>Chain:</Mono>
              <Mono>Base Sepolia (84532)</Mono>
              <Mono style={{ color: '#6B7B6E', marginLeft: 8 }}>Factory:</Mono>
              <Mono>0x6727…2933</Mono>
            </Row>
          </Stack>
        </Card>
      </Stack>
    </Container>
  );
}

function FeatureRow({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Row gap={4} align="start">
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--color-card)',
          border: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-brand)',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <Stack gap={1}>
        <Text style={{ fontWeight: 600 }}>{title}</Text>
        <TextSmall style={{ color: '#6B7B6E' }}>{description}</TextSmall>
      </Stack>
    </Row>
  );
}