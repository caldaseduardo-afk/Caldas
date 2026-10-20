'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const destinations = [
  { href: '/conversations', label: 'Conversas', icon: '◉' },
  { href: '/agenda', label: 'Agenda', icon: '▦' },
  { href: '/dashboard', label: 'Relatórios', icon: '▥' },
  { href: '/settings/ai', label: 'Assistente IA', icon: '✧' },
  { href: '/settings/integrations', label: 'Integrações', icon: '⌘' },
  { href: '/settings/audit', label: 'Auditoria', icon: '◷' },
  { href: '/settings/plan', label: 'Plano', icon: '◇' },
];

export function TopNavigation() {
  const pathname = usePathname();
  return (
    <nav className="primary-navigation" aria-label="Navegação principal">
      {destinations.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`navigation-link${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
