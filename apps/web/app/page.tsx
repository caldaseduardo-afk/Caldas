import { PlatformMenu } from '../components/platform/platform-dashboard';
import Link from 'next/link';
export default function Home() {
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">a</div>
        <h1>Atendente IA</h1>
        <PlatformMenu />
        <p>Central de atendimento da sua clínica.</p>
        <Link className="primary link-button" href="/conversations">
          Abrir inbox
        </Link>
        <Link className="link-button" href="/settings/ai">
          Configurar assistente de IA
        </Link>
        <Link className="link-button" href="/settings/plan">
          Plano e consumo
        </Link>
        <Link className="link-button" href="/dashboard">Dashboard da clínica</Link>
        <Link className="link-button" href="/settings/audit">Consultar auditoria</Link>
      </section>
    </main>
  );
}
