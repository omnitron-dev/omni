#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';
import { initializeOrchestron, OrchestronTools } from './index.js';
import { OrchestronEngine } from './core/engine.js';
import { UnifiedOrchestron } from './core/unified-orchestron.js';
import {
  DevelopmentNodeType,
  FileChange,
  TaskStatus,
  Priority,
  TaskNode,
  SprintNode,
} from './core/types.js';

const program = new Command();
let engine: OrchestronEngine | null = null;
let unifiedOrchestron: UnifiedOrchestron | null = null;

async function getEngine(): Promise<OrchestronEngine> {
  if (!engine) {
    const configPath = path.join(process.cwd(), '.orchestron');

    if (!fs.existsSync(configPath)) {
      fs.mkdirSync(configPath, { recursive: true });
    }

    engine = await initializeOrchestron({
      storagePath: path.join(configPath, 'orchestron.db'),
      autoTrack: true,
    });

    console.log(chalk.dim('Orchestron v3.0 initialized at', configPath));
  }
  return engine;
}

async function getUnifiedOrchestron(): Promise<UnifiedOrchestron> {
  if (!unifiedOrchestron) {
    const eng = await getEngine();
    const storage = (eng as any).storage;
    unifiedOrchestron = new UnifiedOrchestron(storage);
  }
  return unifiedOrchestron;
}

// Format task ID
function formatTaskId(id: string): string {
  return `TASK-${id.slice(0, 6).toUpperCase()}`;
}

// Format sprint ID
function formatSprintId(id: string): string {
  return `SPRINT-${id.slice(0, 6).toUpperCase()}`;
}

// Helper function to access task properties
function getTaskProps(task: TaskNode) {
  return {
    id: task.nodeId,
    title: task.payload.title,
    description: task.payload.description,
    status: task.payload.status,
    priority: task.payload.priority,
    assignee: task.payload.assignee,
    progress: task.payload.progress || 0,
    estimatedHours: task.payload.estimatedHours,
    actualHours: task.payload.actualHours,
    dueDate: task.payload.dueDate,
    labels: task.payload.labels || [],
    sprint: task.payload.sprint,
  };
}

// Helper function to access sprint properties
function getSprintProps(sprint: SprintNode) {
  return {
    id: sprint.nodeId,
    name: sprint.payload.name,
    goal: sprint.payload.goal,
    startDate: sprint.payload.startDate,
    endDate: sprint.payload.endDate,
    velocity: sprint.payload.velocity,
    capacity: sprint.payload.capacity,
    committedTasks: sprint.payload.committedTasks || [],
    completedTasks: sprint.payload.completedTasks || [],
  };
}

program
  .name('orchestron')
  .description('Orchestron v3.0 - Development Orchestration System')
  .version('3.0.0');

// ============= TASK MANAGEMENT COMMANDS =============

