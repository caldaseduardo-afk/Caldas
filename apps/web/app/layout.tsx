import './globals.css';
import type { ReactNode } from 'react';
import { PlatformTenantAccessBanner } from '../components/platform/platform-tenant-access-banner';
export const metadata = { title: 'Atendente IA' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <PlatformTenantAccessBanner />
        {children}
      </body>
    </html>
  );
}
