// The address of a calendar page: the view, the date, the group filter and the open day all live
// in the address, so every state can be shared, reloaded and used with the back button.

export type CalendarView = 'semaine' | 'mois' | 'annee';

export type CalendarParams = {
  vue: CalendarView;
  date: string;
  groupe?: string;
  jour?: string;
};

export function calendarUrl(params: CalendarParams): string {
  const query = new URLSearchParams();
  query.set('vue', params.vue);
  query.set('date', params.date);
  if (params.groupe) query.set('groupe', params.groupe);
  if (params.jour) query.set('jour', params.jour);
  return `/calendrier?${query.toString()}`;
}
