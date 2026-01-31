/**
 * Mock implementations of Obsidian types for testing
 *
 * These mocks provide minimal implementations needed for unit testing
 * pure functions that import from 'obsidian'.
 */

// Mock TFile class
export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;
	parent: TFolder | null;

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() || '';
		this.extension = this.name.includes('.') ? this.name.split('.').pop() || '' : '';
		this.basename = this.name.replace(/\.[^/.]+$/, '');
		this.parent = null;
	}
}

// Mock TFolder class
export class TFolder {
	path: string;
	name: string;

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() || '';
	}
}

// Mock Notice class
export class Notice {
	message: string;

	constructor(message: string, timeout?: number) {
		this.message = message;
	}

	hide(): void {}
}

// Mock Vault class
export class Vault {
	async read(file: TFile): Promise<string> {
		return '';
	}

	async cachedRead(file: TFile): Promise<string> {
		return '';
	}

	async modify(file: TFile, content: string): Promise<void> {}

	async create(path: string, content: string): Promise<TFile> {
		return new TFile(path);
	}

	async delete(file: TFile): Promise<void> {}

	getMarkdownFiles(): TFile[] {
		return [];
	}

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		return null;
	}
}

// Mock requestUrl function
export async function requestUrl(options: {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}): Promise<{ json: any; text: string; status: number }> {
	return {
		json: {},
		text: '',
		status: 200
	};
}

// Export other commonly used types as empty objects/functions
export class App {}
export class Modal {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class ItemView {}
export class WorkspaceLeaf {}
export class MarkdownRenderer {}

export type MarkdownPostProcessorContext = {
	sourcePath: string;
};

export function setIcon(el: HTMLElement, icon: string): void {}
