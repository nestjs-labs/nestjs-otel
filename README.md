![nestjs-otel](https://github.com/pragmaticivan/nestjs-otel/assets/301291/40aaad82-82f9-48e5-b204-0e3cef532813)


# NestJS OpenTelemetry (OTEL)

![Build Status](https://github.com/pragmaticivan/nestjs-otel/actions/workflows/nodejs.yml/badge.svg)
[![NPM](https://img.shields.io/npm/v/nestjs-otel.svg)](https://www.npmjs.com/package/nestjs-otel)

## Description

[OpenTelemetry](https://opentelemetry.io/) module for [Nest](https://github.com/nestjs/nest).

## Why

Setting up observability metrics with nestjs requires multiple libraries and patterns. OpenTelemetry has support for multiple exporters and types of metrics such as Prometheus Metrics.

## Observability

Please read this [comprehensive whitepaper](https://github.com/cncf/tag-observability/blob/main/whitepaper.md) if that's your first time working with metrics, tracing, and logs.

![observability-signals](https://user-images.githubusercontent.com/24193764/121773601-55f86b80-cb53-11eb-8c8b-262a5aad781f.png)


## Examples

A full working examples are available. This includes a nestjs application fully integrated with prometheus, grafana, loki and tempo:

- [nestjs-otel-prom-grafana-tempo](https://github.com/pragmaticivan/nestjs-otel-prom-grafana-tempo )


## Installation

```bash
npm i nestjs-otel @opentelemetry/sdk-node --save
```

## Setup

Some peers dependencies are required when some configurations are enabled.

```
@opentelemetry/exporter-prometheus
```

1. Create tracing file (`tracing.ts`):

```ts
import {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from '@opentelemetry/core';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerPropagator } from '@opentelemetry/propagator-jaeger';
import { B3Propagator } from '@opentelemetry/propagator-b3';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import * as process from 'process';

const otelSDK = new NodeSDK({
  metricReader: new PrometheusExporter({
    port: 8081,
  }),
  spanProcessor: new BatchSpanProcessor(new JaegerExporter()),
  contextManager: new AsyncLocalStorageContextManager(),
  textMapPropagator: new CompositePropagator({
    propagators: [
      new JaegerPropagator(),
      new W3CTraceContextPropagator(),
      new W3CBaggagePropagator(),
      new B3Propagator(),
    ],
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

export default otelSDK;

// You can also use the shutdown method to gracefully shut down the SDK before process shutdown
// or on some operating system signal.
process.on('SIGTERM', () => {
  otelSDK
    .shutdown()
    .then(
      () => console.log('SDK shut down successfully'),
      err => console.log('Error shutting down SDK', err)
    )
    .finally(() => process.exit(0));
});
```

2. Import the metric file and start otel node SDK:

```ts
import otelSDK from './tracing';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  // Start SDK before nestjs factory create
  await otelSDK.start();

  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(Logger));
  await app.listen(3000);
}
bootstrap();
```

3. Configure nest-otel:

3.1. With `forRoot`:

```ts
const OpenTelemetryModuleConfig = OpenTelemetryModule.forRoot({
  metrics: {
    hostMetrics: true, // Includes Host Metrics
    apiMetrics: { // @deprecated - will be removed in 8.0 - you should start using the semcov from opentelemetry metrics instead
      enable: true, // Includes api metrics
      defaultAttributes: {
        // You can set default labels for api metrics
        custom: 'label',
      },
      ignoreRoutes: ['/favicon.ico'], // You can ignore specific routes (See https://docs.nestjs.com/middleware#excluding-routes for options)
      ignoreUndefinedRoutes: false, //Records metrics for all URLs, even undefined ones
      prefix: 'my_prefix', // Add a custom prefix to all API metrics
    },
  },
});

@Module({
  imports: [OpenTelemetryModuleConfig],
})
export class AppModule {}
```

3.2. With `forRootAsync`:

```ts
OpenTelemetryModule.forRootAsync({
  useClass: OtelConfigService
});
```

```ts
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenTelemetryOptionsFactory, OpenTelemetryModuleOptions } from 'nestjs-otel';

@Injectable()
export class OtelConfigService implements OpenTelemetryOptionsFactory {
  private readonly logger = new Logger(OtelConfigService.name)

  constructor(private configService: ConfigService) {}

  createOpenTelemetryOptions(): Promise<OpenTelemetryModuleOptions> | OpenTelemetryModuleOptions {
    const { hostMetrics, apiMetrics } = this.configService.get('otel')

    return {
      metrics: {
        hostMetrics: hostMetrics.enabled,
        apiMetrics: {
          enable: apiMetrics.enabled,
        },
      },
    };
  }
}
```

## Span Decorator

If you need, you can define a custom Tracing Span for a method. It works async or sync.

Span optionally takes one or both of the following parameters:
  * `name` - explicit name of the span; if omitted, it is derived as `<class-name>.<method-name>`.
  * `options` - `SpanOptions` to customize the span options.

You can also supply a function as the `options` argument. It will be called with the decorated method's arguments, so you can dynamically customize the span options.


```ts
import { Span } from 'nestjs-otel';

export class BooksService {

  // span.name == 'CRITICAL_SECTION'
  @Span('CRITICAL_SECTION')
  async getBooks() {
      return [`Harry Potter and the Philosopher's Stone`];
  }

  // span.name == 'BooksService.getBooksAgain'
  @Span()
  async getBooksAgain() {
      return [`Harry Potter and the Philosopher's Stone`];
  }

  // explicitly set span options
  @Span('getBook', { kind: SpanKind.SERVER })
  async getBook(id: number) {
    // ...
  }

  // options are set dynamically based on the id parameter
  @Span('getBook', (id) => ({ attributes: { bookId: id } }))
  async getBookAgain(id: number) {
    // ...
  }

  // same as above, but span name is omitted and inferred automatically
  @Span((id) => ({ attributes: { bookId: id } }))
  async getBookOnceMore(id: number) {
    // ...
  }
}

```

## Tracing Service

In case you need to access native span methods for special logics in the method block:

```ts
import { TraceService } from 'nestjs-otel';

@Injectable()
export class BookService {
  constructor(private readonly traceService: TraceService) {}

  @Span()
  async getBooks() {
    const currentSpan = this.traceService.getSpan(); // --> retrives current span, comes from http or @Span
    await this.doSomething();
    currentSpan.addEvent('event 1');
    currentSpan.end(); // current span end

    const span = this.traceService.startSpan('sub_span'); // start new span
    span.setAttributes({ userId: 1 });
    await this.doSomethingElse();
    span.end(); // new span ends
    return [`Harry Potter and the Philosopher's Stone`];
  }
}
```

## Metric Service

[OpenTelemetry Metrics](https://www.npmjs.com/package/@opentelemetry/api) allow a user to collect data and export it to metrics backend like Prometheus.

```ts
import { MetricService } from 'nestjs-otel';
import { Counter } from '@opentelemetry/api';

@Injectable()
export class BookService {
  private customMetricCounter: Counter;

  constructor(private readonly metricService: MetricService) {
    this.customMetricCounter = this.metricService.getCounter('custom_counter', {
      description: 'Description for counter',
    });
  }

  async getBooks() {
    this.customMetricCounter.add(1);
    return [`Harry Potter and the Philosopher's Stone`];
  }
}
```

## Metric Decorators

### Metric Class Instances

If you want to count how many instance of a specific class has been created:

```ts
@OtelInstanceCounter() // It will generate a counter called: app_MyClass_instances_total.
export class MyClass {}
```

### Metric Class Method

If you want to increment a counter on each call of a specific method:

```ts
@Injectable()
export class MyService {
  @OtelMethodCounter()
  doSomething() {}
}
@Controller()
export class AppController {
  @Get()
  @OtelMethodCounter() // It will generate `app_AppController_doSomething_calls_total` counter.
  doSomething() {
    // do your stuff
  }
}
```

### Metric Param Decorator

You have the following decorators:

- `@OtelCounter()`
- `@OtelUpDownCounter()`
- `@OtelHistogram()`
- `@OtelGauge()`
- `@OtelObservableGauge()`
- `@OtelObservableCounter()`
- `@OtelObservableUpDownCounter()`

Example of usage:

```ts
import { OtelCounter } from 'nestjs-otel';
import { Counter } from '@opentelemetry/api';

@Controller()
export class AppController {
  @Get('/home')
  home(
    @OtelCounter('app_counter_1_inc', { description: 'counter 1 description' }) counter1: Counter
  ) {
    counter1.add(1);
  }
}
```

## API Metrics with Middleware

> @deprecated - this will be removed in 8.0 - you should start using the semcov from opentelemetry metrics instead

| Impl | Otel Metric                         | Prometheus Metric                         | Description                               | Metric Type |
| ---- | --------------------------------    | ---------------------------------------   | ----------------------------------------- | ----------- |
| ✅   | http.server.request.count           | http_server_request_count_total           | Total number of HTTP requests.            | Counter     |
| ✅   | http.server.response.count          | http_server_response_count_total          | Total number of HTTP responses.           | Counter     |
| ✅   | http.server.abort.count             | http_server_abort_count_total             | Total number of data transfers aborted.   | Counter     |
| ✅   | http.server.duration                | http_server_duration                      | The duration of the inbound HTTP request. | Histogram   |
| ✅   | http.server.request.size            | http_server_request_size                  | Size of incoming bytes.                   | Histogram   |
| ✅   | http.server.response.size           | http_server_response_size                 | Size of outgoing bytes.                   | Histogram   |
| ✅   | http.server.response.success.count  | http_server_response_success_count_total  | Total number of all successful responses. | Counter     |
| ✅   | http.server.response.error.count    | http_server_response_error_count_total    | Total number of server error responses.   | Counter     |
| ✅   | http.client.request.error.count     | http_client_request_error_count_total     | Total number of client error requests.    | Counter     |

## Prometheus Metrics

When `metricExporter` is defined in otel SDK with a `PrometheusExporter`it will start a new process on port `8081` (default port) and metrics will be available at `http://localhost:8081/metrics`.

## Using with a logger

### Pino with instrumentation

This approach uses otel instrumentation to automatically inject spanId and traceId.

```ts
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';

const otelSDK = new NodeSDK({
  instrumentations: [new PinoInstrumentation()],
});
```

### Pino with custom formatter

This approach uses the global trace context for injecting SpanId and traceId as a property of your structured log.

```ts
import Pino, { Logger } from 'pino';
import { LoggerOptions } from 'pino';
import { trace, context } from '@opentelemetry/api';

export const loggerOptions: LoggerOptions = {
  formatters: {
    log(object) {
      const span = trace.getSpan(context.active());
      if (!span) return { ...object };
      const { spanId, traceId } = trace.getSpan(context.active())?.spanContext();
      return { ...object, spanId, traceId };
    },
  },
};

export const logger: Logger = Pino(loggerOptions);
```

## Stargazers over time

[![Stargazers over time](https://starchart.cc/pragmaticivan/nestjs-otel.svg)](https://starchart.cc/pragmaticivan/nestjs-otel)
