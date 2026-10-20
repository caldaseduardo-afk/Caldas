import Link from 'next/link';
import { PlatformMenu } from '../components/platform/platform-dashboard';

const areas = [
  { href: '/conversations', title: 'Conversas', description: 'Acompanhe a fila, o histórico e os atendimentos humanos.', icon: '◉' },
  { href: '/agenda', title: 'Agenda', description: 'Consulte os agendamentos por semana e unidade.', icon: '▦' },
  { href: '/dashboard', title: 'Relatórios', description: 'Consulte os indicadores operacionais disponíveis.', icon: '▥' },
  { href: '/settings/ai', title: 'Assistente de IA', description: 'Revise as configurações e versões do assistente.', icon: '✧' },
  { href: '/settings/integrations', title: 'Integrações', description: 'Configure as credenciais desta clínica.', icon: '⌘' },
  { href: '/settings/audit', title: 'Auditoria', description: 'Consulte os eventos de auditoria autorizados.', icon: '◷' },
  { href: '/settings/plan', title: 'Plano e consumo', description: 'Veja o plano e o consumo da clínica.', icon: '◇' },
];

export default function Home() {
  return (
    <main className="home-shell">
      <header className="home-header">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">✳</span>
          <span className="brand-copy"><strong>Atendente IA</strong><small>Atendimento da clínica</small></span>
        </a>
        <PlatformMenu />
      </header>
      <section className="home-intro">
        <div className="eyebrow">ESPAÇO DE TRABALHO</div>
        <h1>Como podemos ajudar hoje?</h1>
        <p>Acesse as ferramentas da sua clínica em um só lugar.</p>
      </section>
      <nav className="home-grid" aria-label="Áreas da clínica">
        {areas.map((area) => (
          <Link key={area.href} className="home-card" href={area.href}>
            <span className="home-icon" aria-hidden="true">{area.icon}</span>
            <span><strong>{area.title}</strong><small>{area.description}</small></span>
            <span className="home-arrow" aria-hidden="true">↗</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
