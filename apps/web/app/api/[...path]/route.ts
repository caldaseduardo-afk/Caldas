import { allowedPath } from '../../../lib/proxy';
export const dynamic = 'force-dynamic';
async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join('/');
  if (!allowedPath(request.method, path))
    return new Response(null, { status: 404 });
  const headers = new Headers({ 'Content-Type': 'application/json' });
  // Preserve the caller Origin: synthesizing a trusted Origin would bypass CSRF.
  for (const name of ['cookie', 'origin']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    let body: string | undefined;
    if (request.method !== 'GET' && request.body) {
      const reader = request.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      body = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 8192) {
          await reader.cancel();
          return new Response(null, { status: 413 });
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    }
    const response = await fetch(
      `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/${path}${new URL(request.url).search}`,
      {
        method: request.method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
    );
    const output = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    });
    for (const cookie of response.headers.getSetCookie())
      output.append('Set-Cookie', cookie);
    return new Response(
      response.status === 204
        ? null
        : response.ok
          ? await response.text()
          : JSON.stringify({
              message: 'Não foi possível concluir a solicitação.',
            }),
      { status: response.status, headers: output },
    );
  } catch {
    return Response.json(
      { message: 'Serviço indisponível.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH };
