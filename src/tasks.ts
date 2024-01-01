// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { defaultOptionsFile } from './consts';
import { ILogger } from './logger';
import { configuration, ExecutionActionPreference } from './configuration';
import { pwsh } from './powershell';
import { getActiveOrFirstWorkspace } from './utils';

const emptyTasks: vscode.Task[] = [];

interface IContext {
    readonly logger: ILogger;
    readonly extensionContext: vscode.ExtensionContext;
}

interface PSRuleTaskDefinition extends vscode.TaskDefinition {
    /**
     * The a path to rules to use for analysis.
     */
    path?: string;

    /**
     * The input path to run.
     */
    inputPath?: string;

    /**
     * An optional baseline to use.
     */
    baseline?: string;

    /**
     * Rule modules to use for analysis.
     */
    modules?: string[];

    outcome?: string[];
}

/**
 * A task provider for PSRule.
 */
export class PSRuleTaskProvider implements vscode.TaskProvider {
    // Fields
    private readonly context: IContext;

    private static taskType: string = 'PSRule';
    private tasks: vscode.Task[] | undefined;

    // We use a CustomExecution task when state needs to be shared across runs of the task or when
    // the task requires use of some VS Code API to run.
    // If you don't need to share state between runs and if you don't need to execute VS Code API in your task,
    // then a simple ShellExecution or ProcessExecution should be enough.
    // Since our build has this shared state, the CustomExecution is used below.
    private sharedState: string | undefined;
    private providerRegistration!: vscode.Disposable;

    constructor(logger: ILogger, extensionContext: vscode.ExtensionContext) {
        this.context = { logger, extensionContext };
    }

    public dispose() {
        // Do nothing yet
        if (this.providerRegistration) {
            this.providerRegistration.dispose();
        }
    }

    public register(): void {
        // Register a task provider
        this.providerRegistration = vscode.tasks.registerTaskProvider(
            PSRuleTaskProvider.taskType,
            this
        );
        this.context.logger.verbose('Registered task provider.');
    }

    /**
     * Get tasks for Visual Studio Code API.
     * @returns Returns a list of tasks.
     */
    public async provideTasks(): Promise<vscode.Task[]> {
        return this.getTasks();
    }

