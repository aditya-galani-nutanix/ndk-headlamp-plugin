// Owner: P2 (extension) — live list of NDK Applications.
//
// Renders every `Application` CR with its protection status and the number of
// resources it currently covers, plus a per-row "Snapshot & Replicate" action
// and a header button to onboard a new Application. Uses Headlamp's useList so
// a freshly created Application shows up here immediately.
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Tooltip } from '@mui/material';
import { ApplicationClass } from '../api/ndk-resources';
import type { ApplicationStatus } from '../api/types';
import {
  applicationMessage,
  applicationState,
  countApplicationResources,
  formatAge,
} from '../utils/helpers';
import { CreateApplicationButton } from './CreateApplicationDialog';
import { SnapshotAndReplicateButton } from './SnapshotAndReplicate';

export interface ApplicationListProps {
  namespace?: string;
  title?: string;
  /** View-only: hide the create button and per-row actions (e.g. on Overview). */
  readOnly?: boolean;
}

function ApplicationStatusChip({ status }: { status?: ApplicationStatus }) {
  const state = applicationState(status);
  const map: Record<
    ReturnType<typeof applicationState>,
    {
      label: string;
      color: 'success' | 'info' | 'warning' | 'error' | 'default';
      outlined?: boolean;
    }
  > = {
    active: { label: 'Active', color: 'success' },
    collecting: { label: 'Collecting', color: 'info' },
    error: { label: 'Error', color: 'error' },
    inactive: { label: 'Inactive', color: 'default', outlined: true },
    pending: { label: 'Pending', color: 'default', outlined: true },
  };
  const c = map[state];
  const chip = (
    <Chip
      size="small"
      label={c.label}
      color={c.color}
      variant={c.outlined ? 'outlined' : 'filled'}
    />
  );
  const msg = applicationMessage(status);
  return msg ? <Tooltip title={msg}>{chip}</Tooltip> : chip;
}

export function ApplicationList({
  namespace,
  title = 'NDK Applications',
  readOnly = false,
}: ApplicationListProps) {
  const [apps] = ApplicationClass.useList(namespace ? { namespace } : {});

  const columns: any[] = [
    { label: 'Name', getter: (a: any) => a.metadata.name, sort: true },
    { label: 'Namespace', getter: (a: any) => a.metadata.namespace ?? '—', sort: true },
    {
      label: 'Status',
      getter: (a: any) => <ApplicationStatusChip status={a.jsonData?.status} />,
    },
    {
      label: 'Resources',
      getter: (a: any) => countApplicationResources(a.jsonData?.status?.summary) || '—',
    },
    {
      label: 'Age',
      getter: (a: any) => formatAge(a.metadata.creationTimestamp),
      sort: (a: any, b: any) =>
        new Date(a.metadata.creationTimestamp ?? 0).getTime() -
        new Date(b.metadata.creationTimestamp ?? 0).getTime(),
    },
  ];
  if (!readOnly) {
    columns.push({
      label: '',
      getter: (a: any) => (
        <SnapshotAndReplicateButton
          application={a.metadata.name}
          namespace={a.metadata.namespace}
          variant="outlined"
        />
      ),
    });
  }

  return (
    <SectionBox title={title}>
      {!readOnly && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <CreateApplicationButton />
        </Box>
      )}
      <SimpleTable
        emptyMessage={
          readOnly
            ? 'No NDK Applications yet.'
            : 'No NDK Applications yet. Click “Create Application” to protect a workload.'
        }
        columns={columns}
        data={apps}
        defaultSortingColumn={4}
      />
    </SectionBox>
  );
}
