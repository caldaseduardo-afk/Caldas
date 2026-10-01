export class AuthConfig {
  readonly origin: string;
  readonly secret: string;
  readonly secure: boolean;
  readonly cookieName: string;
  readonly sessionMs = 8 * 60 * 60 * 1000;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.secret = env.AUTH_SECRET ?? '';
    if (this.secret.length < 32)
      throw new Error('AUTH_SECRET deve ter pelo menos 32 caracteres.');
    this.secure = env.NODE_ENV === 'production';
    let url: URL;
    try {
      url = new URL(env.AUTH_ORIGIN ?? '');
    } catch {
      throw new Error('AUTH_ORIGIN inválida.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== env.AUTH_ORIGIN ||
      (this.secure && url.protocol !== 'https:')
    ) {
      throw new Error(
        'AUTH_ORIGIN deve ser uma origem exata; produção exige HTTPS.',
      );
    }
    this.origin = url.origin;
    this.cookieName = this.secure
      ? '__Host-atendente_session'
      : 'atendente_session';
  }
}
