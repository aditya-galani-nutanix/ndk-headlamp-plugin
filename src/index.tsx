// NDK Data Protection — Headlamp plugin entry point.
// Owner: P1. Registers the sidebar entry, the /ndk route, and the AppBar
// "Add cluster" button. Feature components live under src/components and are
// owned by P2/P3/P4 per the hackathon roadmap.

import { registerAppBarAction, registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { AddClusterButton } from './components/AddClusterDialog';
import { ProtectionDashboard } from './components/ProtectionDashboard';

registerSidebarEntry({
  parent: null,
  name: 'ndk',
  label: 'NDK Data Protection',
  url: '/ndk',
  icon: 'mdi:shield-sync',
});

registerRoute({
  path: '/ndk',
  sidebar: 'ndk',
  name: 'ndk',
  exact: true,
  component: () => <ProtectionDashboard />,
});

registerAppBarAction(<AddClusterButton />);
