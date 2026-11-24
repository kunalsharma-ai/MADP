import type { Permission } from '@madp/contracts';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission: Permission;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Built screens only. Planned screens are listed separately with their milestone, never as working links. */
export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Executive dashboard', icon: 'LayoutDashboard', permission: 'dashboard.read' },
    ],
  },
  {
    label: 'Audience',
    items: [
      { href: '/audience', label: 'Audience explorer', icon: 'Globe2', permission: 'audience.counts.read' },
      { href: '/panellists', label: 'Panellist directory', icon: 'Users', permission: 'panellists.read' },
      { href: '/identity', label: 'Identity review', icon: 'UserRoundCheck', permission: 'identity.review' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/questions', label: 'Question registry', icon: 'ListTree', permission: 'questions.read' },
      {
        href: '/mappings',
        label: 'Mapping workbench',
        icon: 'GitCompareArrows',
        permission: 'mappings.review',
      },
      { href: '/connectors', label: 'Connectors & sync', icon: 'PlugZap', permission: 'connectors.read' },
    ],
  },
  {
    label: 'Engagement',
    items: [
      { href: '/communications', label: 'Engagement studio', icon: 'Mail', permission: 'communications.read' },
      { href: '/communications/automations', label: 'Lifecycle automations', icon: 'Workflow', permission: 'communications.read' },
    ],
  },
  {
    label: 'Loyalty',
    items: [{ href: '/loyalty', label: 'Loyalty ledger', icon: 'Coins', permission: 'loyalty.read' }],
  },
  {
    label: 'Supply360',
    items: [{ href: '/supply360', label: 'Supply360 console', icon: 'Network', permission: 'service_clients.manage' }],
  },
  {
    label: 'Governance',
    items: [{ href: '/audit', label: 'Security audit', icon: 'ShieldCheck', permission: 'audit.read' }],
  },
];

export const PLANNED: { label: string; milestone: string }[] = [
  { label: 'Consent & preference center', milestone: 'M3' },
  { label: 'Privacy & deletion workflows', milestone: 'M3' },
  { label: 'Questionnaire builder', milestone: 'M3' },
];
