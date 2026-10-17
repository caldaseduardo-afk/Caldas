export function allowedPath(method: string, path: string) {
  const id = '[0-9a-fA-F-]{36}';
  return (
    (method === 'GET' && /^(analytics\/dashboard|analytics\/dashboard\/options)$/.test(path)) ||
    (method === 'GET' && (path === 'audit' || new RegExp(`^audit/${id}$`).test(path))) ||
    (method === 'GET' &&
      (/^(auth\/me|tenancy\/tenants|ai-configuration|ai-configuration\/models|ai-configuration\/versions|inbox\/session|inbox\/assignees|inbox\/conversations)$/.test(
        path,
      ) ||
        new RegExp(`^inbox/conversations/${id}(/messages)?$`).test(path) ||
        new RegExp(`^ai-configuration/versions/${id}$`).test(path))) ||
    (method === 'POST' &&
      (/^(auth\/(login|logout)|tenancy\/active|ai-configuration\/versions|ai-configuration\/versions\/clone-active|ai-configuration\/compare)$/.test(
        path,
      ) ||
        new RegExp(
          `^ai-configuration/versions/${id}/(publish|restore|simulate)$`,
        ).test(path) ||
        new RegExp(
          `^conversations/${id}/(messages|request-human|claim|transfer|return-to-ai|resolve)$`,
        ).test(path))) ||
    (method === 'PATCH' &&
      (new RegExp(`^conversations/${id}$`).test(path) ||
        new RegExp(`^ai-configuration/versions/${id}$`).test(path)))
  );
}
