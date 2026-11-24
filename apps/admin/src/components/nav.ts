import type { Permission } from '@madp/contracts';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission: Permission;
  /** Works in the brand picked in the switcher; shown when the admin holds the permission on that brand. */
  brandScoped?: boolean;
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
      { href: '/insights', label: 'AI insights', icon: 'Sparkles', permission: 'insights.read' },
      { href: '/reports', label: 'Reports & exports', icon: 'FileSpreadsheet', permission: 'reports.read' },
    ],
  },
  {
    label: 'Audience',
    items: [
      { href: '/audience', label: 'Audience explorer', icon: 'Globe2', permission: 'audience.counts.read' },
      { href: '/geo', label: 'Geography & overlap', icon: 'Map', permission: 'audience.counts.read' },
      { href: '/panellists', label: 'Panellist directory', icon: 'Users', permission: 'panellists.read' },
      { href: '/identity', label: 'Identity review', icon: 'UserRoundCheck', permission: 'identity.review' },
    ],
  },
  {
    label: 'Panel',
    items: [
      { href: '/members', label: 'Members', icon: 'IdCard', permission: 'members.read', brandScoped: true },
      {
        href: '/question-bank',
        label: 'Question bank',
        icon: 'ListChecks',
        permission: 'qb.read',
        brandScoped: true,
      },
      { href: '/profiles', label: 'Profiles', icon: 'LayoutList', permission: 'qb.read', brandScoped: true },
      {
        href: '/segments',
        label: 'Segments & audiences',
        icon: 'Users',
        permission: 'members.read',
        brandScoped: true,
      },
      {
        href: '/surveys',
        label: 'Surveys',
        icon: 'ClipboardList',
        permission: 'surveys.read',
        brandScoped: true,
      },
      {
        href: '/points',
        label: 'Points approvals',
        icon: 'Coins',
        permission: 'points.read',
        brandScoped: true,
      },
      {
        href: '/quality',
        label: 'Quality & referrals',
        icon: 'Gauge',
        permission: 'quality.manage',
        brandScoped: true,
      },
      { href: '/rewards', label: 'Rewards', icon: 'Gift', permission: 'rewards.manage', brandScoped: true },
      {
        href: '/engagement',
        label: 'Engagement',
        icon: 'Flame',
        permission: 'content.manage',
        brandScoped: true,
      },
      { href: '/teens', label: 'Teen Panel', icon: 'Sprout', permission: 'teen.read', brandScoped: true },
      {
        href: '/teens/registrations',
        label: 'Teen registrations',
        icon: 'UserRoundCheck',
        permission: 'teen.read',
        brandScoped: true,
      },
      {
        href: '/data-requests',
        label: 'Data requests',
        icon: 'FileX2',
        permission: 'data_requests.manage',
        brandScoped: true,
      },
    ],
  },
  {
    label: 'Support',
    items: [
      {
        href: '/tickets',
        label: 'Ticket desk',
        icon: 'LifeBuoy',
        permission: 'support.read',
        brandScoped: true,
      },
      {
        href: '/messages',
        label: 'Portal messages',
        icon: 'MessageSquare',
        permission: 'support.read',
        brandScoped: true,
      },
      {
        href: '/help-centre',
        label: 'Help centre',
        icon: 'BookOpen',
        permission: 'content.manage',
        brandScoped: true,
      },
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
      {
        href: '/freshness',
        label: 'Profile freshness',
        icon: 'Hourglass',
        permission: 'audience.counts.read',
      },
      {
        href: '/verification',
        label: 'Verification & quality',
        icon: 'ScanSearch',
        permission: 'verification.read',
      },
      { href: '/connectors', label: 'Connectors & sync', icon: 'PlugZap', permission: 'connectors.read' },
    ],
  },
  {
    label: 'Engagement',
    items: [
      {
        href: '/communications',
        label: 'Engagement studio',
        icon: 'Mail',
        permission: 'communications.read',
      },
      {
        href: '/communications/mailers',
        label: 'Mailer library',
        icon: 'LayoutList',
        permission: 'communications.read',
      },
      {
        href: '/communications/automations',
        label: 'Lifecycle automations',
        icon: 'Workflow',
        permission: 'communications.read',
      },
    ],
  },
  {
    label: 'Loyalty',
    items: [{ href: '/loyalty', label: 'Loyalty ledger', icon: 'Coins', permission: 'loyalty.read' }],
  },
  {
    label: 'Supply360',
    items: [
      {
        href: '/supply360',
        label: 'Supply360 console',
        icon: 'Network',
        permission: 'service_clients.manage',
      },
    ],
  },
  {
    label: 'Governance',
    items: [
      { href: '/consent', label: 'Consent & preferences', icon: 'BadgeCheck', permission: 'consent.read' },
      { href: '/privacy', label: 'Privacy requests', icon: 'FileLock2', permission: 'privacy.read' },
      {
        href: '/audit',
        label: 'Security audit',
        icon: 'ShieldCheck',
        permission: 'audit.read',
        brandScoped: true,
      },
      { href: '/admins', label: 'Admins & roles', icon: 'UserCog', permission: 'admins.manage' },
      {
        href: '/brands',
        label: 'Brands & settings',
        icon: 'Building2',
        permission: 'brands.manage',
        brandScoped: true,
      },
      {
        href: '/switches',
        label: 'Feature switches',
        icon: 'ToggleRight',
        permission: 'switches.read',
        brandScoped: true,
      },
    ],
  },
];

export const PLANNED: { label: string; milestone: string }[] = [
  { label: 'Questionnaire builder', milestone: 'M3' },
];
