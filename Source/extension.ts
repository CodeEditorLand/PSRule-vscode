// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

"use strict";

import * as path from "path";
import * as vscode from "vscode";

import { configureSettings } from "./commands/configureSettings";
import { createOptionsFile } from "./commands/createOptionsFile";
import { openOptionsFile } from "./commands/openOptionsFile";
import { restore } from "./commands/restore";
import { runAnalysisTask } from "./commands/runAnalysisTask";
import { showTasks } from "./commands/showTasks";
import { walkthroughCopySnippet } from "./commands/walkthroughCopySnippet";
import { ConfigurationManager } from "./configuration";
import { DocumentationLensProvider } from "./docLens";
import { logger } from "./logger";
import { pwsh } from "./powershell";
import { PSRuleTaskProvider } from "./tasks";
import { getLanguageServer, PSRuleLanguageServer } from "./utils";

export let taskManager: PSRuleTaskProvider | undefined;

export let docLensProvider: DocumentationLensProvider | undefined;

export interface ExtensionInfo {
	id: string;

	version: string;

	channel: string;

	path: string;

	disable: boolean;
}

export class ExtensionManager implements vscode.Disposable {
	private _info!: ExtensionInfo;

	private _context!: vscode.ExtensionContext;

	private _server!: PSRuleLanguageServer | undefined;

	constructor() {}

	/**
	 * Information about the extension.
	 */
	public get info(): Promise<ExtensionInfo> {
		const parent = this;

		return new Promise<ExtensionInfo>((resolve, reject) => {
			if (parent._info) {
				resolve(parent._info);
			} else {
				setTimeout(() => {
					if (parent._info) {
						resolve(parent._info);
					} else {
						reject("Failed to get info.");
					}
				}, 1000);
			}
		});
	}

	public get isTrusted(): boolean {
		return vscode.workspace.isTrusted;
	}

	/**
	 * A task provider if the workspace is trusted, otherwise returns undefined.
	 */
	public get tasks(): PSRuleTaskProvider | undefined {
		return taskManager;
	}

	public get server(): PSRuleLanguageServer | undefined {
		return this._server;
	}

	public activate(context: vscode.ExtensionContext) {
		this._context = context;

		this._info = this.checkExtension(context);

		if (!this._info.disable) {
			this.activateFeatures();
		}
	}

	public dispose(): void {
		if (docLensProvider) {
			docLensProvider.dispose();
		}

		if (taskManager) {
			taskManager.dispose();
		}

		if (pwsh) {
			pwsh.dispose();
		}

		if (logger) {
			logger.dispose();
		}
	}

