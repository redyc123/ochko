// Форматтеры для UI агента. Сама логика агента (LLM function-calling, выбор
// кандидатов, планирование маршрута) теперь живёт на сервере (server/agent.py);
// клиенту от реплики нужны только эти маленькие форматтеры + показ кандидатов.

/** «Пятёрочка, 12, Тверская улица, Тверской район, Москва, …» → первые 3 части. */
export function shortPlaceName(displayName: string): string {
  return displayName
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
}

export function formatDurationRu(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

export function formatDistanceShortRu(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} км`;
}