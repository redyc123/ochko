// Типы результатов геокодинга. Сама интеграция с публичным Nominatim (rate
// limit, кэш, очередь) переехала на сервер (server/geocode.py); клиент получает
// готовые результаты через POST /geocode (src/server/api.ts) и сохраняет здесь
// только тип для отображения кандидатов.

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
  type: string;
  importance: number;
}