    /**
     * Complete a task object for Visual Studio Code.
     * @param _task A task object that might need completing.
     * @returns A completed Visual Studio Code task.
     */
    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        const definition: PSRuleTaskDefinition = <any>_task.definition;
        const scope = _task.scope as vscode.WorkspaceFolder;
        return this.resolveTaskRunAnalysis(scope, definition);
    }

    /**
     * Get a list of PSRule tasks for each Visual Studio Code workspace.
     * @returns A list of tasks.
     */
    private async getTasks(): Promise<vscode.Task[]> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            return Promise.resolve([]);
        }

        const result: vscode.Task[] = [];
        for (let i = 0, len = folders.length; i < len; i++) {
            if (this.isEnabled(folders[i])) {
                const tasks = await this.getWorkspaceTasks(folders[i]);
                result.push(...tasks);
            }
        }
        return result;
    }

    private isEnabled(folder: vscode.WorkspaceFolder): boolean {
        return true;
    }

    private async exists(file: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            fs.exists(file, (value) => {
                resolve(value);
            });
        });
    }

    private async readFile(file: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            fs.readFile(file, (err, data) => {
                if (err) {
                    reject(err);
                }
                resolve(data.toString());
            });
        });
    }

    public async getWorkspaceTasks(folder: vscode.WorkspaceFolder): Promise<vscode.Task[]> {
        if (folder.uri.scheme !== 'file') {
            return emptyTasks;
        }

        const rootPath = folder.uri.fsPath;
        const optionFilePath = path.join(rootPath, defaultOptionsFile);

        if (!(await this.exists(optionFilePath))) {
            return emptyTasks;
        }

        try {
            const result: vscode.Task[] = [];
            let t = this.createTaskRunAnalysis(folder);
            if (t !== undefined) result.push(t);
            return result;
        } catch (e) {
            return emptyTasks;
        }
    }

    private resolveTaskRunAnalysis(
        folder: vscode.WorkspaceFolder,
        definition: PSRuleTaskDefinition
    ): vscode.Task | undefined {
        return this.createTask(
            'Run analysis',
            folder,
            definition.path,
            definition.inputPath,
            definition.baseline,
            definition.modules,
            definition.outcome,
            undefined,
            definition
        );
    }

    private createTaskRunAnalysis(folder: vscode.WorkspaceFolder): vscode.Task | undefined {
        return this.createTask(
            'Run analysis',
            folder,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined
        );
    }

    /**
     * Creates a task.
     * @param name The name of the task.
     * @param path The root of the workspace.
     * @param baseline An optional baseline.
     * @param matcher A task filter.
     */
    private createTask(
        name: string,
        folder: vscode.WorkspaceFolder | undefined,
        path?: string,
        inputPath?: string,
        baseline?: string,
        modules?: string[],
        outcome?: string[],
        matcher?: any,
        definition?: PSRuleTaskDefinition
    ): vscode.Task {
        if (definition === undefined) {
            definition = {
                type: PSRuleTaskProvider.taskType,
                matcher: '$PSRule',
            };
        }

        const executionRuleExcluded = configuration.get().executionRuleExcluded;
        const executionRuleSuppressed = configuration.get().executionRuleSuppressed;
        const executionUnprocessedObject = configuration.get().executionUnprocessedObject;
        const outputAs = configuration.get().outputAs;
        const ruleBaseline = configuration.get().ruleBaseline;

        function getTaskName() {
            return name;
        }

        function getCmdTooling(): string {
            let params = '';

            // Path
            if (path !== undefined && path !== '') {
                params += ` --path '${path}'`;
            }

            // Input Path
            if (inputPath !== undefined && inputPath !== '') {
                params += ` --input-path '${inputPath}'`;
            } else {
                params += ` --input-path .`;
            }

            // Baseline
            if (baseline !== undefined && baseline !== '') {
                params += ` --baseline '${baseline}'`;
            } else if (ruleBaseline !== undefined && ruleBaseline !== '') {
                params += ` --baseline '${ruleBaseline}'`;
            }

            // Modules
            if (modules !== undefined && modules.length > 0) {
                for (let i = 0; i < modules.length; i++) {
                    params += ` --module ${modules[i]}`;
                }
            }

            // Outcome
            if (outcome !== undefined && outcome.length > 0) {
                for (let i = 0; i < outcome.length; i++) {
                    params += ` --outcome ${outcome[i]}`;
                }
            }
            else {
                params += ' --outcome Fail --outcome Error';
            }

            return `ps-rule run${params}`;
        }

        const taskName = getTaskName();

        if (!pwsh.isActive) {
            return new vscode.Task(
                definition,
                folder ?? vscode.TaskScope.Workspace,
                taskName,
                PSRuleTaskProvider.taskType,
                new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                    // When the task is executed, this callback will run. Here, we setup for running the task.
                    return new NoPowerShellPseudoterminal();
                }),
                matcher
            );
        }

        // Set environment variables for the task.
        let taskEnv: { [key: string]: string } = {
            PSRULE_OUTPUT_STYLE: 'VisualStudioCode',
            PSRULE_OUTPUT_AS: outputAs,
            PSRULE_OUTPUT_CULTURE: vscode.env.language,
            PSRULE_OUTPUT_BANNER: 'Minimal',
        };

        if (executionRuleExcluded !== undefined && executionRuleExcluded !== ExecutionActionPreference.None) {
            taskEnv.PSRULE_EXECUTION_RULEEXCLUDED = executionRuleExcluded;
        }

        if (executionRuleSuppressed !== undefined && executionRuleSuppressed !== ExecutionActionPreference.None) {
            taskEnv.PSRULE_EXECUTION_RULESUPPRESSED = executionRuleSuppressed;
        }

        if (executionUnprocessedObject !== undefined && executionUnprocessedObject !== ExecutionActionPreference.None) {
            taskEnv.PSRULE_EXECUTION_UNPROCESSEDOBJECT = executionUnprocessedObject;
        }

        const cwd = folder?.uri.fsPath ?? getActiveOrFirstWorkspace()?.uri.fsPath;

        // Return the task instance.
        const t = new vscode.Task(
            definition,
            folder ?? vscode.TaskScope.Workspace,
            taskName,
            PSRuleTaskProvider.taskType,
            new vscode.ShellExecution(getCmdTooling(), {
                cwd: cwd,
                env: taskEnv,
            }),
            matcher
        );
        t.detail = 'Run analysis for current workspace.';
        return t;
    }
}

class NoPowerShellPseudoterminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<void>();

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<void> = this.closeEmitter.event;

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.run();
    }
    close(): void { }

    private async run(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.writeEmitter.fire(
                'The extension PowerShell must be installed and enabled to run this task.'
            );
            this.closeEmitter.fire();
            resolve();
        });
    }
}
