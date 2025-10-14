/**
 * Dependency Injection System
 *
 * Lightweight, frontend-focused DI for Aether
 */

// Types
export type {
  ProviderScope,
  Type,
  AbstractType,
  InjectableToken,
  InjectionTokenType,
  Provider,
  ClassProvider,
  ValueProvider,
  FactoryProvider,
  ExistingProvider,
  InjectableOptions,
  InjectOptions,
  ModuleDefinition,
  ModuleMetadata,
  ModuleWithProviders,
  Module,
  Injector,
  Container,
  StoreFactory,
  RouteDefinition,
  IslandDefinition,
  AssetDefinition,
  SetupContext,
  ModuleContext,
  ModuleSetup,
  ModuleTeardown,
  TeardownContext,
  OptimizationHints,
  LoadedModule,
  ModuleNode,
  SplitPoint,
} from './types.js';

// Tokens
export { InjectionToken, createInjectionToken } from './tokens.js';

// Container
export { DIContainer, getRootInjector, resetRootInjector } from './container.js';

// Inject
export { inject, Inject, Optional, Self, SkipSelf, setInjectorContext, getInjectorContext } from './inject.js';

// Injectable
export { Injectable, injectable, isInjectable, getInjectableOptions } from './injectable.js';

// Module
export { defineModule, withProviders, compileModule, bootstrapModule } from './module.js';

// Scope
export { ScopeManager, getDefaultScope } from './scope.js';
