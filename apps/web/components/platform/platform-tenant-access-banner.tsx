'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface AccessStatus {
  tenant: { id: string; name: string };
  expiresAt: string;
}

export function PlatformTenantAccessBanner() {
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let current = true;
    void fetch('/api/super-admin/tenant-access', { cache: 'no-store' })
      .then(async (response) =>
        response.ok ? (response.json() as Promise<AccessStatus | null>) : null,
      )
      .then((result) => {
        if (current) setAccess(result);
      })
      .catch(() => {
        if (current) setAccess(null);
      });
    return () => {
      current = false;
    };
  }, [pathname]);

  if (!access) return null;
  return (
    <aside className="platform-tenant-access-banner" role="status">
      <span>
        <strong>Modo Super Admin</strong> · {access.tenant.name} · leitura e
        edição auditadas
      </span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const response = await fetch('/api/super-admin/tenant-access/end', {
              method: 'POST',
            });
            if (!response.ok) throw new Error('Falha ao encerrar');
            setAccess(null);
            router.push('/super-admin');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Encerrando…' : 'Sair da clínica'}
      </button>
    </aside>
  );
}
