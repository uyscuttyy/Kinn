/** Landing page — value prop, create vault CTA */

import { Link } from 'react-router-dom';
import { Shield, Clock, Users, Lock } from 'lucide-react';
import { Container, Stack, Row } from '@/components/Layout';
import { Display, TextLarge, TextSmall, Text, Mono, Subhead } from '@/components/Typography';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';

export function LandingPage() {
  return (
    <div>
      {/* Hero — deep */}
      <Container size="narrow">
        <Stack gap={6} className="items-center text-center" style={{ padding: 'var(--space-16) 0' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: 'rgb(64 86 244 / 0.14)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-primary)',
            }}
          >
            <Shield size={32} strokeWidth={1.5} />
          </div>
          <Display style={{ maxWidth: '640px' }}>
            A vault for what you protect.
          </Display>
          <TextLarge
            style={{ maxWidth: '560px', color: 'var(--color-soft)' }}
          >
            Kinn is a non-custodial inheritance vault. Set check-in intervals,
            name your beneficiaries, and deposit assets. If you stop checking in,
            your vault automatically distributes to the people you trust.
          </TextLarge>
          <Row gap={3} className="mt-4" wrap justify="center">
            <Link to="/create-wallet">
              <Button variant="primary" size="lg">Create Kinn wallet</Button>
            </Link>
            <Link to="/unlock">
              <Button variant="secondary" size="lg">Unlock existing wallet</Button>
            </Link>
          </Row>
        </Stack>
      </Container>

      {/* How it works — wash band */}
      <div className="band">
        <Container size="narrow">
          <Stack gap={5} style={{ padding: 'var(--space-12) 0' }}>
            <TextSmall
              style={{ color: 'var(--color-soft)', textAlign: 'center', letterSpacing: '0.1em' }}
            >
              HOW IT WORKS
            </TextSmall>
            <Stack gap={3}>
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
                title="The contract holds the assets"
                description="Kinn never custodies. The smart contract is the only authority. The backend only prepares your transactions."
              />
              <FeatureRow
                icon={<Shield size={20} />}
                title="You stay in control"
                description="A missed check-in is not a death sentence. Check in any time to reset the timer. Withdrawal works until inheritance is triggered."
              />
            </Stack>
          </Stack>
        </Container>
      </div>

      {/* Technical — deep */}
      <Container size="narrow">
        <Stack gap={6} style={{ padding: 'var(--space-12) 0 var(--space-16)' }}>
          <Card padding="md">
            <Stack gap={3}>
              <TextSmall style={{ color: 'var(--color-soft)', letterSpacing: '0.1em' }}>
                TECHNICAL DETAILS
              </TextSmall>
              <Text>
                Built on Base. State machine: Active → Missed → Eligible →
                Distributing → Distributed. 121 contract tests pass on Base Sepolia.
                EIP-712 authentication. First-party KeyManager with AES-GCM
                encryption at rest.
              </Text>
              <Row gap={2} wrap>
                <Mono style={{ color: 'var(--color-soft)' }}>Chain:</Mono>
                <Mono>Base Sepolia (84532)</Mono>
                <Mono style={{ color: 'var(--color-soft)', marginLeft: 8 }}>Factory:</Mono>
                <Mono>0x6727…2933</Mono>
              </Row>
            </Stack>
          </Card>
        </Stack>
      </Container>
    </div>
  );
}

function FeatureRow({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="feature-row">
      <Row gap={4} align="start">
        <div className="feature-icon">
          {icon}
        </div>
        <Stack gap={1}>
          <Subhead>{title}</Subhead>
          <TextSmall style={{ color: 'var(--color-soft)' }}>{description}</TextSmall>
        </Stack>
      </Row>
    </div>
  );
}
