import {
  DynamicModule,
  Global,
  Inject,
  Logger,
  MiddlewareConsumer,
  Module,
  OnApplicationBootstrap,
  Provider,
  Type,
} from '@nestjs/common';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import {
  OpenTelemetryModuleAsyncOptions,
  OpenTelemetryModuleOptions,
  OpenTelemetryOptionsFactory,
} from './interfaces';
import { MetricService } from './metrics/metric.service';
import { ApiMetricsMiddleware } from './middleware';
import { OPENTELEMETRY_MODULE_OPTIONS } from './opentelemetry.constants';
import { TraceService } from './tracing/trace.service';
import { HttpAdapterHost } from '@nestjs/core';
import { getMiddlewareMountPoint } from './middleware.utils';

/**
 * The internal OpenTelemetry Module which handles the integration
 * with the third party OpenTelemetry library and Nest
 *
 * @internal
 */
@Global()
@Module({})
export class OpenTelemetryCoreModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('OpenTelemetryModule');

  constructor(
    @Inject(OPENTELEMETRY_MODULE_OPTIONS) private readonly options: OpenTelemetryModuleOptions = {},
    private readonly adapterHost: HttpAdapterHost
  ) {}

  /**
   * Bootstraps the internal OpenTelemetry Module with the given options
   * synchronously and sets the correct providers
   * @param options The options to bootstrap the module synchronously
   */
  static forRoot(options: OpenTelemetryModuleOptions = {}): DynamicModule {
    const openTelemetryModuleOptions = {
      provide: OPENTELEMETRY_MODULE_OPTIONS,
      useValue: options,
    };

    return {
      module: OpenTelemetryCoreModule,
      providers: [openTelemetryModuleOptions, TraceService, MetricService],
      exports: [TraceService, MetricService],
    };
  }

  /**
   * Bootstraps the internal OpenTelemetry Module with the given
   * options asynchronously and sets the correct providers
   * @param options The options to bootstrap the module
   */
  static forRootAsync(options: OpenTelemetryModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);
    return {
      module: OpenTelemetryCoreModule,
      imports: [...(options.imports || [])],
      providers: [...asyncProviders, TraceService, MetricService],
      exports: [TraceService, MetricService],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    const { apiMetrics = { enable: false } } = this.options?.metrics ?? {};

    if (apiMetrics.enable === true) {
      const adapter = this.adapterHost.httpAdapter;
      const mountPoint = getMiddlewareMountPoint(adapter);
      if (apiMetrics?.ignoreRoutes && apiMetrics?.ignoreRoutes.length > 0) {
        consumer
          .apply(ApiMetricsMiddleware)
          .exclude(...apiMetrics.ignoreRoutes)
          .forRoutes(mountPoint);
      } else {
        consumer.apply(ApiMetricsMiddleware).forRoutes(mountPoint);
      }
    }
  }

  async onApplicationBootstrap() {
    let hostMetrics: boolean = false;

    if (this.options?.metrics) {
      hostMetrics =
        this.options.metrics.hostMetrics !== undefined ? this.options.metrics.hostMetrics : false;
    }

    const meterProvider = metrics.getMeterProvider() as MeterProvider;

    if (hostMetrics) {
      const host = new HostMetrics({ meterProvider, name: 'host-metrics' });
      host.start();
    }
  }

  /**
   * Returns the asynchrnous OpenTelemetry options providers depending on the
   * given module options
   * @param options Options for the asynchrnous OpenTelemetry module
   */
  private static createAsyncOptionsProvider(options: OpenTelemetryModuleAsyncOptions): Provider {
    if (options.useFactory) {
      return {
        provide: OPENTELEMETRY_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    if (options.useClass || options.useExisting) {
      const inject = [
        (options.useClass || options.useExisting) as Type<OpenTelemetryOptionsFactory>,
      ];
      return {
        provide: OPENTELEMETRY_MODULE_OPTIONS,
        useFactory: async (optionsFactory: OpenTelemetryOptionsFactory) =>
          optionsFactory.createOpenTelemetryOptions(),
        inject,
      };
    }

    throw new Error();
  }

  /**
   * Returns the asynchrnous providers depending on the given module
   * options
   * @param options Options for the asynchrnous OpenTelemetry module
   */
  private static createAsyncProviders(options: OpenTelemetryModuleAsyncOptions): Provider[] {
    if (options.useFactory || options.useExisting) {
      return [this.createAsyncOptionsProvider(options)];
    }
    const useClass = options.useClass as Type<OpenTelemetryOptionsFactory>;
    return [
      this.createAsyncOptionsProvider(options),
      {
        provide: useClass,
        useClass,
      },
    ];
  }
}
