const parisDateTime = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

const parisTime = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});

const parisDate = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Paris',
});

export function formatDateTime(value: string): string {
  return parisDateTime.format(new Date(value));
}

export function formatTime(value: string): string {
  return parisTime.format(new Date(value)).replace(':', ' h ');
}

export function formatCompactTime(value: string): string {
  return parisTime.format(new Date(value));
}

export function formatDate(value: string): string {
  return parisDate.format(new Date(value));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const mb = bytes / 1_048_576;
  return `${mb.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

export function formatScore(score: number): string {
  return score.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPercent(score: number): string {
  return `${Math.round(score * 100)} %`;
}
