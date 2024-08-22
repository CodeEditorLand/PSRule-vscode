import * as fse from "fs-extra";
import {
	type CancellationToken,
	CodeLens,
	type CodeLensProvider,
	type Disposable,
	type Event,
	EventEmitter,
	type ExtensionContext,
	Position,
	type Range,
	type TextDocument,
	commands,
	languages,
	workspace,
} from "vscode";
import type { DocumentSelector } from "vscode-languageclient";
import { createOrEditDocumentation } from "./commands/createOrEditDocumentation";
import { configuration } from "./configuration";
import type { ILogger } from "./logger";
import { getDocumentationPath } from "./utils";

interface IContext {
	readonly logger: ILogger;
	readonly extensionContext: ExtensionContext;
}

export class DocumentationLensProvider implements CodeLensProvider, Disposable {
	// Fields
	private readonly context: IContext;

	private codeLenses: CodeLens[] = [];
	private regexPowerShell: RegExp;
	private regexYaml: RegExp;
	private regexJson: RegExp;
	private _registration: Disposable | undefined;
	private _onDidChangeCodeLenses: EventEmitter<void> =
		new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> =
		this._onDidChangeCodeLenses.event;

	constructor(logger: ILogger, extensionContext: ExtensionContext) {
		this.context = { logger, extensionContext };
		this.regexPowerShell =
			/(?<rule>Rule )(?:-Name\s)?(?<name>['"]?[^<>:/\\|?*"'`+@._\-\x00-\x1F][^<>:/\\|?*"'`+@\x00-\x1F]{1,126}[^<>:/\\|?*"'`+@._\-\x00-\x1F]+['"]?)(?:.+)/gi;
		this.regexYaml =
			/(?<version>apiVersion: github\.com\/microsoft\/PSRule\/v1)(?:\s+kind: Rule\s+metadata:\s+)(?: {2}name: ?)(?<name>['"]?[^<>:/\\|?*"'`+@._\-\x00-\x1F][^<>:/\\|?*"'`+@\x00-\x1F]{1,126}[^<>:/\\|?*"'`+@._\-\x00-\x1F]+['"]?)/gi;
		this.regexJson =
			/("apiVersion":\s*"github\.com\/microsoft\/PSRule\/v1",)(?:\s*"kind":\s*"Rule",\s*"metadata":\s*{\s*)(?:"name":\s)(?<name>"[^<>:/\\|?*"'`+@._\-\x00-\x1F][^<>:/\\|?*"'`+@\x00-\x1F]{1,126}[^<>:/\\|?*"'`+@._\-\x00-\x1F]+")/gi;

		workspace.onDidChangeConfiguration((_) => {
			this._onDidChangeCodeLenses.fire();
		});
	}

	dispose() {
		this._registration?.dispose();
	}

	public register(): void {
		const filter: DocumentSelector = [
			{ language: "yaml", pattern: "**/*.Rule.yaml" },
			{ language: "json", pattern: "**/*.Rule.json" },
			{ language: "jsonc", pattern: "**/*.Rule.jsonc" },
			{ language: "powershell", pattern: "**/*.Rule.ps1" },
		];
		this._registration = languages.registerCodeLensProvider(filter, this);
		commands.registerCommand(
			"PSRule.createOrEditDocumentation",
			(name: string) => {
				createOrEditDocumentation(name);
			},
		);
	}

	public async provideCodeLenses(
		document: TextDocument,
		token: CancellationToken,
	): Promise<CodeLens[]> {
		if (configuration.get().codeLensRuleDocumentationLinks) {
			const regex = this.getLanguageExpression(document.languageId);
			if (regex === undefined) return [];

			this.codeLenses = [];
			const text = document.getText();
			let matches;
			while ((matches = regex.exec(text)) !== null) {
				const name =
					matches.groups !== undefined
						? matches.groups["name"].replace(/\'/g, "")
						: "";
				const line = document.lineAt(
					document.positionAt(matches.index).line,
				);
				const indexOf = line.text.indexOf(matches[1]);
				const position = new Position(line.lineNumber, indexOf);
				const range = document.getWordRangeAtPosition(position);
				if (range && name) {
					this.codeLenses.push(
						await this.createCodeLens(range, name),
					);
				}
			}
			return this.codeLenses;
		}
		return [];
	}

	private getLanguageExpression(language: string): RegExp | undefined {
		if (language === "powershell") return this.regexPowerShell;
		if (language === "yaml") return this.regexYaml;
		if (language === "json" || language === "jsonc") return this.regexJson;
		return undefined;
	}

	/**
	 * Create a rule code lens.
	 * @param range The range in the document the code lens applies to.
	 * @param name The name of the rule.
	 * @returns A code lens object.
	 */
	private async createCodeLens(
		range: Range,
		name: string,
	): Promise<CodeLens> {
		const uri = await getDocumentationPath(name);
		const exists = uri !== undefined && (await fse.pathExists(uri.fsPath));
		const title = exists ? "Open documentation" : "Create documentation";
		const tooltip = exists
			? "Open documentation for rule"
			: "Create documentation for rule";

		return new CodeLens(range, {
			title: title,
			tooltip: tooltip,
			command: "PSRule.createOrEditDocumentation",
			arguments: [name],
		});
	}

	public async resolveCodeLens(
		codeLens: CodeLens,
		token: CancellationToken,
	): Promise<CodeLens | undefined> {
		return undefined;
	}
}
