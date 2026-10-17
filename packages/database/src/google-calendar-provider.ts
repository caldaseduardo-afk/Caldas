import {
  CalendarProviderError,
  type CalendarEventInput,
  type CalendarProvider,
  type CalendarProviderContext,
  type CalendarProviderResult,
} from '@atendente/domain';

type Fetch = typeof globalThis.fetch;
type Credentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

function environmentKey(reference: string, field: string) {
  if (!/^[A-Z0-9_]{1,96}$/.test(reference))
    throw new CalendarProviderError('INVALID_CREDENTIAL_REFERENCE', false);
  return reference === 'DEFAULT'
    ? `GOOGLE_${field}`
    : `GOOGLE_${field}_${reference}`;
}

export function googleCalendarCredentials(
  reference: string,
  environment: NodeJS.ProcessEnv = process.env,
): Credentials {
  const credentials = {
    clientId: environment[environmentKey(reference, 'CLIENT_ID')] ?? '',
    clientSecret: environment[environmentKey(reference, 'CLIENT_SECRET')] ?? '',
    refreshToken: environment[environmentKey(reference, 'REFRESH_TOKEN')] ?? '',
  };
  if (
    !credentials.clientId ||
    !credentials.clientSecret ||
    !credentials.refreshToken
  )
    throw new CalendarProviderError('CREDENTIALS_UNAVAILABLE', false);
  return credentials;
}

function providerError(status: number): CalendarProviderError {
  if (status === 404 || status === 410)
    return new CalendarProviderError('EVENT_NOT_FOUND', false, true);
  if (status === 408 || status === 429 || status >= 500)
    return new CalendarProviderError(`GOOGLE_HTTP_${status}`, true);
  if (status === 401)
    return new CalendarProviderError('GOOGLE_UNAUTHORIZED', false);
  if (status === 403)
    return new CalendarProviderError('GOOGLE_FORBIDDEN', false);
  return new CalendarProviderError(`GOOGLE_HTTP_${status}`, false);
}

export class GoogleCalendarProvider implements CalendarProvider {
  constructor(
    private readonly fetcher: Fetch = globalThis.fetch,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly timeoutMs = 10_000,
  ) {}

  private async token(reference: string) {
    const credentials = googleCalendarCredentials(reference, this.environment);
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await this.request(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
      false,
    );
    const result = (await response.json()) as { access_token?: unknown };
    if (typeof result.access_token !== 'string' || !result.access_token)
      throw new CalendarProviderError('TOKEN_RESPONSE_INVALID', false);
    return result.access_token;
  }

  private async request(url: string, init: RequestInit, classify = true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) throw providerError(response.status);
      return response;
    } catch (error) {
      if (error instanceof CalendarProviderError) throw error;
      throw new CalendarProviderError(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'GOOGLE_TIMEOUT'
          : classify
            ? 'GOOGLE_NETWORK_ERROR'
            : 'TOKEN_NETWORK_ERROR',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async api(
    context: CalendarProviderContext,
    path: string,
    init: RequestInit = {},
  ) {
    const token = await this.token(context.credentialsReference);
    return this.request(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(context.calendarId)}${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
      },
    );
  }

  async testConnection(context: CalendarProviderContext) {
    await this.api(context, '/events?maxResults=1&singleEvents=true');
  }

  async findEventByAppointment(
    context: CalendarProviderContext,
    appointmentId: string,
  ) {
    const query = new URLSearchParams({
      maxResults: '2',
      showDeleted: 'false',
      singleEvents: 'true',
      privateExtendedProperty: `appointmentId=${appointmentId}`,
    });
    const response = await this.api(context, `/events?${query}`);
    const data = (await response.json()) as { items?: Array<{ id?: unknown }> };
    const id = data.items?.find((item) => typeof item.id === 'string')?.id;
    return typeof id === 'string' ? { eventId: id } : null;
  }

  private event(input: CalendarEventInput) {
    return {
      summary: input.title.slice(0, 160),
      ...(input.location ? { location: input.location.slice(0, 500) } : {}),
      start: { dateTime: input.startAt, timeZone: input.timezone },
      end: { dateTime: input.endAt, timeZone: input.timezone },
      extendedProperties: { private: { appointmentId: input.appointmentId } },
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      guestsCanSeeOtherGuests: false,
    };
  }

  private async result(response: Response): Promise<CalendarProviderResult> {
    const data = (await response.json()) as { id?: unknown };
    if (typeof data.id !== 'string' || !data.id)
      throw new CalendarProviderError('EVENT_RESPONSE_INVALID', false);
    return { eventId: data.id };
  }

  async createEvent(
    context: CalendarProviderContext,
    input: CalendarEventInput,
  ) {
    return this.result(
      await this.api(context, '/events', {
        method: 'POST',
        body: JSON.stringify(this.event(input)),
      }),
    );
  }

  async updateEvent(
    context: CalendarProviderContext,
    eventId: string,
    input: CalendarEventInput,
  ) {
    return this.result(
      await this.api(context, `/events/${encodeURIComponent(eventId)}`, {
        method: 'PUT',
        body: JSON.stringify(this.event(input)),
      }),
    );
  }

  async cancelEvent(context: CalendarProviderContext, eventId: string) {
    try {
      await this.api(context, `/events/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      if (error instanceof CalendarProviderError && error.notFound) return;
      throw error;
    }
  }
}
