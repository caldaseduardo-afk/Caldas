export type CalendarEventInput = Readonly<{
  appointmentId: string;
  title: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone: string;
}>;

export type CalendarProviderContext = Readonly<{
  calendarId: string;
  credentialsReference: string;
}>;

export type CalendarProviderResult = Readonly<{ eventId: string }>;

export interface CalendarProvider {
  testConnection(context: CalendarProviderContext): Promise<void>;
  findEventByAppointment(
    context: CalendarProviderContext,
    appointmentId: string,
  ): Promise<CalendarProviderResult | null>;
  createEvent(
    context: CalendarProviderContext,
    input: CalendarEventInput,
  ): Promise<CalendarProviderResult>;
  updateEvent(
    context: CalendarProviderContext,
    eventId: string,
    input: CalendarEventInput,
  ): Promise<CalendarProviderResult>;
  cancelEvent(context: CalendarProviderContext, eventId: string): Promise<void>;
}

export class CalendarProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly notFound = false,
  ) {
    super(code);
    this.name = 'CalendarProviderError';
  }
}
