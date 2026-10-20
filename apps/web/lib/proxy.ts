export function allowedPath(method: string, path: string) {
  const id = '[0-9a-fA-F-]{36}';
  const uuid = (prefix: string) => new RegExp(`^${prefix}/${id}$`).test(path);
  const profileRead =
    /^(clinics|units|providers|contacts|patients|appointments|knowledge\/articles|human-sla-rules|notification-rules)$/.test(
      path,
    ) ||
    /^(clinics|units|providers|contacts|patients|appointments|knowledge\/articles|human-sla-rules|notification-rules)\/[0-9a-fA-F-]{36}$/.test(
      path,
    ) ||
    new RegExp(`^knowledge/articles/${id}/(versions|published)$`).test(path);
  const profileCreate =
    /^(contacts|patients|appointments|knowledge\/articles|human-sla-rules|notification-rules)$/.test(
      path,
    );
  const profileActions = new RegExp(
    `^(appointments/${id}/(cancel|reschedule|status)|knowledge/articles/${id}/(versions|inactivate)|knowledge/articles/${id}/versions/[0-9]+/publish|human-sla-rules/${id}/preview|notification-rules/${id}/(preview|resolve))$`,
  ).test(path);
  const profileUpdate = new RegExp(
    `^(clinics|units|providers|contacts|patients|knowledge/articles|human-sla-rules|notification-rules)/${id}$`,
  ).test(path);
  return (
    (method === 'GET' &&
      (/^super-admin\/(session|overview|health|tenant-access)$/.test(path) ||
        new RegExp(`^super-admin/tenants/${id}$`).test(path) ||
        path === 'plans/current' ||
        path === 'plans/catalog' ||
        /^(analytics\/dashboard|analytics\/dashboard\/options|appointments\/calendar|tenancy\/active|tenancy\/units|audit|ai-configuration|ai-configuration\/models|ai-configuration\/versions|inbox\/session|inbox\/assignees|inbox\/conversations|auth\/me|tenancy\/tenants)$/.test(
          path,
        ) ||
        new RegExp(
          `^(audit|tenancy/units|inbox/conversations|inbox/conversations/${id}(/messages)?|conversations|conversations/${id})$`,
        ).test(path) ||
        new RegExp(`^ai-configuration/versions/${id}$`).test(path) ||
        profileRead)) ||
    (method === 'POST' &&
      (/^super-admin\/(login|enroll|logout|tenant-access\/end)$/.test(path) ||
        new RegExp(`^super-admin/tenants/${id}/access$`).test(path) ||
        /^(auth\/(login|logout)|tenancy\/active|ai-configuration\/versions|ai-configuration\/versions\/clone-active|ai-configuration\/compare)$/.test(
          path,
        ) ||
        new RegExp(
          `^ai-configuration/versions/${id}/(publish|restore|simulate)$`,
        ).test(path) ||
        new RegExp(
          `^conversations/${id}/(messages|request-human|claim|transfer|return-to-ai|resolve)$`,
        ).test(path) ||
        new RegExp(
          `^ai-configuration/versions/${id}/(publish|restore|simulate)$`,
        ).test(path) ||
        profileCreate ||
        profileActions)) ||
    (method === 'PATCH' &&
      (new RegExp(`^conversations/${id}$`).test(path) ||
        new RegExp(`^ai-configuration/versions/${id}$`).test(path) ||
        new RegExp(`^super-admin/tenants/${id}/subscription$`).test(path) ||
        profileUpdate)) ||
    (method === 'PUT' &&
      /^(settings\/integrations|settings\/calendar)$/.test(path)) ||
    (method === 'DELETE' && (uuid('clinics') || uuid('units')))
  );
}
