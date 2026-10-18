import Link from 'next/link';
import { PlanSettings } from '../../../components/settings/plan-settings';
import './plan.css';

export default function PlanPage() {
  return (
    <main className="login-shell">
      <section className="login-card plan-card">
        <Link href="/">← Início</Link>
        <h1>Plano e consumo</h1>
        <p>Consumo do ciclo atual e recursos disponíveis para sua clínica.</p>
        <PlanSettings />
      </section>
    </main>
  );
}
