import { Counter, Registry, Histogram, collectDefaultMetrics } from 'prom-client';

// Создаём реестр метрик
export const metricsRegistry = new Registry();

// Собираем дефолтные системные метрики (CPU, память и т.д.)
collectDefaultMetrics({ register: metricsRegistry });

// Метрики количества выполненных задач
export const taskCounter = new Counter({
  name: 'orbit_tasks_total',
  help: 'Total number of tasks executed',
  labelNames: ['taskName', 'host', 'status'],
  registers: [metricsRegistry],
});

// Метрики времени выполнения задач
export const taskDuration = new Histogram({
  name: 'orbit_task_duration_seconds',
  help: 'Task execution duration in seconds',
  labelNames: ['taskName', 'host'],
  registers: [metricsRegistry],
});

// Метрики количества выполненных плейбуков
export const playbookCounter = new Counter({
  name: 'orbit_playbooks_total',
  help: 'Total number of playbooks executed',
  labelNames: ['playbookName', 'status'],
  registers: [metricsRegistry],
});

// Метрика ошибок
export const errorCounter = new Counter({
  name: 'orbit_errors_total',
  help: 'Total number of errors encountered',
  labelNames: ['errorCode'],
  registers: [metricsRegistry],
});