	private async activateFeatures(): Promise<void> {
		await this.switchMode();

		if (this._context) {
			this._context.subscriptions.push(
				vscode.workspace.onDidGrantWorkspaceTrust(() => {
					this.switchMode();
				}),
			);

			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					"PSRule.openOptionsFile",
					(path: string) => {
						openOptionsFile(path);
					},
				),
			);

			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					"PSRule.createOptionsFile",
					(path: string) => {
						createOptionsFile(path);
					},
				),
			);

			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					"PSRule.configureSettings",
					() => {
						configureSettings();
					},
				),
			);

			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					"PSRule.walkthroughCopySnippet",
					(args: { snippet: string }) => {
						walkthroughCopySnippet(args.snippet);
					},
				),
			);

			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					"PSRule.runAnalysisTask",
					() => {
						runAnalysisTask();
					},
				),
			);

			this._context.subscriptions.push(
				vscode.commands.registerCommand("PSRule.showTasks", () => {
					showTasks();
				}),
			);

			this._context.subscriptions.push(
				vscode.commands.registerCommand("PSRule.restore", () => {
					restore();
				}),
			);
		}
	}

	private async switchMode(): Promise<void> {
		ConfigurationManager.configure(this._context);

		if (!docLensProvider) {
			docLensProvider = new DocumentationLensProvider(
				logger,
				this._context,
			);

			docLensProvider.register();
		}

		if (this.isTrusted) {
			this.setContextVariables();
		}

		if (this.isTrusted) {
			pwsh.configure(this._info);
		}

		if (this.isTrusted) {
			taskManager = new PSRuleTaskProvider(logger, this._context);

			taskManager.register();
		}

		if (this.isTrusted) {
			this._server = await getLanguageServer(this._context);
		}
	}

	private setContextVariables(): void {
		vscode.commands.executeCommand(
			"setContext",
			"PSRule.workspaceTrusted",
			this.isTrusted,
		);
	}

	/**
	 * Check channel and version of the extension activated.
	 * @param context An extension context.
	 */
	private checkExtension(context: vscode.ExtensionContext): ExtensionInfo {
		const extensionVersionKey = "ps-rule-extension-version";

		// Get channel
		let extensionId = "ps-rule.code";

		let isMainstreamInstalled =
			vscode.extensions.getExtension(extensionId) !== undefined;

		if (
			path.basename(context.globalStorageUri.fsPath) ===
			"ps-rule.code-dev"
		) {
			extensionId = "ps-rule.code-dev";
		}

		// Get current version
		const extension = vscode.extensions.getExtension(extensionId)!;

		const extensionVersion: string = extension.packageJSON.version;

		const extensionChannel: string = extension.packageJSON.channel;

		logger.verbose(`Running extension channel: ${extensionChannel}`);

		logger.verbose(`Running extension version: ${extensionVersion}`);

		// Get last version
		const lastVersion = context.globalState.get(extensionVersionKey);

		// Save the extension version
		context.globalState.update(extensionVersionKey, extensionVersion);

		// Determine if the channel upgrade message is shown
		const showChannelUpgrade: boolean = vscode.workspace
			.getConfiguration("PSRule.notifications")
			.get("showChannelUpgrade", true);

		const showExtension = "Show Extension";

		if (extensionChannel === "dev" && showChannelUpgrade) {
			const showReleaseNotes = "Show Release Notes";

			const alwaysIgnore = "Always Ignore";

			vscode.window
				.showInformationMessage(
					`You are running the ${extensionChannel} version of PSRule.`,
					showReleaseNotes,
					showExtension,
					alwaysIgnore,
				)
				.then((choice) => {
					if (choice === showReleaseNotes) {
						vscode.commands.executeCommand(
							"markdown.showPreview",
							vscode.Uri.file(
								path.resolve(__dirname, "../../CHANGELOG.md"),
							),
						);
					}

					if (choice === showExtension) {
						vscode.commands.executeCommand(
							"workbench.extensions.search",
							"ps-rule.code",
						);
					}

					if (choice === alwaysIgnore) {
						vscode.workspace
							.getConfiguration("PSRule.notifications")
							.update(
								"showChannelUpgrade",
								false,
								vscode.ConfigurationTarget.Global,
							);
					}
				});
		}

		if (
			extensionChannel === "stable" &&
			extensionVersion != lastVersion &&
			showChannelUpgrade
		) {
			const showReleaseNotes = "Show Release Notes";

			const alwaysIgnore = "Always Ignore";

			vscode.window
				.showInformationMessage(
					`Welcome to v${extensionVersion} of PSRule.`,
					showReleaseNotes,
					alwaysIgnore,
				)
				.then((choice) => {
					if (choice === showReleaseNotes) {
						vscode.commands.executeCommand(
							"markdown.showPreview",
							vscode.Uri.file(
								path.resolve(__dirname, "../../CHANGELOG.md"),
							),
						);
					}

					if (choice === alwaysIgnore) {
						vscode.workspace
							.getConfiguration("PSRule.notifications")
							.update(
								"showChannelUpgrade",
								false,
								vscode.ConfigurationTarget.Global,
							);
					}
				});
		}

		let disable = false;

		if (extensionChannel === "dev" && isMainstreamInstalled) {
			disable = true;

			vscode.window
				.showWarningMessage(
					`You may experience issues running the ${extensionChannel} version of PSRule, side-by-side with the stable version. Please uninstall one of ${extensionChannel} or stable version and reload Visual Studio Code for the best experience.`,
					showExtension,
				)
				.then((choice) => {
					if (choice === showExtension) {
						vscode.commands.executeCommand(
							"workbench.extensions.search",
							"PSRule",
						);
					}
				});
		}

		const result: ExtensionInfo = {
			id: extensionId,
			version: extensionVersion,
			channel: extensionChannel,
			path: context.extensionPath,
			disable: disable,
		};

		return result;
	}
}

export const ext: ExtensionManager = new ExtensionManager();
