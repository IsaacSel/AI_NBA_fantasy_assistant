'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ActionIcon,
  AppShell,
  Burger,
  Group,
  NavLink,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBallBasketball,
  IconListNumbers,
  IconClipboardList,
  IconMoon,
  IconRepeat,
  IconCalendarStats,
  IconSun,
  IconTournament,
  IconBrain,
} from '@tabler/icons-react';
import { Suspense, type ReactNode } from 'react';

const NAV_ITEMS = [
  {
    href: '/',
    label: 'Rankings',
    icon: IconListNumbers,
  },
  {
    href: '/history',
    label: 'Season history',
    icon: IconCalendarStats,
  },
  {
    href: '/model',
    label: 'AI model',
    icon: IconBrain,
  },
  {
    href: '/live',
    label: 'Live draft',
    icon: IconClipboardList,
  },
  {
    href: '/draft',
    label: 'Mock draft',
    icon: IconTournament,
  },
  {
    href: '/streaming',
    label: 'Streaming',
    icon: IconRepeat,
  },
];

function isActive(href: string, pathname: string | null): boolean {
  if (pathname === null) {
    return false;
  }
  return href === '/' ? pathname === '/' || pathname.startsWith('/players') : pathname.startsWith(href);
}

function NavLinks({ pathname, onNavigate }: { pathname: string | null; onNavigate: () => void }) {
  return NAV_ITEMS.map(({ href, label, icon: Icon }) => (
    <NavLink
      key={href}
      component={Link}
      href={href}
      label={label}
      leftSection={<Icon size={18} />}
      active={isActive(href, pathname)}
      onClick={onNavigate}
    />
  ));
}

// The current path is only known at request time, so it renders inside Suspense.
function ActiveNavLinks({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <NavLinks
      pathname={pathname}
      onNavigate={onNavigate}
    />
  );
}

export function AppShellLayout({ children }: { children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme('light');

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 220,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group
          h="100%"
          px="md"
          justify="space-between"
        >
          <Group gap="xs">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label="Toggle navigation"
            />
            <IconBallBasketball
              size={24}
              className="text-orange-500"
            />
            <Text fw={700}>Fantasy Hoops Lab</Text>
          </Group>
          <ActionIcon
            variant="default"
            size="lg"
            onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle color scheme"
          >
            {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </ActionIcon>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <Suspense
          fallback={(
            <NavLinks
              pathname={null}
              onNavigate={close}
            />
          )}
        >
          <ActiveNavLinks onNavigate={close} />
        </Suspense>
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
