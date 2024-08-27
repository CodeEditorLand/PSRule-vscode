import type * as vscode from "vscode";
import { ext } from "./extension";

/**
 * Activate PSRule extension.
 * @param context An extension context.
 */
export function activate(context: vscode.ExtensionContext): void {
	ext.activate(context);
}

/**
 * Deactivate PSRule extension.
 */
export function deactivate(): void {
	if (ext) {
		ext.dispose();
	}
}
