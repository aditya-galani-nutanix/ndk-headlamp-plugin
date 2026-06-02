// Owner: P3 (extension) — human-friendly snapshot detail view.
//
// Instead of dumping the raw CR, this shows the snapshot's metadata and the
// resources it captured, grouped by Kind with icons and counts (plus any
// skipped / failed artifacts and their reasons). Reads everything from
// status.summary.snapshotArtifacts*.
import { Icon } from '@iconify/react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import type { ApplicationSnapshotStatus } from '../api/types';
import {
  formatAge,
  groupSnapshotArtifacts,
  kindIcon,
  type ResourceKindGroup,
  snapshotErrorMessage,
  snapshotState,
} from '../utils/helpers';

export interface SnapshotDetailsDialogProps {
  /** The snapshot's jsonData (metadata + spec + status). */
  snapshot: any;
  onClose: () => void;
}

function MetaRow({ label, value }: { label: string; value?: ReactNode }) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.25 }}>
      <Typography variant="body2" color="textSecondary" sx={{ minWidth: 150 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
}

function StatusChip({ status }: { status?: ApplicationSnapshotStatus }) {
  const state = snapshotState(status);
  if (state === 'ready') {
    return <Chip size="small" color="success" label="Ready" />;
  }
  if (state === 'error') {
    return <Chip size="small" color="error" label="Failed" />;
  }
  return <Chip size="small" variant="outlined" label="Pending" />;
}

function KindGroupAccordion({
  group,
  tone = 'default',
}: {
  group: ResourceKindGroup;
  tone?: 'default' | 'warning' | 'error';
}) {
  const multiNs = new Set(group.resources.map(r => r.namespace ?? '')).size > 1;
  const color = tone === 'error' ? 'error.main' : tone === 'warning' ? 'warning.main' : undefined;
  return (
    <Accordion disableGutters elevation={0} variant="outlined">
      <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          <Icon icon={kindIcon(group.kind)} width={20} height={20} />
          <Typography variant="subtitle2" sx={{ color }}>
            {group.kind}
          </Typography>
          {group.group && (
            <Typography variant="caption" color="textSecondary">
              {group.group}
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Chip size="small" label={group.resources.length} />
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {group.resources.map((r, i) => {
            const label = multiNs && r.namespace ? `${r.namespace}/${r.name}` : r.name;
            const detail = r.reason || r.error;
            const chip = (
              <Chip
                key={`${r.namespace ?? ''}/${r.name}/${i}`}
                size="small"
                variant="outlined"
                color={tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : 'default'}
                label={label}
              />
            );
            return detail ? (
              <Box
                key={`${r.namespace ?? ''}/${r.name}/${i}`}
                sx={{ display: 'flex', flexDirection: 'column' }}
              >
                {chip}
                <Typography variant="caption" color={color} sx={{ ml: 0.5 }}>
                  {detail}
                </Typography>
              </Box>
            ) : (
              chip
            );
          })}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

export function SnapshotDetailsDialog({ snapshot, onClose }: SnapshotDetailsDialogProps) {
  const meta = snapshot?.metadata ?? {};
  const spec = snapshot?.spec ?? {};
  const status: ApplicationSnapshotStatus | undefined = snapshot?.status;
  const application = spec?.source?.applicationRef?.name as string | undefined;

  const { captured, skipped, failed, total } = groupSnapshotArtifacts(status?.summary);
  const state = snapshotState(status);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Icon icon="mdi:camera-outline" />
          {meta.name}
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <MetaRow label="Name" value={meta.name} />
            <MetaRow label="Application" value={application} />
            <MetaRow label="Namespace" value={meta.namespace} />
            <MetaRow label="Status" value={<StatusChip status={status} />} />
            <MetaRow label="Consistency" value={status?.consistencyType} />
            <MetaRow
              label="Created"
              value={
                status?.creationTime
                  ? `${formatAge(status.creationTime)} ago (${new Date(
                      status.creationTime
                    ).toLocaleString()})`
                  : undefined
              }
            />
            <MetaRow
              label="Expires"
              value={
                status?.expirationTime
                  ? new Date(status.expirationTime).toLocaleString()
                  : undefined
              }
            />
            <MetaRow label="Snapshot content" value={status?.boundApplicationSnapshotContentName} />
          </Box>

          {state === 'error' && (
            <Alert severity="error">{snapshotErrorMessage(status) ?? 'Snapshot failed.'}</Alert>
          )}

          <Divider />

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="h6">Captured resources</Typography>
              {total > 0 && (
                <Chip
                  size="small"
                  color="primary"
                  label={`${total} across ${captured.length} kind${captured.length > 1 ? 's' : ''}`}
                />
              )}
            </Box>
            {captured.length === 0 ? (
              <Alert severity="info">
                {state === 'ready'
                  ? 'This snapshot recorded no resource summary.'
                  : 'Resource details will appear once the snapshot is ready.'}
              </Alert>
            ) : (
              <Stack spacing={0.5}>
                {captured.map(g => (
                  <KindGroupAccordion key={`${g.group}/${g.kind}`} group={g} />
                ))}
              </Stack>
            )}
          </Box>

          {skipped.length > 0 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom color="warning.main">
                Skipped resources
              </Typography>
              <Stack spacing={0.5}>
                {skipped.map(g => (
                  <KindGroupAccordion key={`skip/${g.group}/${g.kind}`} group={g} tone="warning" />
                ))}
              </Stack>
            </Box>
          )}

          {failed.length > 0 && (
            <Box>
              <Typography variant="subtitle1" gutterBottom color="error">
                Failed resources
              </Typography>
              <Stack spacing={0.5}>
                {failed.map(g => (
                  <KindGroupAccordion key={`fail/${g.group}/${g.kind}`} group={g} tone="error" />
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
