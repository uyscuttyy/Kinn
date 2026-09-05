/** DeadlineIndicator — countdown + progress bar with urgency states */

import { useEffect, useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { formatDeadline } from '@/utils/format';
import { Row, Stack } from './Layout';
import { Mono } from './Typography';
import { cn } from '@/utils/format';

interface DeadlineIndicatorProps {
  deadline: number | string; // unix timestamp seconds
  label?: string;
  showLabel?: boolean;
}

export function DeadlineIndicator({ deadline, label, showLabel = true }: DeadlineIndicatorProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  const ts = typeof deadline === 'string' ? parseInt(deadline, 10) : deadline;
  const info = formatDeadline(ts);

  // Compute progress: full bar = far from deadline, empty = at deadline
  // For simplicity, we show 0% when overdue and 100% when very far
  const totalRange = 30 * 24 * 3600; // 30 days baseline
  const remaining = ts - now;
  const progress = Math.max(0, Math.min(100, (remaining / totalRange) * 100));

  const fillClass = info.isCritical
    ? 'critical'
    : info.isWarning
    ? 'warning'
    : 'normal';

  return (
    <Stack gap={2}>
      {showLabel && (
        <Row justify="between" align="center">
          <Row gap={2} align="center">
            {info.isOverdue || info.isCritical ? (
              <AlertTriangle size={16} color="var(--color-destructive)" />
            ) : (
              <Clock size={16} color="#6B7B6E" />
            )}
            <span className="text-label">
              {label ?? (info.isOverdue ? 'Overdue' : 'Time remaining')}
            </span>
          </Row>
          <Mono style={{ color: info.isCritical ? 'var(--color-destructive)' : 'var(--color-foreground)' }}>
            {info.text}
          </Mono>
        </Row>
      )}
      <div className="deadline-bar">
        <div
          className={cn('deadline-bar-fill', fillClass)}
          style={{ width: `${progress}%` }}
        />
      </div>
    </Stack>
  );
}