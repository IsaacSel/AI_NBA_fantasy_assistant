'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import {
  ActionIcon, AppShell, Burger, Group, NavLink, Text,
  useComputedColorScheme, useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconBallBasketball, IconListNumbers, IconArrowsLeftRight,
  IconClipboardList, IconRobot, IconSun, IconMoon } from '@tabler/icons-react';

const NAV = [
  { href: '/', label: 'Player rankings', icon: IconListNumbers },
  { href: '/compare', label: 'Compare players', icon: IconArrowsLeftRight },
  { href: '/draft', label: 'Manual draft tracker', icon: IconClipboardList },
  { href: '/mock-draft', label: 'Mock draft simulator', icon: IconRobot },
];
function Menu({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  return NAV.map(item => (
    <NavLink key={item.href} href={item.href} component={Link}
      label={item.label} leftSection={<item.icon size={18} />}
      active={item.href === '/' ? pathname === '/' || pathname.startsWith('/players/') : pathname.startsWith(item.href)}
      onClick={onNavigate} />
  ));
}
export function AppShellLayout({ children }: { children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure(false);
  const scheme = useComputedColorScheme('light');
  const { setColorScheme } = useMantineColorScheme();
  return <AppShell header={{ height: 60 }} navbar={{ width: 224, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
    <AppShell.Header>
      <Group h="100%" px="md" justify="space-between">
        <Group gap="xs"><Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <IconBallBasketball size={25} color="#f97316" />
          <Text fw={800}>Fantasy Hoops Lab</Text>
          <Text size="xs" c="dimmed" visibleFrom="sm">2025–26 CSV edition</Text>
        </Group>
        <ActionIcon variant="default" size="lg" aria-label="Toggle theme"
          onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>
          {scheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
        </ActionIcon>
      </Group>
    </AppShell.Header>
    <AppShell.Navbar p="xs"><Suspense fallback={null}><Menu onNavigate={close} /></Suspense></AppShell.Navbar>
    <AppShell.Main><div style={{ maxWidth: 1320, margin: '0 auto' }}>{children}</div></AppShell.Main>
  </AppShell>;
}