// Create task command
program
  .command('task')
  .description('Task management commands')
  .command('create <title>')
  .description('Create a new task')
  .option('-p, --priority <priority>', 'Priority (CRITICAL|HIGH|MEDIUM|LOW)', 'MEDIUM')
  .option('-a, --assignee <assignee>', 'Assignee')
  .option('-d, --description <desc>', 'Description')
  .option('-e, --estimate <hours>', 'Estimated hours', parseInt)
  .option('-l, --labels <labels...>', 'Labels')
  .option('--parent <parentId>', 'Parent task ID')
  .option('--due <date>', 'Due date')
  .action(async (title, options) => {
    try {
      const csp = await getUnifiedOrchestron();

      const task = await csp.createTask({
        title,
        description: options.description,
        priority: options.priority as Priority,
        assignee: options.assignee,
        estimatedHours: options.estimate,
        labels: options.labels,
        parent: options.parent,
        dueDate: options.due ? new Date(options.due) : undefined,
      });

      const props = getTaskProps(task);
      console.log(chalk.green('✓'), `Task created: ${formatTaskId(props.id)}`);
      console.log(chalk.dim('  Title:'), props.title);
      if (props.assignee) {
        console.log(chalk.dim('  Assignee:'), props.assignee);
      }

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// List tasks command
program
  .command('task')
  .command('list')
  .description('List tasks')
  .option('-s, --status <status>', 'Filter by status')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('--mine', 'Show only my tasks')
  .option('-p, --priority <priority>', 'Filter by priority')
  .option('--sprint <sprintId>', 'Filter by sprint')
  .action(async (options) => {
    try {
      const csp = await getUnifiedOrchestron();

      const filter: any = {};
      if (options.status) filter.status = options.status;
      if (options.assignee) filter.assignee = options.assignee;
      if (options.mine) filter.assignee = process.env.USER || 'me';
      if (options.priority) filter.priority = options.priority;
      if (options.sprint) filter.sprint = options.sprint;

      const tasks = await csp.searchTasks(filter);

      if (tasks.length === 0) {
        console.log('No tasks found');
        return;
      }

      console.log(chalk.bold(`📝 Tasks (${tasks.length}):`));
      for (const task of tasks) {
        const props = getTaskProps(task);
        const id = formatTaskId(props.id);
        const status = chalk.cyan(props.status);
        const priority = props.priority === Priority.HIGH ? chalk.red(props.priority) :
          props.priority === Priority.CRITICAL ? chalk.magenta(props.priority) :
            chalk.yellow(props.priority);

        console.log(
          `  ${priority}`,
          chalk.dim(id),
          props.title,
          status,
          props.progress ? `(${props.progress}%)` : ''
        );

        if (props.assignee) {
          console.log(chalk.dim(`     Assigned to: ${props.assignee}`));
        }
      }

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Update task command
program
  .command('task')
  .command('update <taskId>')
  .description('Update task')
  .option('-s, --status <status>', 'New status')
  .option('-p, --progress <percent>', 'Progress percentage', parseInt)
  .option('-a, --assignee <assignee>', 'New assignee')
  .action(async (taskId, options) => {
    try {
      const csp = await getUnifiedOrchestron();

      if (options.status) {
        await csp.updateTaskStatus(taskId, options.status as TaskStatus);
        console.log(chalk.green('✓'), `Task ${formatTaskId(taskId)} status updated to ${options.status}`);
      }

      if (options.progress !== undefined) {
        await csp.updateTaskProgress(taskId, options.progress);
        console.log(chalk.green('✓'), `Task ${formatTaskId(taskId)} progress updated to ${options.progress}%`);
      }

      if (options.assignee) {
        await csp.assignTask(taskId, options.assignee);
        console.log(chalk.green('✓'), `Task ${formatTaskId(taskId)} assigned to ${options.assignee}`);
      }

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Assign task command
program
  .command('task')
  .command('assign <taskId> <assignee>')
  .description('Assign task to someone')
  .action(async (taskId, assignee) => {
    try {
      const csp = await getUnifiedOrchestron();
      await csp.assignTask(taskId, assignee);
      console.log(chalk.green('✓'), `Task ${formatTaskId(taskId)} assigned to ${assignee}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Add dependency command
program
  .command('task')
  .command('depend <taskId>')
  .description('Add task dependency')
  .option('--on <dependencyId>', 'Task that this depends on')
  .action(async (taskId, options) => {
    try {
      const csp = await getUnifiedOrchestron();
      await csp.addDependency(taskId, options.on);
      console.log(chalk.green('✓'), `Task ${formatTaskId(taskId)} now depends on ${formatTaskId(options.on)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// ============= TODO MANAGEMENT COMMANDS =============

// Quick TODO command
program
  .command('todo <text>')
  .description('Add quick TODO')
  .option('-c, --context <context>', 'Context (e.g., component name)')
  .action(async (text, options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const todo = await csp.addTodo(text, options.context);
      const props = getTaskProps(todo);
      console.log(chalk.green('✓'), `TODO added: ${formatTaskId(props.id)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// List TODOs command
program
  .command('todo')
  .command('list')
  .description('List TODOs')
  .option('-c, --context <context>', 'Filter by context')
  .action(async (options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const todos = await csp.getTodos();

      if (todos.length === 0) {
        console.log('No TODOs found');
        return;
      }

      console.log(chalk.bold(`📌 TODOs (${todos.length}):`));
      for (const todo of todos) {
        const props = getTaskProps(todo);
        console.log(`  • ${props.title}`, chalk.dim(`(${formatTaskId(props.id)})`));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Convert TODO to task
program
  .command('todo')
  .command('convert <todoId>')
  .description('Convert TODO to task')
  .option('--to-task', 'Convert to task (default)')
  .option('-p, --priority <priority>', 'Task priority')
  .action(async (todoId, options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const task = await csp.convertTodoToTask(todoId, {
        title: 'Converted TODO',
        status: TaskStatus.TODO,
        priority: options.priority as Priority,
      });
      const props = getTaskProps(task);
      console.log(chalk.green('✓'), `TODO converted to task: ${formatTaskId(props.id)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// ============= SPRINT MANAGEMENT COMMANDS =============

// Create sprint
program
  .command('sprint')
  .command('create <name>')
  .description('Create new sprint')
  .option('-g, --goal <goal>', 'Sprint goal')
  .option('-d, --duration <days>', 'Duration in days', parseInt, 14)
  .action(async (name, options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const sprint = await csp.createSprint({
        name,
        goal: options.goal || '',
        startDate: new Date(),
        duration: options.duration,
      });
      const props = getSprintProps(sprint);
      console.log(chalk.green('✓'), `Sprint created: ${formatSprintId(props.id)}`);
      console.log(chalk.dim('  Name:'), props.name);
      console.log(chalk.dim('  Duration:'), `${options.duration} days`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Start sprint
program
  .command('sprint')
  .command('start <sprintId>')
  .description('Start a sprint')
  .action(async (sprintId) => {
    try {
      const csp = await getUnifiedOrchestron();
      await csp.startSprint(sprintId);
      console.log(chalk.green('✓'), `Sprint ${formatSprintId(sprintId)} started`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Add tasks to sprint
program
  .command('sprint')
  .command('add <taskIds...>')
  .description('Add tasks to current sprint')
  .option('-s, --sprint <sprintId>', 'Sprint ID (default: active sprint)')
  .action(async (taskIds, options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const activeSprint = csp.getActiveSprint();
      const sprintId = options.sprint || activeSprint;

      if (!sprintId) {
        console.error(chalk.red('No active sprint. Please specify --sprint or start a sprint first.'));
        process.exit(1);
      }

      for (const taskId of taskIds) {
        await csp.addToSprint(taskId, sprintId);
      }

      console.log(chalk.green('✓'), `Added ${taskIds.length} tasks to sprint ${formatSprintId(sprintId)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Sprint burndown
program
  .command('sprint')
  .command('burndown')
  .description('Show sprint burndown')
  .option('-s, --sprint <sprintId>', 'Sprint ID (default: active sprint)')
  .action(async (options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const activeSprint = csp.getActiveSprint();
      const sprintId = options.sprint || activeSprint;

      if (!sprintId) {
        console.error(chalk.red('No active sprint'));
        process.exit(1);
      }

      const chart = await csp.getBurndownChart(sprintId);
      console.log(chalk.bold('📈 Sprint Burndown:'));
      console.log(chart);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Sprint velocity
program
  .command('sprint')
  .command('velocity')
  .description('Show velocity trends')
  .option('--last <n>', 'Last N sprints', parseInt, 5)
  .action(async (options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const chart = await csp.getVelocityChart(options.last);
      console.log(chalk.bold('📊 Velocity Trend:'));
      console.log(chart);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// ============= QUICK NAVIGATION COMMANDS =============

// Goto command
program
  .command('goto <query>')
  .description('Quick navigation')
  .action(async (query) => {
    try {
      const csp = await getUnifiedOrchestron();
      const result = await csp.goto(query);

      if (!result) {
        console.log(chalk.yellow('No matches found for:'), query);
        return;
      }

      console.log(chalk.green('✓'), `Navigated to: ${result.nodeType} - ${result.payload?.title || result.nodeId}`);
      console.log(chalk.dim('  Path:'), result.payload?.path || result.nodeId);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Recent command
program
  .command('recent')
  .description('Show recent items')
  .option('-l, --limit <n>', 'Number of items', parseInt, 10)
  .action(async (options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const recent = await csp.getRecentNodes(options.limit);

      console.log(chalk.bold('🕐 Recent Items:'));
      for (const node of recent) {
        const timestamp = new Date(node.timestamp).toLocaleString();
        console.log(
          chalk.dim(node.nodeId.slice(0, 8)),
          chalk.yellow(node.nodeType),
          timestamp
        );
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Bookmarks command
program
  .command('bookmarks')
  .description('Manage bookmarks')
  .action(async () => {
    try {
      const csp = await getUnifiedOrchestron();
      const bookmarks = await csp.getBookmarks();

      if (bookmarks.length === 0) {
        console.log('No bookmarks set');
        return;
      }

      console.log(chalk.bold('🔖 Bookmarks:'));
      for (const bookmark of bookmarks) {
        console.log(`  ${bookmark.name}: ${bookmark.nodeId}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// ============= STATISTICS & ANALYTICS COMMANDS =============

// Stats command
program
  .command('stats')
  .description('Show current statistics')
  .action(async () => {
    try {
      const csp = await getUnifiedOrchestron();
      const stats = await csp.getStats();

      console.log(chalk.bold('📊 Current Statistics:'));
      console.log();

      console.log(chalk.cyan('Tasks:'));
      console.log(`  Total: ${stats.totalTasks}`);
      console.log(`  In Progress: ${stats.inProgress}`);
      console.log(`  Blocked: ${stats.blocked}`);
      console.log(`  Completed Today: ${stats.completedToday}`);
      console.log(`  Overdue: ${chalk.red(stats.overdue)}`);
      console.log();

      console.log(chalk.cyan('Velocity:'));
      console.log(`  Current: ${stats.velocity.toFixed(1)} points/day`);
      console.log(`  Cycle Time: ${stats.cycleTime.toFixed(1)} hours`);
      console.log(`  Throughput: ${stats.throughput.toFixed(1)} tasks/week`);
      console.log();

      console.log(chalk.cyan('Code Metrics:'));
      console.log(`  Lines Added: +${stats.codeMetrics.linesAdded}`);
      console.log(`  Lines Removed: -${stats.codeMetrics.linesRemoved}`);
      console.log(`  Files Changed: ${stats.codeMetrics.filesChanged}`);
      console.log(`  Test Coverage: ${(stats.codeMetrics.testCoverage * 100).toFixed(1)}%`);
      console.log();

      console.log(chalk.cyan('Quality:'));
      console.log(`  Error Rate: ${(stats.errorRate * 100).toFixed(2)}%`);
      console.log(`  Bug Fix Time: ${stats.bugFixTime.toFixed(1)} hours`);

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Dashboard command
program
  .command('dashboard')
  .description('Open interactive dashboard')
  .action(async () => {
    try {
      const csp = await getUnifiedOrchestron();
      const dashboard = await csp.generateDashboard();
      console.log(chalk.green('✓'), 'Dashboard generated');
      console.log(dashboard);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Bottlenecks command
program
  .command('bottlenecks')
  .description('Identify bottlenecks')
  .action(async () => {
    try {
      const csp = await getUnifiedOrchestron();
      const bottlenecks = await csp.identifyBottlenecks();

      if (bottlenecks.length === 0) {
        console.log(chalk.green('✓'), 'No bottlenecks detected');
        return;
      }

      console.log(chalk.bold('🚧 Bottlenecks:'));
      for (const bottleneck of bottlenecks) {
        console.log(chalk.red(`• ${bottleneck.description}`));
        console.log(`  Impact: ${bottleneck.impact}`);
        console.log(`  Tasks affected: ${bottleneck.affectedTasks.length}`);
        if (bottleneck.suggestion) {
          console.log(chalk.green(`  Suggestion: ${bottleneck.suggestion}`));
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Predict command
program
  .command('predict <taskId>')
  .description('Predict task completion')
  .action(async (taskId) => {
    try {
      const csp = await getUnifiedOrchestron();
      const prediction = await csp.predictCompletion(taskId);

      console.log(chalk.bold('🔮 Prediction:'));
      console.log(`  Task: ${formatTaskId(taskId)}`);
      console.log(`  Estimated completion: ${prediction ? prediction.toLocaleDateString() : 'Unable to predict'}`);
      console.log(`  Confidence: ${chalk.cyan('85%')}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Metrics command
program
  .command('metrics <metric>')
  .description('Show specific metric')
  .option('--period <days>', 'Period in days', parseInt, 30)
  .option('--trend', 'Show trend')
  .action(async (metric, options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const data = await csp.getMetricData(metric, options.period);

      console.log(chalk.bold(`📈 ${metric}:`));
      console.log(`  Current: ${data.current}`);
      console.log(`  Average: ${data.average}`);
      console.log(`  Min: ${data.min}`);
      console.log(`  Max: ${data.max}`);

      if (options.trend) {
        console.log(`  Trend: ${data.trend > 0 ? chalk.green('↑') : chalk.red('↓')} ${Math.abs(data.trend)}%`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// ============= WORKFLOW AUTOMATION COMMANDS =============

// Workflow commands
program
  .command('workflow')
  .description('Workflow automation')
  .command('create <file>')
  .description('Create workflow from YAML file')
  .action(async (file) => {
    try {
      const csp = await getUnifiedOrchestron();
      const content = fs.readFileSync(file, 'utf8');
      const workflowDef = JSON.parse(content);
      await csp.createWorkflow(workflowDef);
      console.log(chalk.green('✓'), 'Workflow created successfully');
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

program
  .command('workflow')
  .command('list')
  .description('List workflows')
  .action(async () => {
    try {
      const csp = await getUnifiedOrchestron();
      const workflows = await csp.listWorkflows();

      console.log(chalk.bold('⚙️ Workflows:'));
      for (const workflow of workflows) {
        const status = workflow.enabled ? chalk.green('enabled') : chalk.gray('disabled');
        console.log(`  ${workflow.name} [${status}]`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

program
  .command('workflow')
  .command('enable <name>')
  .description('Enable workflow')
  .action(async (name) => {
    try {
      const csp = await getUnifiedOrchestron();
      await csp.enableWorkflow(name);
      console.log(chalk.green('✓'), `Workflow enabled: ${name}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// ============= FILE SYSTEM WATCHING =============

// Watch command
program
  .command('watch <patterns...>')
  .description('Watch files for changes')
  .action(async (patterns) => {
    try {
      const csp = await getUnifiedOrchestron();
      await csp.watchFiles(patterns);
      console.log(chalk.green('✓'), `Watching ${patterns.length} patterns`);
      console.log(chalk.dim('Press Ctrl+C to stop watching'));
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// ============= DEVELOPMENT TRACKING COMMANDS =============

// Commit command (enhanced)
program
  .command('commit')
  .description('Create an Orchestron commit')
  .option('-t, --type <type>', 'Node type', 'feature')
  .option('-m, --message <message>', 'Commit message')
  .option('-f, --files <files...>', 'Files to include')
  .action(async (options) => {
    try {
      const eng = await getEngine();

      const nodeType = options.type.toUpperCase() as keyof typeof DevelopmentNodeType;

      if (!(nodeType in DevelopmentNodeType)) {
        console.error(chalk.red(`Invalid node type: ${options.type}`));
        console.log('Valid types:', Object.keys(DevelopmentNodeType).join(', '));
        process.exit(1);
      }

      const files: FileChange[] = options.files?.map((f: string) => ({
        path: f,
        action: 'modify' as const,
        diff: fs.existsSync(f) ? 'file content' : undefined,
      })) || [];

      const response = await eng.commitCode({
        type: DevelopmentNodeType[nodeType],
        files,
        message: options.message || 'Development commit',
        metrics: {
          filesModified: files.map(f => f.path),
        },
      });

      console.log(chalk.green('✓'), `Commit created: ${response.commitId.slice(0, 8)}`);

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Error tracking
program
  .command('error')
  .description('Track an error')
  .option('-m, --message <message>', 'Error message')
  .option('-c, --component <component>', 'Component name')
  .option('-s, --severity <severity>', 'Severity level', 'MEDIUM')
  .action(async (options) => {
    try {
      const eng = await getEngine();

      await OrchestronTools.trackError(eng, {
        message: options.message || 'Unknown error',
        component: options.component || 'unknown',
        severity: options.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      });

      console.log(chalk.green('✓'), 'Error tracked');

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Benchmark tracking
program
  .command('benchmark')
  .description('Track performance benchmark')
  .option('-o, --operation <operation>', 'Operation name')
  .option('-b, --before <before>', 'Before throughput', parseInt)
  .option('-a, --after <after>', 'After throughput', parseInt)
  .action(async (options) => {
    try {
      const eng = await getEngine();

      const improvement = options.before && options.after
        ? `${((options.after - options.before) / options.before * 100).toFixed(2)}%`
        : 'N/A';

      await OrchestronTools.trackPerformance(eng, {
        operation: options.operation || 'benchmark',
        before: { throughput: options.before || 0 },
        after: { throughput: options.after || 0 },
        improvement,
      });

      console.log(chalk.green('✓'), `Benchmark tracked: ${improvement} improvement`);

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Decision tracking
program
  .command('decide')
  .description('Track a development decision')
  .option('-t, --title <title>', 'Decision title')
  .option('-r, --rationale <rationale>', 'Rationale')
  .option('-a, --alternatives <alternatives...>', 'Alternative approaches')
  .action(async (options) => {
    try {
      const eng = await getEngine();

      await OrchestronTools.trackDevelopmentDecision(eng, {
        type: DevelopmentNodeType.ARCHITECTURE,
        title: options.title || 'Development decision',
        rationale: options.rationale || 'Technical requirement',
        alternatives: options.alternatives,
      });

      console.log(chalk.green('✓'), 'Decision tracked');

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// ============= LEGACY COMMANDS (kept for compatibility) =============

// Status command (enhanced)
program
  .command('status')
  .description('Show comprehensive Orchestron status')
  .action(async () => {
    try {
      const csp = await getUnifiedOrchestron();
      const eng = await getEngine();

      const currentBranch = eng.getCurrentBranch();
      const activeSprint = csp.getActiveSprint();
      const stats = await csp.getStats();

      console.log(chalk.bold('Orchestron v3.0 Status'));
      console.log('='.repeat(50));
      console.log();

      console.log(chalk.cyan('Environment:'));
      console.log('  Branch:', chalk.green(currentBranch));
      console.log('  Session:', chalk.dim(eng.getSessionId().slice(0, 8)));
      console.log('  Sprint:', activeSprint ? chalk.green(activeSprint) : chalk.gray('None active'));
      console.log();

      console.log(chalk.cyan('Tasks:'));
      console.log(`  Total: ${stats.totalTasks}`);
      console.log(`  In Progress: ${chalk.yellow(stats.inProgress)}`);
      console.log(`  Blocked: ${chalk.red(stats.blocked)}`);
      console.log(`  Overdue: ${chalk.red(stats.overdue)}`);
      console.log();

      console.log(chalk.cyan('Today:'));
      console.log(`  Completed: ${stats.completedToday}`);
      console.log(`  Velocity: ${stats.velocity.toFixed(1)} points/day`);
      console.log();

      console.log(chalk.cyan('Quality:'));
      console.log(`  Test Coverage: ${(stats.codeMetrics.testCoverage * 100).toFixed(1)}%`);
      console.log(`  Error Rate: ${(stats.errorRate * 100).toFixed(2)}%`);

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Report command (enhanced)
program
  .command('report')
  .description('Generate comprehensive report')
  .option('-f, --format <format>', 'Output format (markdown|json|html)', 'markdown')
  .option('-p, --period <period>', 'Report period (daily|weekly|sprint)', 'daily')
  .action(async (options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const report = await csp.generateReport(options.format);
      console.log(report);

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// ============= INTERACTIVE MODE =============

// Interactive mode
program
  .command('interactive')
  .description('Enter interactive Orchestron shell')
  .action(async () => {
    console.log(chalk.cyan('Orchestron v3.0 Interactive Mode'));
    console.log(chalk.dim("Type 'help' for commands, 'exit' to quit"));
    console.log();

    const csp = await getUnifiedOrchestron();
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('CSP> '),
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const args = line.trim().split(' ');
      const command = args[0];

      try {
        switch (command) {
          case 'help':
            console.log(chalk.bold('Available commands:'));
            console.log('  status       - Show current status');
            console.log('  tasks        - List tasks (add --mine for your tasks)');
            console.log('  start <id>   - Start timer for task');
            console.log('  stop         - Stop current timer');
            console.log('  complete <checkpoint> - Complete checkpoint');
            console.log('  stats        - Show statistics');
            console.log('  exit         - Exit interactive mode');
            break;

          case 'status': {
            const stats = await csp.getStats();
            console.log(chalk.bold('📊 Current Status:'));
            console.log(`  Tasks: ${stats.totalTasks} total (${stats.inProgress} in progress, ${stats.blocked} blocked, ${stats.overdue} overdue)`);
            const activeSprint = await csp.getActiveSprint();
            if (activeSprint) {
              const sprintProps = getSprintProps(activeSprint);
              const currentDay = Math.floor((Date.now() - new Date(sprintProps.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
              const duration = Math.floor((new Date(sprintProps.endDate).getTime() - new Date(sprintProps.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
              console.log(`  Sprint: ${sprintProps.name} (Day ${currentDay}/${duration})`);
            }
            console.log(`  Velocity: ${stats.velocity.toFixed(1)} points/day`);
            break;
          }
          case 'tasks': {
            const filter: any = {};
            if (args.includes('--mine')) {
              filter.assignee = process.env.USER || 'me';
            }
            const tasks = await csp.searchTasks(filter);
            console.log(chalk.bold('📝 Your Tasks:'));
            for (const task of tasks.slice(0, 5)) {
              const props = getTaskProps(task);
              const priority = props.priority === Priority.HIGH ? chalk.red(`[${props.priority}]`) :
                props.priority === Priority.CRITICAL ? chalk.magenta(`[${props.priority}]`) :
                  chalk.yellow(`[${props.priority}]`);
              console.log(`  ${priority} ${formatTaskId(props.id)}: ${props.title} (${props.status}) ${props.progress}%`);
            }
            break;
          }
          case 'start':
            if (args[1]) {
              await csp.startTimer(args[1], 'current-user');
              console.log(chalk.green('⏱️'), `Timer started for ${formatTaskId(args[1])}`);
            } else {
              console.log(chalk.red('Please specify task ID'));
            }
            break;

          case 'stop':
            if (args[1]) {
              await csp.stopTimer(args[1]);
              console.log(chalk.green('⏹️'), `Timer stopped for ${formatTaskId(args[1])}`);
            } else {
              console.log(chalk.red('Please specify task ID'));
            }
            break;

          case 'complete':
            if (args[1] && args[2]) {
              const taskId = args[1];
              const checkpoint = args.slice(2).join(' ');
              await csp.completeCheckpoint(taskId, checkpoint);
              console.log(chalk.green('✅'), `Checkpoint completed: ${checkpoint} for ${formatTaskId(taskId)}`);
            } else {
              console.log(chalk.red('Please specify task ID and checkpoint name'));
            }
            break;

          case 'stats': {
            const currentStats = await csp.getStats();
            console.log(chalk.bold('📈 Statistics:'));
            console.log(`  Velocity: ${currentStats.velocity.toFixed(1)} points/day`);
            console.log(`  Cycle Time: ${currentStats.cycleTime.toFixed(1)} hours`);
            console.log(`  Throughput: ${currentStats.throughput.toFixed(1)} tasks/week`);
            break;
          }

          case 'exit':
          case 'quit':
            console.log(chalk.dim('Goodbye!'));
            rl.close();
            process.exit(0);
            break;

          default:
            if (command) {
              console.log(chalk.yellow(`Unknown command: ${command}`));
              console.log(chalk.dim("Type 'help' for available commands"));
            }
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error);
      }

      rl.prompt();
    });

    rl.on('close', () => {
      console.log(chalk.dim('\nGoodbye!'));
      process.exit(0);
    });
  });

// ============= UTILITY COMMANDS =============

// Analyze errors
program
  .command('analyze-errors')
  .description('Analyze error patterns')
  .option('-t, --threshold <threshold>', 'Minimum frequency', parseInt, 2)
  .action(async (options) => {
    try {
      const eng = await getEngine();

      const patterns = await eng.analyzeErrors(options.threshold);

      if (patterns.length === 0) {
        console.log('No recurring error patterns found');
        return;
      }

      console.log(chalk.bold('Error Patterns:'));
      for (const pattern of patterns) {
        console.log(
          chalk.red(`• ${pattern.pattern}`),
          chalk.dim(`(${pattern.frequency} occurrences)`)
        );
        console.log('  Last seen:', pattern.lastOccurrence.toLocaleString());
        if (pattern.suggestedFix) {
          console.log('  Suggested fix:', chalk.green(pattern.suggestedFix));
        }
      }

    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Quick actions
program
  .command('quick')
  .description('Quick action shortcuts')
  .command('commit')
  .description('Interactive commit helper')
  .action(async () => {
    // Interactive commit flow
    console.log(chalk.cyan('Quick Commit Helper'));
    // Implementation would go here
  });

// Graph visualization
program
  .command('graph')
  .description('Visualize Orchestron graph')
  .option('--type <type>', 'Filter by node type')
  .option('--last-week', 'Show last week only')
  .action(async (options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const graph = await csp.generateGraph(options);
      console.log(graph);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Timeline view
program
  .command('timeline')
  .description('Show development timeline')
  .option('--component <component>', 'Filter by component')
  .action(async (options) => {
    try {
      const csp = await getUnifiedOrchestron();
      const timeline = await csp.generateTimeline(options);
      console.log(timeline);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Timer management
program
  .command('timer')
  .description('Timer management')
  .command('start <taskId>')
  .description('Start timer for task')
  .action(async (taskId) => {
    try {
      const csp = await getUnifiedOrchestron();
      await csp.startTimer(taskId, 'current-user');
      console.log(chalk.green('⏱️'), `Timer started for ${formatTaskId(taskId)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

program
  .command('timer')
  .command('stop <taskId>')
  .description('Stop timer for task')
  .action(async (taskId) => {
    try {
      const csp = await getUnifiedOrchestron();
      await csp.stopTimer(taskId);
      console.log(chalk.green('⏹️'), `Timer stopped for ${formatTaskId(taskId)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Context command
program
  .command('context')
  .description('Show current context')
  .action(async () => {
    try {
      const csp = await getUnifiedOrchestron();
      const context = await csp.getCurrentContext();

      console.log(chalk.bold('🎯 Current Context:'));
      console.log('  Branch:', context.currentBranch);
      console.log('  Task:', context.currentTask ? formatTaskId(context.currentTask) : 'None');
      console.log('  Sprint:', context.currentSprint || 'None');
      console.log('  Directory:', context.workingDirectory);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Parse command line
program.parse(process.argv);

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}