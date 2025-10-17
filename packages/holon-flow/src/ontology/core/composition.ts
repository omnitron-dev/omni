/**
 * Component Composition System - LEGO-like Component Assembly
 *
 * This module provides the core composition engine that enforces
 * ontological compatibility at both compile-time and runtime.
 *
 * Philosophy:
 * - Components are like LEGO bricks - they only connect if compatible
 * - Compatibility is multi-dimensional: types, protocols, capabilities
 * - The system guides developers toward correct compositions
 *
 * @module ontology/core/composition
 */

import type { Brand } from './brand-types.js';
import type { Protocol, ProtocolName } from './protocols.js';
import type { CapabilitySet, CapabilityRequirements, Capability } from './capabilities.js';
import { capabilitySet, requirements, canCompose } from './capabilities.js';
import { isProtocolCompatible, protocolTransformer } from './protocols.js';

/**
 * Component - A composable unit with ontological constraints
 */
export interface Component<In = any, Out = any> {
  readonly id: string;
  readonly name: string;
  readonly version: string;

  // Type information
  readonly inputType: TypeDescriptor;
  readonly outputType: TypeDescriptor;

  // Protocol constraints
  readonly inputProtocol: ProtocolName;
  readonly outputProtocol: ProtocolName;

  // Capability constraints
  readonly capabilities: CapabilitySet;
  readonly requirements: CapabilityRequirements;

  // Execution
  execute(input: In, context: ExecutionContext): Out | Promise<Out>;

  // Metadata
  readonly metadata: ComponentMetadata;
}

/**
 * Type Descriptor - Runtime type information
 */
export interface TypeDescriptor {
  readonly name: string;
  readonly brand?: string;
  readonly shape?: Record<string, TypeDescriptor>;
  readonly validate?: (value: any) => boolean;
}

/**
 * Component Metadata
 */
export interface ComponentMetadata {
  description?: string;
  author?: string;
  tags?: string[];
  documentation?: string;
  examples?: any[];
  deprecated?: boolean;
  experimental?: boolean;
}

/**
 * Execution Context
 */
export interface ExecutionContext {
  readonly correlationId: string;
  readonly timestamp: number;
  readonly environment: Record<string, any>;
  readonly logger?: Logger;
  readonly metrics?: MetricsCollector;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
}

/**
 * Metrics Collector interface
 */
export interface MetricsCollector {
  counter(name: string, value?: number): void;
  gauge(name: string, value: number): void;
  histogram(name: string, value: number): void;
  timing(name: string, duration: number): void;
}

/**
 * Composition Error - Thrown when incompatible components are composed
 */
export class CompositionError extends Error {
  constructor(
    message: string,
    public readonly from: Component,
    public readonly to: Component,
    public readonly reason: CompositionFailureReason
  ) {
    super(message);
    this.name = 'CompositionError';
  }
}

/**
 * Composition Failure Reason
 */
export interface CompositionFailureReason {
  type: 'type-mismatch' | 'protocol-mismatch' | 'capability-mismatch' | 'semantic-mismatch';
  details: string;
  suggestion?: string;
}

/**
 * Composition Validator
 */
