/**
 * Goal Planner - Planning to achieve goals
 */

import type { Skill } from './index.js';

/**
 * Goal definition
 */
export interface Goal {
  name: string;
  description?: string;
  conditions: string[];
  priority?: number;
  deadline?: number;
  achieved?: boolean;
}

/**
 * Action in a plan
 */
export interface Action {
  skill: Skill;
  parameters: Record<string, any>;
  preconditions: string[];
  effects: string[];
  cost: number;
}

/**
 * Plan to achieve a goal
 */
export interface Plan {
  goal: Goal;
  actions: Action[];
  totalCost: number;
  estimatedDuration: number;
  confidence: number;
  alternatives: Plan[];
}

/**
 * Planning context
 */
export interface PlanningContext {
  goal: Goal;
  initialState: Record<string, any>;
  actions: Skill[];
  constraints: string[];
  heuristic?: (state: Record<string, any>, goal: Goal) => number;
  resources?: Record<string, number>;
}

/**
 * Planning node for search
 */
interface PlanningNode {
  state: Record<string, any>;
  actions: Action[];
  cost: number;
  heuristic: number;
}

/**
 * Goal planner using A* search
 */
export class GoalPlanner {
  /**
   * Plan to achieve a goal
   */
  async plan(context: PlanningContext): Promise<Plan> {
    // Convert skills to actions
    const availableActions = context.actions.map((skill) => this.skillToAction(skill));

    // Perform A* search
    const solution = this.aStarSearch(context.initialState, context.goal, availableActions, context.heuristic);

    if (!solution) {
      // Return empty plan if no solution found
      return {
        goal: context.goal,
        actions: [],
        totalCost: Infinity,
        estimatedDuration: 0,
        confidence: 0,
        alternatives: [],
      };
    }

    // Calculate total cost and duration
    const totalCost = solution.actions.reduce((sum, action) => sum + action.cost, 0);
    const estimatedDuration = solution.actions.length * 1000; // 1 second per action

    // Generate alternatives
    const alternatives = await this.generateAlternatives(context, solution.actions);

    return {
      goal: context.goal,
      actions: solution.actions,
      totalCost,
      estimatedDuration,
      confidence: this.calculatePlanConfidence(solution.actions, context.goal),
      alternatives,
    };
  }

  /**
   * Validate a plan
   */
  validatePlan(plan: Plan, initialState: Record<string, any>): boolean {
    let state = { ...initialState };

    for (const action of plan.actions) {
      // Check preconditions
      if (!this.checkConditions(action.preconditions, state)) {
        return false;
      }

      // Apply effects
      state = this.applyEffects(action.effects, state);
    }

    // Check if goal conditions are met
    return this.checkConditions(plan.goal.conditions, state);
  }

  /**
   * Replan if current plan fails
   */
  async replan(context: PlanningContext, failedAction: Action, currentState: Record<string, any>): Promise<Plan> {
    // Update initial state to current state
    const newContext = {
      ...context,
      initialState: currentState,
    };

    // Remove failed action from available actions
    const filteredActions = context.actions.filter((skill) => skill.id !== failedAction.skill.id);
    newContext.actions = filteredActions;

    return this.plan(newContext);
  }

  /**
   * Private: Convert skill to action
   */
  private skillToAction(skill: Skill): Action {
    return {
      skill,
      parameters: {},
      preconditions: skill.preconditions,
      effects: skill.effects,
      cost: skill.cost ?? 1,
    };
  }

  /**
   * Private: A* search algorithm
   */
  private aStarSearch(
    initialState: Record<string, any>,
    goal: Goal,
    actions: Action[],
    heuristic?: (state: Record<string, any>, goal: Goal) => number
  ): PlanningNode | null {
    const openSet: PlanningNode[] = [
      {
        state: initialState,
        actions: [],
        cost: 0,
        heuristic: heuristic ? heuristic(initialState, goal) : this.defaultHeuristic(initialState, goal),
      },
    ];

    const closedSet = new Set<string>();
    const maxIterations = 1000;
    let iterations = 0;

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // Get node with lowest f = cost + heuristic
      openSet.sort((a, b) => a.cost + a.heuristic - (b.cost + b.heuristic));
      const current = openSet.shift()!;

      // Check if goal is achieved
      if (this.checkConditions(goal.conditions, current.state)) {
        return current;
      }

      // Mark as visited
      const stateKey = this.serializeState(current.state);
      if (closedSet.has(stateKey)) {
        continue;
      }
      closedSet.add(stateKey);

      // Expand neighbors
      for (const action of actions) {
        // Check if action is applicable
        if (this.checkConditions(action.preconditions, current.state)) {
          // Apply action
          const newState = this.applyEffects(action.effects, current.state);
          const newNode: PlanningNode = {
            state: newState,
            actions: [...current.actions, action],
            cost: current.cost + action.cost,
            heuristic: heuristic ? heuristic(newState, goal) : this.defaultHeuristic(newState, goal),
          };

          // Add to open set if not visited
          const newStateKey = this.serializeState(newState);
          if (!closedSet.has(newStateKey)) {
            openSet.push(newNode);
          }
        }
      }
    }

    return null; // No solution found
  }

  /**
   * Private: Check if conditions are satisfied
   */
  private checkConditions(conditions: string[], state: Record<string, any>): boolean {
    for (const condition of conditions) {
      // Simple string matching for now
      if (!this.evaluateCondition(condition, state)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Private: Evaluate a single condition
   */
  private evaluateCondition(condition: string, state: Record<string, any>): boolean {
    // Parse condition (very simple parser)
    const parts = condition.split('=');
    if (parts.length === 2) {
      const key = parts[0]!.trim();
      const value = parts[1]!.trim();
      return String(state[key]) === value;
    }

    // Check if key exists
    return condition in state;
  }

  /**
   * Private: Apply effects to state
   */
  private applyEffects(effects: string[], state: Record<string, any>): Record<string, any> {
    const newState = { ...state };

    for (const effect of effects) {
      // Parse effect (e.g., "key=value")
      const parts = effect.split('=');
      if (parts.length === 2) {
        const key = parts[0]!.trim();
        const value = parts[1]!.trim();
        newState[key] = value;
      } else {
        // Boolean effect
        newState[effect] = true;
      }
    }

    return newState;
  }

  /**
   * Private: Serialize state for comparison
   */
  private serializeState(state: Record<string, any>): string {
    return JSON.stringify(state);
  }

  /**
   * Private: Default heuristic (number of unsatisfied goal conditions)
   */
  private defaultHeuristic(state: Record<string, any>, goal: Goal): number {
    let unsatisfied = 0;

    for (const condition of goal.conditions) {
      if (!this.evaluateCondition(condition, state)) {
        unsatisfied++;
      }
    }

    return unsatisfied;
  }

  /**
   * Private: Calculate plan confidence
   */
  private calculatePlanConfidence(actions: Action[], goal: Goal): number {
    if (actions.length === 0) return 0;

    // Simple confidence based on plan length (shorter is better)
    const lengthScore = Math.max(0, 1 - actions.length / 20);

    // All conditions should be satisfied
    const completeness = 1.0;

    return (lengthScore + completeness) / 2;
  }

  /**
   * Private: Generate alternative plans
   */
  private async generateAlternatives(_context: PlanningContext, _mainPlan: Action[]): Promise<Plan[]> {
    // Simplified: no alternatives for now
    return [];
  }
}

/**
 * Hierarchical Task Network (HTN) planner
 */
export class HTNPlanner {
  private methods: Map<string, TaskMethod[]> = new Map();

  /**
   * Add a task decomposition method
   */
  addMethod(taskName: string, method: TaskMethod): void {
    if (!this.methods.has(taskName)) {
      this.methods.set(taskName, []);
    }
    this.methods.get(taskName)!.push(method);
  }

  /**
   * Plan using HTN
   */
  async plan(task: Task, initialState: Record<string, any>): Promise<Action[]> {
    return this.decompose(task, initialState);
  }

  /**
   * Private: Decompose task into actions
   */
  private decompose(task: Task, state: Record<string, any>): Action[] {
    // If task is primitive, return its action
    if (task.primitive) {
      return [task.action!];
    }

    // Get methods for this task
    const methods = this.methods.get(task.name) || [];

    // Try each method
    for (const method of methods) {
      // Check if method is applicable
      if (this.checkConditions(method.preconditions, state)) {
        // Decompose subtasks
        const actions: Action[] = [];
        let currentState = { ...state };

        for (const subtask of method.subtasks) {
          const subtaskActions = this.decompose(subtask, currentState);
          actions.push(...subtaskActions);

          // Update state
          for (const action of subtaskActions) {
            currentState = this.applyEffects(action.effects, currentState);
          }
        }

        return actions;
      }
    }

    // No applicable method found
    return [];
  }

  /**
   * Private: Check conditions (same as GoalPlanner)
   */
  private checkConditions(conditions: string[], state: Record<string, any>): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, state)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Private: Evaluate condition
   */
  private evaluateCondition(condition: string, state: Record<string, any>): boolean {
    const parts = condition.split('=');
    if (parts.length === 2) {
      const key = parts[0]!.trim();
      const value = parts[1]!.trim();
      return String(state[key]) === value;
    }
    return condition in state;
  }

  /**
   * Private: Apply effects
   */
  private applyEffects(effects: string[], state: Record<string, any>): Record<string, any> {
    const newState = { ...state };

    for (const effect of effects) {
      const parts = effect.split('=');
      if (parts.length === 2) {
        const key = parts[0]!.trim();
        const value = parts[1]!.trim();
        newState[key] = value;
      } else {
        newState[effect] = true;
      }
    }

    return newState;
  }
}

/**
 * Task for HTN planning
 */
export interface Task {
  name: string;
  primitive: boolean;
  action?: Action;
}

/**
 * Task method for HTN
 */
export interface TaskMethod {
  name: string;
  preconditions: string[];
  subtasks: Task[];
}