export class CompositionValidator {
  /**
   * Validate if two components can be composed
   */
  validate(from: Component, to: Component): CompositionValidationResult {
    const errors: CompositionFailureReason[] = [];

    // 1. Type compatibility
    if (!this.isTypeCompatible(from.outputType, to.inputType)) {
      errors.push({
        type: 'type-mismatch',
        details: `Output type '${from.outputType.name}' is not compatible with input type '${to.inputType.name}'`,
        suggestion: 'Add a type transformer component between them',
      });
    }

    // 2. Protocol compatibility
    if (!isProtocolCompatible(from.outputProtocol, to.inputProtocol)) {
      errors.push({
        type: 'protocol-mismatch',
        details: `Output protocol '${from.outputProtocol}' is not compatible with input protocol '${to.inputProtocol}'`,
        suggestion: 'Add a protocol adapter component between them',
      });
    }

    // 3. Capability compatibility
    if (!from.capabilities.satisfies(to.requirements)) {
      const missing = this.getMissingCapabilities(from.capabilities, to.requirements);
      errors.push({
        type: 'capability-mismatch',
        details: `Missing required capabilities: ${missing.join(', ')}`,
        suggestion: 'Ensure the first component provides all required capabilities',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check type compatibility
   */
  private isTypeCompatible(output: TypeDescriptor, input: TypeDescriptor): boolean {
    // Same name and brand
    if (output.name === input.name && output.brand === input.brand) {
      return true;
    }

    // Structural compatibility (if shapes are defined)
    if (output.shape && input.shape) {
      return this.isShapeCompatible(output.shape, input.shape);
    }

    // Use validators if available
    if (input.validate && output.validate) {
      // Can't fully validate at this point, but we can check metadata
      return true;
    }

    return false;
  }

  /**
   * Check shape compatibility
   */
  private isShapeCompatible(
    output: Record<string, TypeDescriptor>,
    input: Record<string, TypeDescriptor>
  ): boolean {
    // All required input fields must be present in output
    for (const [key, inputType] of Object.entries(input)) {
      const outputType = output[key];
      if (!outputType) {
        return false;
      }

      if (!this.isTypeCompatible(outputType, inputType)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get missing capabilities
   */
  private getMissingCapabilities(provided: CapabilitySet, required: CapabilityRequirements): string[] {
    const missing: string[] = [];

    for (const req of required.required) {
      if (!provided.has(req)) {
        missing.push(req);
      }
    }

    return missing;
  }
}

/**
 * Composition Validation Result
 */
export interface CompositionValidationResult {
  valid: boolean;
  errors: CompositionFailureReason[];
}

/**
 * Component Composer - Safely compose components
 */
export class ComponentComposer {
  private validator = new CompositionValidator();

  /**
   * Compose two components into a pipeline
   */
  compose<A, B, C>(from: Component<A, B>, to: Component<B, C>): ComposedComponent<A, C> {
    // Validate composition
    const validation = this.validator.validate(from, to);

    if (!validation.valid) {
      const error = validation.errors[0];
      throw new CompositionError(
        `Cannot compose '${from.name}' with '${to.name}': ${error.details}`,
        from,
        to,
        error
      );
    }

    // Create composed component
    return new ComposedComponent(from, to);
  }

  /**
   * Safely compose with automatic adaptation
   */
  composeWithAdaptation<A, B, C>(from: Component<A, B>, to: Component<B, C>): ComposedComponent<A, C> | null {
    // Try direct composition
    const validation = this.validator.validate(from, to);

    if (validation.valid) {
      return this.compose(from, to);
    }

    // Try to find adapters
    for (const error of validation.errors) {
      if (error.type === 'protocol-mismatch') {
        // Try protocol adaptation
        const adapted = protocolTransformer.transform(
          { __protocol: from.outputProtocol } as any,
          to.inputProtocol
        );

        if (adapted) {
          // Create adapter component and compose
          const adapter = this.createProtocolAdapter(from.outputProtocol, to.inputProtocol);
          return this.compose(this.compose(from, adapter as any), to);
        }
      }
    }

    return null;
  }

  /**
   * Compose multiple components into a pipeline
   */
  composePipeline<T extends Component[]>(...components: T): ComposedComponent<any, any> {
    if (components.length === 0) {
      throw new Error('Cannot compose empty pipeline');
    }

    if (components.length === 1) {
      return components[0] as any;
    }

    let composed = this.compose(components[0], components[1]);

    for (let i = 2; i < components.length; i++) {
      composed = this.compose(composed, components[i]) as any;
    }

    return composed;
  }

  /**
   * Create a protocol adapter component
   */
  private createProtocolAdapter(from: ProtocolName, to: ProtocolName): Component {
    return {
      id: `adapter:${from}:${to}`,
      name: `Protocol Adapter (${from} → ${to})`,
      version: '1.0.0',
      inputType: { name: 'any' },
      outputType: { name: 'any' },
      inputProtocol: from,
      outputProtocol: to,
      capabilities: capabilitySet([]),
      requirements: requirements([]),
      execute: async (input: any) => {
        const result = protocolTransformer.transform({ __protocol: from, value: input } as any, to);
        return result ? (result as any).value : input;
      },
      metadata: {
        description: `Adapts from ${from} protocol to ${to} protocol`,
      },
    };
  }
}

/**
 * Composed Component - Result of composing two components
 */
export class ComposedComponent<In, Out> implements Component<In, Out> {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly inputType: TypeDescriptor;
  readonly outputType: TypeDescriptor;
  readonly inputProtocol: ProtocolName;
  readonly outputProtocol: ProtocolName;
  readonly capabilities: CapabilitySet;
  readonly requirements: CapabilityRequirements;
  readonly metadata: ComponentMetadata;

  constructor(
    private readonly first: Component<In, any>,
    private readonly second: Component<any, Out>
  ) {
    this.id = `composed:${first.id}:${second.id}`;
    this.name = `${first.name} → ${second.name}`;
    this.version = `${first.version}+${second.version}`;
    this.inputType = first.inputType;
    this.outputType = second.outputType;
    this.inputProtocol = first.inputProtocol;
    this.outputProtocol = second.outputProtocol;

    // Merge capabilities
    this.capabilities = first.capabilities.merge(second.capabilities);

    // Use first component's requirements
    this.requirements = first.requirements;

    // Merge metadata
    this.metadata = {
      description: `Composition of ${first.name} and ${second.name}`,
      tags: [...(first.metadata.tags || []), ...(second.metadata.tags || [])],
    };
  }

  async execute(input: In, context: ExecutionContext): Promise<Out> {
    context.logger?.debug(`Executing composed component: ${this.name}`, { correlationId: context.correlationId });

    const startTime = Date.now();

    try {
      // Execute first component
      const intermediate = await this.first.execute(input, context);

      // Execute second component
      const output = await this.second.execute(intermediate, context);

      const duration = Date.now() - startTime;
      context.metrics?.timing(`component.${this.id}.duration`, duration);

      return output;
    } catch (error) {
      context.logger?.error(`Error executing composed component: ${this.name}`, {
        error,
        correlationId: context.correlationId,
      });
      throw error;
    }
  }

  /**
   * Get the composition chain
   */
  getChain(): Component[] {
    const chain: Component[] = [];

    if (this.first instanceof ComposedComponent) {
      chain.push(...this.first.getChain());
    } else {
      chain.push(this.first);
    }

    if (this.second instanceof ComposedComponent) {
      chain.push(...this.second.getChain());
    } else {
      chain.push(this.second);
    }

    return chain;
  }

  /**
   * Visualize the composition
   */
  visualize(): string {
    const chain = this.getChain();
    return chain.map((c) => c.name).join(' → ');
  }
}

/**
 * Component Builder - Fluent API for building components
 */
export class ComponentBuilder<In = any, Out = any> {
  private id?: string;
  private name?: string;
  private version = '1.0.0';
  private inputType?: TypeDescriptor;
  private outputType?: TypeDescriptor;
  private inputProtocol?: ProtocolName;
  private outputProtocol?: ProtocolName;
  private capabilitiesList: Capability[] = [];
  private requirementsList: string[] = [];
  private executeFn?: (input: In, context: ExecutionContext) => Out | Promise<Out>;
  private metadataObj: ComponentMetadata = {};

  setId(id: string): this {
    this.id = id;
    return this;
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setVersion(version: string): this {
    this.version = version;
    return this;
  }

  setInputType(type: TypeDescriptor): this {
    this.inputType = type;
    return this;
  }

  setOutputType(type: TypeDescriptor): this {
    this.outputType = type;
    return this;
  }

  setInputProtocol(protocol: ProtocolName): this {
    this.inputProtocol = protocol;
    return this;
  }

  setOutputProtocol(protocol: ProtocolName): this {
    this.outputProtocol = protocol;
    return this;
  }

  addCapability(capability: Capability): this {
    this.capabilitiesList.push(capability);
    return this;
  }

  addRequirement(requirement: string): this {
    this.requirementsList.push(requirement);
    return this;
  }

  setExecute(fn: (input: In, context: ExecutionContext) => Out | Promise<Out>): this {
    this.executeFn = fn;
    return this;
  }

  setMetadata(metadata: ComponentMetadata): this {
    this.metadataObj = metadata;
    return this;
  }

  build(): Component<In, Out> {
    if (!this.id) throw new Error('Component id is required');
    if (!this.name) throw new Error('Component name is required');
    if (!this.inputType) throw new Error('Input type is required');
    if (!this.outputType) throw new Error('Output type is required');
    if (!this.inputProtocol) throw new Error('Input protocol is required');
    if (!this.outputProtocol) throw new Error('Output protocol is required');
    if (!this.executeFn) throw new Error('Execute function is required');

    return {
      id: this.id,
      name: this.name,
      version: this.version,
      inputType: this.inputType,
      outputType: this.outputType,
      inputProtocol: this.inputProtocol,
      outputProtocol: this.outputProtocol,
      capabilities: capabilitySet(this.capabilitiesList),
      requirements: requirements(this.requirementsList),
      execute: this.executeFn,
      metadata: this.metadataObj,
    };
  }
}

/**
 * Create a component builder
 */
export function component<In = any, Out = any>(): ComponentBuilder<In, Out> {
  return new ComponentBuilder<In, Out>();
}

/**
 * Global component composer instance
 */
export const composer = new ComponentComposer();
